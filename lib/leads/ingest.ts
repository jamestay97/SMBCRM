import { createAdminClient } from "@/lib/supabase/admin";
import { assertNoDuplicateLead } from "@/lib/leads/duplicates";
import { createConversationForLead } from "@/lib/ollama/conversations";
import { runAssistant } from "@/lib/ollama/run-assistant";
import { resolveOrgLlmConfig } from "@/lib/llm/org-config";
import { sendSms } from "@/lib/twilio/client";
import type { ExtractedLeadEntities, TranscriptEntry } from "@/types/database";

type IngestLeadParams = {
  orgId: string;
  name: string;
  phone?: string;
  email?: string;
  initialMessage?: string;
  channel?: TranscriptEntry["channel"];
  sendOutboundSms?: boolean;
  source?: TranscriptEntry["channel"] | "manual";
  extracted?: ExtractedLeadEntities;
};

type IngestLeadResult = {
  leadId: string;
  conversationId: string;
  sessionId: string;
  assistantReply: string;
  paymentUrl?: string;
};

export async function ingestLead(
  params: IngestLeadParams
): Promise<IngestLeadResult> {
  const admin = createAdminClient();

  if (!params.phone && !params.email) {
    throw new Error("Lead must have a phone number or email");
  }

  await assertNoDuplicateLead({
    orgId: params.orgId,
    phone: params.phone,
    email: params.email,
  });

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("*")
    .eq("id", params.orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization not found: ${orgError?.message}`);
  }

  const llmConfig = resolveOrgLlmConfig(org);

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .insert({
      org_id: params.orgId,
      name: params.name,
      first_name: params.extracted?.first_name ?? null,
      last_name: params.extracted?.last_name ?? null,
      phone: params.phone ?? null,
      email: params.email ?? null,
      status: "new",
      source: params.source ?? params.channel ?? "manual",
      intent: params.extracted?.intent ?? null,
      appointment_reason: params.extracted?.intent ?? null,
      extracted_json: params.extracted ?? {},
    })
    .select("id")
    .single();

  if (leadError || !lead) {
    throw new Error(`Failed to create lead: ${leadError?.message}`);
  }

  const { conversationId, sessionId } = await createConversationForLead({
    orgId: params.orgId,
    leadId: lead.id,
    systemPrompt: org.ai_system_prompt,
    channel: params.channel,
  });

  const userMessage =
    params.initialMessage ??
    `Hi, I'm ${params.name}. I'm interested in learning more about ${org.business_name}.`;

  const { reply, paymentUrl } = await runAssistant({
    conversationId,
    orgId: params.orgId,
    leadId: lead.id,
    systemPrompt: org.ai_system_prompt,
    userMessage,
    channel: params.channel ?? "webchat",
    model: llmConfig.model,
    baseUrl: llmConfig.baseUrl,
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
  });

  if (params.sendOutboundSms && params.phone) {
    try {
      const smsBody = paymentUrl ? `${reply}\n\nPay your deposit: ${paymentUrl}` : reply;
      await sendSms({ to: params.phone, body: smsBody });
    } catch (err) {
      console.error("[ingestLead] SMS delivery failed", err);
    }
  }

  return {
    leadId: lead.id,
    conversationId,
    sessionId,
    assistantReply: reply,
    paymentUrl,
  };
}

export async function handleInboundMessage(params: {
  orgId: string;
  leadId: string;
  message: string;
  channel: TranscriptEntry["channel"];
  deliverViaSms?: boolean;
}): Promise<{ reply: string; paymentUrl?: string }> {
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("*")
    .eq("id", params.orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization not found: ${orgError?.message}`);
  }

  const llmConfig = resolveOrgLlmConfig(org);

  const { data: conversation, error: convError } = await admin
    .from("ai_conversations")
    .select("id")
    .eq("lead_id", params.leadId)
    .eq("org_id", params.orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (convError || !conversation) {
    throw new Error(`Conversation not found: ${convError?.message}`);
  }

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("phone")
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .single();

  if (leadError || !lead) {
    throw new Error(`Lead not found: ${leadError?.message}`);
  }

  const result = await runAssistant({
    conversationId: conversation.id,
    orgId: params.orgId,
    leadId: params.leadId,
    systemPrompt: org.ai_system_prompt,
    userMessage: params.message,
    channel: params.channel,
    model: llmConfig.model,
    baseUrl: llmConfig.baseUrl,
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
  });

  if (params.deliverViaSms && params.channel === "sms" && lead.phone) {
    try {
      const smsBody = result.paymentUrl
        ? `${result.reply}\n\nPay your deposit: ${result.paymentUrl}`
        : result.reply;
      await sendSms({ to: lead.phone, body: smsBody });
    } catch (err) {
      console.error("[handleInboundMessage] SMS delivery failed", err);
    }
  }

  return result;
}

export async function findLeadByPhone(
  orgId: string,
  phone: string
): Promise<{ id: string; name: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("leads")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}
