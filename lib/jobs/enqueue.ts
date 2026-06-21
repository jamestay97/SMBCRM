import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/leads/duplicates";
import { phoneLookupKeys, toE164 } from "@/lib/twilio/phone";
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
  const keys = phoneLookupKeys(phoneNumber);

  const { data } = await admin
    .from("tenant_phone_numbers")
    .select("id, org_id, phone_number")
    .in("phone_number", keys)
    .limit(1)
    .maybeSingle();

  if (data) {
    return { orgId: data.org_id, phoneRecordId: data.id };
  }

  const targetDigits = normalizePhone(phoneNumber);
  const { data: allPhones } = await admin
    .from("tenant_phone_numbers")
    .select("id, org_id, phone_number");

  for (const row of allPhones ?? []) {
    if (normalizePhone(row.phone_number) === targetDigits) {
      return { orgId: row.org_id, phoneRecordId: row.id };
    }
  }

  return null;
}

export function normalizeStoredPhoneNumber(phoneNumber: string): string {
  return toE164(phoneNumber);
}
