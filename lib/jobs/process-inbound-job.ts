import { createAdminClient } from "@/lib/supabase/admin";
import { isPlausibleInferredName } from "@/lib/leads/infer-contact";
import { extractLeadEntities } from "@/lib/llm/extract-entities";
import { resolveOrgLlmConfig } from "@/lib/llm/org-config";
import { handleInboundMessage, ingestLead } from "@/lib/leads/ingest";
import { findLeadByPhone } from "@/lib/leads/ingest";
import { sendSms } from "@/lib/twilio/client";
import type { InboundJob, InboundJobPayload, Organization } from "@/types/database";

export async function processInboundJob(jobId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: job, error: fetchError } = await admin
    .from("inbound_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchError || !job) {
    throw new Error(`Job not found: ${fetchError?.message}`);
  }

  const typedJob = job as InboundJob;
  if (typedJob.status !== "queued") {
    return;
  }

  const now = new Date().toISOString();

  await admin
    .from("inbound_jobs")
    .update({ status: "processing", started_at: now })
    .eq("id", jobId)
    .eq("status", "queued");

  const payload = typedJob.payload_json as InboundJobPayload;

  try {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("*")
      .eq("id", typedJob.org_id)
      .single();

    if (orgError || !org) {
      throw new Error(`Organization not found: ${orgError?.message}`);
    }

    const typedOrg = org as Organization;

    if (typedOrg.status === "suspended") {
      throw new Error("Organization is suspended");
    }

    const llmConfig = resolveOrgLlmConfig(typedOrg);
    const message = payload.body ?? payload.transcript ?? "";

    if (!message) {
      throw new Error("Job payload missing message body");
    }

    const extracted = await extractLeadEntities({
      message,
      fromPhone: payload.from,
      model: llmConfig.model,
      baseUrl: llmConfig.baseUrl,
      provider: llmConfig.provider,
      apiKey: llmConfig.apiKey,
    });

    let leadId = typedJob.lead_id;
    let reply: string;
    let paymentUrl: string | undefined;

    const existingLead = payload.from
      ? await findLeadByPhone(typedJob.org_id, payload.from)
      : null;

    if (existingLead) {
      leadId = existingLead.id;

      await admin
        .from("leads")
        .update({
          ...(extracted.first_name &&
          extracted.last_name &&
          isPlausibleInferredName(extracted.first_name, extracted.last_name)
            ? {
                first_name: extracted.first_name,
                last_name: extracted.last_name,
              }
            : {}),
          intent: extracted.intent,
          appointment_reason: extracted.intent,
          extracted_json: extracted,
        })
        .eq("id", leadId);

      const result = await handleInboundMessage({
        orgId: typedJob.org_id,
        leadId,
        message,
        channel: typedJob.channel,
        deliverViaSms: false,
      });

      reply = result.reply;
      paymentUrl = result.paymentUrl;
    } else {
      const created = await ingestLead({
        orgId: typedJob.org_id,
        name: extracted.name ?? payload.from ?? "Unknown",
        phone: extracted.phone ?? payload.from,
        email: extracted.email ?? undefined,
        initialMessage: message,
        channel: typedJob.channel,
        sendOutboundSms: false,
        source: typedJob.channel,
        extracted,
      });

      leadId = created.leadId;
      reply = created.assistantReply;
      paymentUrl = created.paymentUrl;
    }

    const responseAt = new Date().toISOString();
    const slaMet = new Date(responseAt) <= new Date(typedJob.sla_deadline_at);

    await admin
      .from("leads")
      .update({
        first_response_at: responseAt,
        sla_met: slaMet,
      })
      .eq("id", leadId);

    if (typedJob.channel === "sms" || typedJob.channel === "voice") {
      if (payload.from) {
        const smsBody = paymentUrl
          ? `${reply}\n\nPay your deposit: ${paymentUrl}`
          : reply;
        await sendSms({
          to: payload.from,
          body: smsBody,
          orgId: typedJob.org_id,
        });
      }
    }

    const finalStatus = slaMet ? "completed" : "sla_breached";

    await admin
      .from("inbound_jobs")
      .update({
        status: finalStatus,
        lead_id: leadId,
        completed_at: responseAt,
        result_json: { reply, payment_url: paymentUrl ?? null, sla_met: slaMet },
      })
      .eq("id", jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed";
    await admin
      .from("inbound_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", jobId);

    throw err;
  }
}

export async function processQueuedJobs(limit = 10): Promise<number> {
  const admin = createAdminClient();

  const { data: jobs } = await admin
    .from("inbound_jobs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!jobs?.length) return 0;

  let processed = 0;
  for (const job of jobs) {
    try {
      await processInboundJob(job.id);
      processed += 1;
    } catch (err) {
      console.error("[processQueuedJobs] job failed", job.id, err);
    }
  }

  return processed;
}
