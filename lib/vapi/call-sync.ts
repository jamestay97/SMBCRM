import { findLeadByPhone } from "@/lib/leads/ingest";
import { createConversationForLead } from "@/lib/ollama/conversations";
import { createAdminClient } from "@/lib/supabase/admin";
import type { VoiceCall } from "@/types/database";
import {
  appendVoiceTranscriptTurns,
  finalizeVoiceCallBooking,
} from "@/lib/vapi/voice-booking";
import {
  parseVapiCallPayload,
  voiceCallToRow,
  type ParsedVapiCall,
} from "@/lib/vapi/parse-call";

async function ensureLeadForVoiceCall(params: {
  orgId: string;
  customerPhone: string;
}): Promise<{ id: string; isNew: boolean }> {
  const admin = createAdminClient();
  const existing = await findLeadByPhone(params.orgId, params.customerPhone);

  if (existing) {
    await admin
      .from("leads")
      .update({ status: "engaged", source: "voice" })
      .eq("id", existing.id)
      .eq("status", "new");
    return { id: existing.id, isNew: false };
  }

  const { data: org } = await admin
    .from("organizations")
    .select("ai_system_prompt")
    .eq("id", params.orgId)
    .single();

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      org_id: params.orgId,
      name: params.customerPhone,
      phone: params.customerPhone,
      status: "engaged",
      source: "voice",
    })
    .select("id")
    .single();

  if (error || !lead) {
    throw new Error(`Failed to create lead from voice call: ${error?.message}`);
  }

  await createConversationForLead({
    orgId: params.orgId,
    leadId: lead.id,
    systemPrompt: org?.ai_system_prompt ?? "You are a helpful assistant.",
    channel: "voice",
  });

  return { id: lead.id, isNew: true };
}

async function processVoiceCallBooking(params: {
  orgId: string;
  leadId: string;
  parsed: ParsedVapiCall;
}): Promise<{ reply?: string; paymentUrl?: string } | null> {
  const transcript = params.parsed.transcript?.trim();
  if (!transcript) return null;

  try {
    await appendVoiceTranscriptTurns({
      leadId: params.leadId,
      parsed: params.parsed,
    });
    return await finalizeVoiceCallBooking({
      orgId: params.orgId,
      leadId: params.leadId,
      parsed: params.parsed,
    });
  } catch (err) {
    console.error("[vapi/call-sync] post-call booking failed", err);
    return null;
  }
}

export async function upsertVoiceCall(params: {
  orgId: string;
  parsed: ParsedVapiCall;
  leadId?: string | null;
}): Promise<{ call: VoiceCall; isNewTranscript: boolean }> {
  const admin = createAdminClient();
  let leadId = params.leadId ?? null;

  if (!leadId) {
    const lead = await ensureLeadForVoiceCall({
      orgId: params.orgId,
      customerPhone: params.parsed.customerPhone,
    });
    leadId = lead.id;
  }

  const row = voiceCallToRow(params.orgId, leadId, params.parsed);

  const { data: existing } = await admin
    .from("voice_calls")
    .select("*")
    .eq("vapi_call_id", params.parsed.vapiCallId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await admin
      .from("voice_calls")
      .update({
        lead_id: leadId,
        status: row.status,
        started_at: row.started_at ?? existing.started_at,
        ended_at: row.ended_at ?? existing.ended_at,
        duration_seconds: row.duration_seconds ?? existing.duration_seconds,
        transcript: row.transcript ?? existing.transcript,
        summary: row.summary ?? existing.summary,
        recording_url: row.recording_url ?? existing.recording_url,
        ended_reason: row.ended_reason ?? existing.ended_reason,
        business_phone: row.business_phone ?? existing.business_phone,
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to update voice call: ${error?.message}`);
    }

    const isNewTranscript = Boolean(
      params.parsed.status === "completed" &&
        !existing.transcript &&
        row.transcript
    );

    return { call: data as VoiceCall, isNewTranscript };
  }

  const { data, error } = await admin
    .from("voice_calls")
    .insert(row)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert voice call: ${error?.message}`);
  }

  const isNewTranscript = Boolean(
    params.parsed.status === "completed" && row.transcript
  );

  return { call: data as VoiceCall, isNewTranscript };
}

export async function syncVapiCallEvent(params: {
  orgId: string;
  body: unknown;
  eventType: string;
}): Promise<{
  call: VoiceCall;
  leadId: string;
  booking?: { reply?: string; paymentUrl?: string } | null;
} | null> {
  const parsed = parseVapiCallPayload(params.body, params.eventType);
  if (!parsed) return null;

  const { call, isNewTranscript } = await upsertVoiceCall({
    orgId: params.orgId,
    parsed,
  });

  if (!call.lead_id) {
    throw new Error("Voice call saved without lead_id");
  }

  let booking: { reply?: string; paymentUrl?: string } | null = null;
  if (isNewTranscript) {
    booking = await processVoiceCallBooking({
      orgId: params.orgId,
      leadId: call.lead_id,
      parsed,
    });
  }

  return { call, leadId: call.lead_id, booking };
}
