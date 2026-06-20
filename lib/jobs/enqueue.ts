import { createAdminClient } from "@/lib/supabase/admin";
import type { InboundJobPayload } from "@/types/database";

export async function enqueueInboundJob(params: {
  orgId: string;
  channel: "sms" | "voice" | "webchat";
  payload: InboundJobPayload;
  slaTargetSeconds: number;
}): Promise<string> {
  const admin = createAdminClient();
  const slaDeadline = new Date(
    Date.now() + params.slaTargetSeconds * 1000
  ).toISOString();

  const { data, error } = await admin
    .from("inbound_jobs")
    .insert({
      org_id: params.orgId,
      channel: params.channel,
      payload_json: params.payload,
      sla_deadline_at: slaDeadline,
      status: "queued",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to enqueue job: ${error?.message}`);
  }

  return data.id;
}

export async function resolveOrgByPhoneNumber(
  phoneNumber: string
): Promise<{ orgId: string; phoneRecordId: string } | null> {
  const admin = createAdminClient();
  const normalized = phoneNumber.trim();

  const { data } = await admin
    .from("tenant_phone_numbers")
    .select("id, org_id")
    .eq("phone_number", normalized)
    .maybeSingle();

  if (!data) return null;

  return { orgId: data.org_id, phoneRecordId: data.id };
}
