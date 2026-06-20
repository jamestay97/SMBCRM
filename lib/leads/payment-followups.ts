import { llmChat } from "@/lib/llm/chat";
import type { LlmProvider } from "@/types/database";
import {
  appendTranscript,
  getConversationByLeadId,
} from "@/lib/ollama/conversations";
import { formatDepositAmount } from "@/lib/calendar/format-appointment";
import { resolveOrgLlmConfig } from "@/lib/llm/org-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio/client";
import type { PaymentFollowupStatus } from "@/types/database";

export const PAYMENT_FOLLOWUP_DELAYS_MS = [
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

const FOLLOWUP_LABELS = ["first", "second", "third"] as const;

function twilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
  );
}

export async function schedulePaymentFollowups(params: {
  orgId: string;
  leadId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const baseTime = Date.now();

  await admin
    .from("lead_payment_followups")
    .update({ status: "cancelled" as PaymentFollowupStatus })
    .eq("lead_id", params.leadId)
    .eq("org_id", params.orgId)
    .eq("status", "pending");

  const rows = PAYMENT_FOLLOWUP_DELAYS_MS.map((delayMs, index) => ({
    org_id: params.orgId,
    lead_id: params.leadId,
    followup_step: index + 1,
    scheduled_at: new Date(baseTime + delayMs).toISOString(),
    status: "pending" as PaymentFollowupStatus,
  }));

  const { error } = await admin.from("lead_payment_followups").upsert(rows, {
    onConflict: "lead_id,followup_step",
  });

  if (error) {
    throw new Error(`Failed to schedule payment follow-ups: ${error.message}`);
  }
}

export async function cancelPaymentFollowups(params: {
  orgId: string;
  leadId: string;
}): Promise<void> {
  const admin = createAdminClient();

  await admin
    .from("lead_payment_followups")
    .update({ status: "cancelled" as PaymentFollowupStatus })
    .eq("lead_id", params.leadId)
    .eq("org_id", params.orgId)
    .eq("status", "pending");
}

async function getPaymentUrl(params: {
  orgId: string;
  leadId: string;
}): Promise<{ paymentUrl: string; amountCents: number }> {
  const admin = createAdminClient();

  const { data: payment } = await admin
    .from("payments")
    .select("checkout_url, amount_paid")
    .eq("lead_id", params.leadId)
    .eq("org_id", params.orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (payment?.checkout_url) {
    return {
      paymentUrl: payment.checkout_url,
      amountCents: payment.amount_paid,
    };
  }

  const { createDepositPayment } = await import("@/lib/stripe/create-deposit-payment");
  const refreshed = await createDepositPayment({
    orgId: params.orgId,
    leadId: params.leadId,
    scheduleFollowups: false,
  });

  return {
    paymentUrl: refreshed.paymentUrl,
    amountCents: refreshed.amountCents,
  };
}

async function generateFollowUpMessage(params: {
  businessName: string;
  leadName: string;
  followupStep: number;
  paymentUrl: string;
  amountCents: number;
  model?: string;
  baseUrl?: string;
  provider?: LlmProvider;
  apiKey?: string | null;
}): Promise<string> {
  const attempt = FOLLOWUP_LABELS[params.followupStep - 1] ?? "follow-up";
  const deposit = formatDepositAmount(params.amountCents);
  const fallback =
    `Hi ${params.leadName}, this is ${params.businessName} following up on your appointment deposit (${deposit}). ` +
    `Pay here to lock in your spot: ${params.paymentUrl}`;

  try {
    const response = await llmChat({
      model: params.model,
      baseUrl: params.baseUrl,
      provider: params.provider,
      apiKey: params.apiKey,
      messages: [
        {
          role: "system",
          content:
            "You write short, friendly SMS payment reminders for a home-services business. " +
            "One or two sentences. Include the payment link exactly as provided. No JSON.",
        },
        {
          role: "user",
          content:
            `Write the ${attempt} payment reminder for ${params.leadName} at ${params.businessName}. ` +
            `Deposit: ${deposit}. Payment link: ${params.paymentUrl}`,
        },
      ],
    });

    const content = response.message.content.trim();
    if (!content || !content.includes(params.paymentUrl)) {
      return fallback;
    }

    return content;
  } catch {
    return fallback;
  }
}

async function sendFollowUp(params: {
  orgId: string;
  leadId: string;
  followupStep: number;
}): Promise<string> {
  const admin = createAdminClient();

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id, name, phone, status, org_id")
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .single();

  if (leadError || !lead) {
    throw new Error(`Lead not found: ${leadError?.message}`);
  }

  if (lead.status !== "payment_pending") {
    throw new Error("Lead is no longer awaiting payment");
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select(
      "business_name, ai_system_prompt, llm_provider, llm_model, llm_api_key_encrypted, sla_target_seconds"
    )
    .eq("id", params.orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization not found: ${orgError?.message}`);
  }

  const llmConfig = resolveOrgLlmConfig(org);
  const { paymentUrl, amountCents } = await getPaymentUrl({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const message = await generateFollowUpMessage({
    businessName: org.business_name,
    leadName: lead.name,
    followupStep: params.followupStep,
    paymentUrl,
    amountCents,
    model: llmConfig.model,
    baseUrl: llmConfig.baseUrl,
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
  });

  const conversation = await getConversationByLeadId(params.leadId);
  if (conversation) {
    await appendTranscript(conversation.id, {
      role: "assistant",
      content: message,
      channel: lead.phone ? "sms" : "webchat",
    });
  }

  if (lead.phone && twilioConfigured()) {
    try {
      await sendSms({ to: lead.phone, body: message });
    } catch (err) {
      console.error("[payment-followups] SMS failed", err);
    }
  }

  return message;
}

export async function processDuePaymentFollowups(
  limit = 20
): Promise<number> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: followups, error } = await admin
    .from("lead_payment_followups")
    .select("id, org_id, lead_id, followup_step")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load payment follow-ups: ${error.message}`);
  }

  if (!followups?.length) return 0;

  let processed = 0;

  for (const followup of followups) {
    const { data: lead } = await admin
      .from("leads")
      .select("status")
      .eq("id", followup.lead_id)
      .eq("org_id", followup.org_id)
      .maybeSingle();

    if (!lead || lead.status !== "payment_pending") {
      await admin
        .from("lead_payment_followups")
        .update({ status: "skipped" as PaymentFollowupStatus })
        .eq("id", followup.id);
      continue;
    }

    try {
      const messageBody = await sendFollowUp({
        orgId: followup.org_id,
        leadId: followup.lead_id,
        followupStep: followup.followup_step,
      });

      await admin
        .from("lead_payment_followups")
        .update({
          status: "sent" as PaymentFollowupStatus,
          sent_at: new Date().toISOString(),
          message_body: messageBody,
        })
        .eq("id", followup.id);

      processed += 1;
    } catch (err) {
      console.error("[payment-followups] send failed", followup.id, err);
    }
  }

  return processed;
}
