import {
  applyPaymentUrlToReply,
  formatAlternativesReply,
} from "@/lib/ollama/booking-fallback";
import {
  appendTranscript,
  getConversationByLeadId,
} from "@/lib/ollama/conversations";
import { syncLeadIntakeFromUserMessage } from "@/lib/ollama/intake-sync";
import { getAvailableSlots } from "@/lib/calendar/slots";
import {
  collectDayHints,
  findMatchingAvailableSlot,
  normalizeSpokenClockText,
} from "@/lib/calendar/match-slot";
import { scheduleAppointment } from "@/lib/calendar/schedule";
import {
  buildDisplayName,
  getMissingBookingFields,
  isBookingReady,
  looksLikePersonName,
  type LeadIntakeRecord,
} from "@/lib/leads/intake";
import { isPlausibleInferredName } from "@/lib/leads/infer-contact";
import {
  confirmLeadContact,
  loadLeadIntakeRecord,
  runServiceScopeVerification,
  updateLeadIntake,
} from "@/lib/leads/intake-actions";
import { matchServiceScope } from "@/lib/leads/verify-scope";
import { createDepositPayment } from "@/lib/stripe/create-deposit-payment";
import { loadLeadBookingPaymentState } from "@/lib/stripe/payment-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio/client";
import { formatCallDuration, type ParsedVapiCall } from "@/lib/vapi/parse-call";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const SPOKEN_GMAIL_RE =
  /\b([a-z][a-z0-9]*(?:\s+[a-z0-9]+)*)\s+at\s+gmail\s+dot\s+com\b/gi;

export function inferVoiceNameFromTranscript(
  transcript: string
): { first_name: string; last_name: string } | undefined {
  const lines = transcript
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const previous = lines[i - 1] ?? "";
    if (
      !/^Assistant:/i.test(previous) ||
      !/\b(first and last name|your name|what'?s your name)\b/i.test(previous)
    ) {
      continue;
    }

    const customer = lines[i].match(/^Customer:\s*(.+)$/i);
    if (!customer) continue;

    const answer = customer[1].replace(/[.!?]+$/, "").trim();
    const nameMatch = answer.match(
      /^([A-Za-z][A-Za-z'`-]+)\s+([A-Za-z][A-Za-z'`-]+)/
    );
    if (
      nameMatch?.[1] &&
      nameMatch?.[2] &&
      isPlausibleInferredName(nameMatch[1], nameMatch[2])
    ) {
      return { first_name: nameMatch[1], last_name: nameMatch[2] };
    }
  }

  for (const line of lines) {
    const customer = line.match(
      /^Customer:\s*([A-Za-z][A-Za-z'`-]+)\s+([A-Za-z][A-Za-z'`-]+)\.?\s*$/i
    );
    if (
      customer?.[1] &&
      customer?.[2] &&
      isPlausibleInferredName(customer[1], customer[2])
    ) {
      return { first_name: customer[1], last_name: customer[2] };
    }
  }

  const summaryName = transcript.match(
    /\bfor\s+([A-Za-z][A-Za-z'`-]+)\s+([A-Za-z][A-Za-z'`-]+)\b/i
  );
  if (
    summaryName?.[1] &&
    summaryName?.[2] &&
    isPlausibleInferredName(summaryName[1], summaryName[2])
  ) {
    return { first_name: summaryName[1], last_name: summaryName[2] };
  }

  return undefined;
}

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

  const customerText = transcript
    .split("\n")
    .filter((line) => /^Customer:/i.test(line))
    .join("\n");

  for (const match of customerText.matchAll(SPOKEN_GMAIL_RE)) {
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

async function confirmVoiceServiceScope(params: {
  orgId: string;
  leadId: string;
  servicesScope: string;
}): Promise<LeadIntakeRecord> {
  const lead = await loadLeadIntakeRecord(params);
  if (!lead.appointment_reason?.trim()) return lead;
  if (lead.scope_confirmed && lead.scope_acknowledged) return lead;

  const match = matchServiceScope(lead.appointment_reason, params.servicesScope);
  if (match.match === "in") {
    return updateLeadIntake({
      orgId: params.orgId,
      leadId: params.leadId,
      patch: {
        scope_confirmed: true,
        scope_acknowledged: true,
      },
    });
  }

  try {
    const verified = await runServiceScopeVerification({
      orgId: params.orgId,
      leadId: params.leadId,
      appointmentReason: lead.appointment_reason,
    });
    return verified.lead;
  } catch (err) {
    console.error("[vapi/voice-booking] scope verification failed", err);
    return lead;
  }
}

async function bookVoiceCallAppointment(params: {
  orgId: string;
  leadId: string;
  transcript: string;
  serviceReason?: string | null;
}): Promise<{
  appointment?: Awaited<ReturnType<typeof scheduleAppointment>>;
  paymentUrl?: string;
  confirmationMessage?: string;
  suggestedReply?: string;
}> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", params.orgId)
    .single();

  const timeZone = org?.timezone ?? "America/New_York";
  const schedulingText = normalizeSpokenClockText(params.transcript);
  const slots = await getAvailableSlots({ orgId: params.orgId, daysAhead: 14 });

  if (slots.length === 0) {
    return {
      suggestedReply:
        "Thanks for your call. We don't have any open appointment slots configured yet — our team will follow up to schedule you.",
    };
  }

  const matched = findMatchingAvailableSlot({
    userMessage: schedulingText,
    assistantContext: schedulingText,
    slots,
    timeZone,
    strict: false,
  });

  if (!matched) {
    const dayHints = collectDayHints(schedulingText);
    return {
      suggestedReply: formatAlternativesReply({
        slots,
        dayHints,
        timeZone,
        service: params.serviceReason,
      }),
    };
  }

  try {
    const appointment = await scheduleAppointment({
      orgId: params.orgId,
      leadId: params.leadId,
      startsAt: matched.starts_at,
    });

    try {
      const deposit = await createDepositPayment({
        orgId: params.orgId,
        leadId: params.leadId,
      });
      return {
        appointment,
        paymentUrl: deposit.paymentUrl,
        confirmationMessage: deposit.confirmationMessage,
        suggestedReply: deposit.confirmationMessage,
      };
    } catch (err) {
      console.error("[vapi/voice-booking] deposit creation failed", err);
      return {
        appointment,
        suggestedReply:
          "Your appointment is on the calendar. We couldn't generate the deposit link automatically — our team will send payment details shortly.",
      };
    }
  } catch (err) {
    console.error("[vapi/voice-booking] schedule failed", err);
    const dayHints = collectDayHints(schedulingText);
    return {
      suggestedReply: formatAlternativesReply({
        slots,
        dayHints,
        timeZone,
        service: params.serviceReason,
      }),
    };
  }
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

  const voiceName = inferVoiceNameFromTranscript(transcript);
  if (voiceName) {
    await updateLeadIntake({
      orgId: params.orgId,
      leadId: params.leadId,
      patch: {
        first_name: voiceName.first_name,
        last_name: voiceName.last_name,
        intake_name_collected: true,
        name: buildDisplayName(
          voiceName.first_name,
          voiceName.last_name,
          voiceName.first_name
        ),
      },
    });
  }

  let lead = await syncLeadIntakeFromUserMessage({
    orgId: params.orgId,
    leadId: params.leadId,
    userMessage: transcript,
    servicesScope,
  });

  if (voiceName) {
    lead = await updateLeadIntake({
      orgId: params.orgId,
      leadId: params.leadId,
      patch: {
        first_name: voiceName.first_name,
        last_name: voiceName.last_name,
        intake_name_collected: true,
        name: buildDisplayName(
          voiceName.first_name,
          voiceName.last_name,
          lead.name
        ),
      },
    });
  }

  const inferredEmail = inferVoiceEmail(transcript, params.parsed.summary);
  if (inferredEmail) {
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

  lead = await confirmVoiceServiceScope({
    orgId: params.orgId,
    leadId: params.leadId,
    servicesScope,
  });

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

  lead = await loadLeadIntakeRecord({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const missingBeforeBooking = getMissingBookingFields(lead);
  if (missingBeforeBooking.length > 0) {
    console.warn("[vapi/voice-booking] intake incomplete", {
      leadId: params.leadId,
      missing: missingBeforeBooking,
    });
  }

  const booking = await bookVoiceCallAppointment({
    orgId: params.orgId,
    leadId: params.leadId,
    transcript,
    serviceReason: lead.appointment_reason,
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

  console.info("[vapi/voice-booking] finalized", {
    leadId: params.leadId,
    hasAppointment: Boolean(booking.appointment),
    hasPaymentUrl: Boolean(paymentUrl),
    contactConfirmed: lead.contact_confirmed,
  });

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
