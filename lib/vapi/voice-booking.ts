import {
  applyPaymentUrlToReply,
  tryAutoFinalizeBooking,
} from "@/lib/ollama/booking-fallback";
import {
  appendTranscript,
  getConversationByLeadId,
} from "@/lib/ollama/conversations";
import { syncLeadIntakeFromUserMessage } from "@/lib/ollama/intake-sync";
import {
  buildDisplayName,
  getMissingBookingFields,
  isBookingReady,
  looksLikePersonName,
  type LeadIntakeRecord,
} from "@/lib/leads/intake";
import {
  confirmLeadContact,
  loadLeadIntakeRecord,
  runServiceScopeVerification,
  updateLeadIntake,
} from "@/lib/leads/intake-actions";
import { loadLeadBookingPaymentState } from "@/lib/stripe/payment-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio/client";
import { formatCallDuration, type ParsedVapiCall } from "@/lib/vapi/parse-call";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SPOKEN_GMAIL_RE =
  /\b([a-z][a-z0-9]*(?:\s+[a-z0-9]+)*)\s+at\s+gmail\s+dot\s+com\b/gi;

export function voiceTranscriptShowsConfirmation(transcript: string): boolean {
  const lines = transcript.split("\n").map((line) => line.trim()).filter(Boolean);
  let sawRecap = false;

  for (const line of lines) {
    if (
      /^Assistant:/i.test(line) &&
      /\b(is (all of )?that correct|is everything correct|does that (all )?sound right)\b/i.test(
        line
      )
    ) {
      sawRecap = true;
    }
    if (
      sawRecap &&
      /^Customer:\s*(yes|yeah|yep|correct|that's right|that is correct)\b/i.test(
        line
      )
    ) {
      return true;
    }
  }

  const yesCount = (transcript.match(/^Customer:\s*Yes\b/gim) ?? []).length;
  return (
    yesCount >= 2 &&
    /\btomorrow\b/i.test(transcript) &&
    /\b(street|avenue|road|drive|lane|blvd|boulevard)\b/i.test(transcript)
  );
}

export function inferVoiceEmail(
  transcript: string,
  summary?: string | null
): string | undefined {
  for (const source of [summary ?? "", transcript]) {
    if (!source.trim()) continue;
    const standard = source.match(EMAIL_RE);
    if (standard) return standard[0].toLowerCase();
  }

  for (const source of [summary ?? "", transcript]) {
    if (!source.trim()) continue;
    const compact = source.match(/\b([a-z0-9]+)@gmail\.com\b/i);
    if (compact) return `${compact[1].toLowerCase()}@gmail.com`;
  }

  for (const match of transcript.matchAll(SPOKEN_GMAIL_RE)) {
    const local = match[1].replace(/\s+/g, "").toLowerCase();
    if (local.length >= 3) {
      return `${local}@gmail.com`;
    }
  }

  return undefined;
}

async function markVoiceIntakeCollectedFlags(params: {
  orgId: string;
  leadId: string;
}): Promise<LeadIntakeRecord> {
  const lead = await loadLeadIntakeRecord(params);
  const patch: {
    intake_name_collected?: boolean;
    intake_phone_collected?: boolean;
    intake_email_collected?: boolean;
    intake_address_collected?: boolean;
    name?: string;
  } = {};

  if (
    lead.first_name?.trim() &&
    lead.last_name?.trim() &&
    looksLikePersonName(lead.first_name) &&
    looksLikePersonName(lead.last_name)
  ) {
    patch.intake_name_collected = true;
    patch.name = buildDisplayName(lead.first_name, lead.last_name, lead.name);
  }
  if (lead.phone?.trim()) patch.intake_phone_collected = true;
  if (lead.email?.trim()) patch.intake_email_collected = true;
  if (lead.service_address?.trim()) patch.intake_address_collected = true;

  if (Object.keys(patch).length === 0) return lead;
  return updateLeadIntake({ ...params, patch });
}

export async function appendVoiceTranscriptTurns(params: {
  leadId: string;
  parsed: ParsedVapiCall;
}): Promise<void> {
  const conversation = await getConversationByLeadId(params.leadId);
  if (!conversation) return;

  const durationLabel = formatCallDuration(params.parsed.durationSeconds);
  const header = `Inbound phone call (${durationLabel})${
    params.parsed.summary ? `: ${params.parsed.summary}` : ""
  }`;

  await appendTranscript(conversation.id, {
    role: "system",
    content: header,
    channel: "voice",
  });

  const transcript = params.parsed.transcript?.trim();
  if (!transcript) return;

  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(Customer|Assistant):\s*(.+)$/i);
    if (!match) continue;

    await appendTranscript(conversation.id, {
      role: match[1].toLowerCase() === "customer" ? "user" : "assistant",
      content: match[2].trim(),
      channel: "voice",
    });
  }
}

export async function finalizeVoiceCallBooking(params: {
  orgId: string;
  leadId: string;
  parsed: ParsedVapiCall;
}): Promise<{ reply: string; paymentUrl?: string } | null> {
  const transcript = params.parsed.transcript?.trim();
  if (!transcript) return null;

  const paidState = await loadLeadBookingPaymentState({
    orgId: params.orgId,
    leadId: params.leadId,
  });
  if (paidState.isPaid) {
    return {
      reply:
        paidState.paidReply ??
        "Your deposit is confirmed and your appointment is locked in.",
    };
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("services_scope")
    .eq("id", params.orgId)
    .single();

  const servicesScope =
    org?.services_scope?.trim() ||
    "Configure services scope in dashboard settings.";

  let lead = await syncLeadIntakeFromUserMessage({
    orgId: params.orgId,
    leadId: params.leadId,
    userMessage: transcript,
    servicesScope,
  });

  const inferredEmail = inferVoiceEmail(transcript, params.parsed.summary);
  if (inferredEmail && inferredEmail !== lead.email?.trim()) {
    lead = await updateLeadIntake({
      orgId: params.orgId,
      leadId: params.leadId,
      patch: { email: inferredEmail, intake_email_collected: true },
    });
  }

  lead = await markVoiceIntakeCollectedFlags({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  if (lead.appointment_reason?.trim() && !lead.scope_confirmed) {
    try {
      await runServiceScopeVerification({
        orgId: params.orgId,
        leadId: params.leadId,
        appointmentReason: lead.appointment_reason,
      });
    } catch (err) {
      console.error("[vapi/voice-booking] scope verification failed", err);
    }
  }

  lead = await loadLeadIntakeRecord({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  if (voiceTranscriptShowsConfirmation(transcript) && isBookingReady(lead)) {
    try {
      lead = await confirmLeadContact({
        orgId: params.orgId,
        leadId: params.leadId,
      });
    } catch (err) {
      console.error("[vapi/voice-booking] contact confirmation failed", err);
    }
  }

  const booking = await tryAutoFinalizeBooking({
    orgId: params.orgId,
    leadId: params.leadId,
    userMessage: transcript,
    messages: [],
    servicesScope,
  });

  let reply =
    booking.suggestedReply ??
    booking.confirmationMessage ??
    "";

  if (!reply && booking.appointment && !booking.paymentUrl) {
    reply =
      "Your appointment time is reserved. We'll send your deposit payment link shortly.";
  }

  if (!reply && !booking.appointment) {
    const latest = await loadLeadIntakeRecord({
      orgId: params.orgId,
      leadId: params.leadId,
    });
    const missing = getMissingBookingFields(latest);
    reply =
      missing.length > 0
        ? `Thanks for your call. We're finishing your booking — we still need: ${missing.join(", ")}.`
        : "Thanks for your call. We're processing your appointment request and will follow up shortly.";
  }

  const paymentUrl = booking.paymentUrl;
  if (paymentUrl) {
    reply = applyPaymentUrlToReply(reply, paymentUrl);
  }

  const conversation = await getConversationByLeadId(params.leadId);
  if (conversation && reply.trim()) {
    await appendTranscript(conversation.id, {
      role: "assistant",
      content: reply.trim(),
      channel: "voice",
    });
  }

  const { data: leadRow } = await admin
    .from("leads")
    .select("phone")
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .single();

  if (leadRow?.phone?.trim() && reply.trim()) {
    try {
      await sendSms({
        to: leadRow.phone,
        body: reply.trim(),
        orgId: params.orgId,
      });
    } catch (err) {
      console.error("[vapi/voice-booking] SMS delivery failed", err);
    }
  }

  return { reply: reply.trim(), paymentUrl };
}
