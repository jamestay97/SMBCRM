import { normalizePhone } from "@/lib/leads/duplicates";
import { normalizeStoredPhoneNumber, resolveOrgByPhoneNumber } from "@/lib/jobs/enqueue";
import { phoneLookupKeys, toE164 } from "@/lib/twilio/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TenantPhoneNumber } from "@/types/database";

export async function findPhoneOwnerOrgId(
  phoneNumber: string
): Promise<string | null> {
  const tenant = await resolveOrgByPhoneNumber(phoneNumber);
  return tenant?.orgId ?? null;
}

export async function getTenantPrimaryPhone(
  orgId: string
): Promise<TenantPhoneNumber | null> {
  const admin = createAdminClient();

  const { data: primary } = await admin
    .from("tenant_phone_numbers")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();

  if (primary) return primary as TenantPhoneNumber;

  const { data: fallback } = await admin
    .from("tenant_phone_numbers")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (fallback as TenantPhoneNumber | null) ?? null;
}

export async function assignTenantPrimaryPhone(params: {
  orgId: string;
  phoneNumber: string;
  channel?: "sms" | "voice" | "both";
  twilioSid?: string | null;
}): Promise<TenantPhoneNumber> {
  const admin = createAdminClient();
  const normalized = normalizeStoredPhoneNumber(params.phoneNumber);
  const channel = params.channel ?? "both";

  const ownerOrgId = await findPhoneOwnerOrgId(normalized);
  if (ownerOrgId && ownerOrgId !== params.orgId) {
    throw new Error("PHONE_IN_USE");
  }

  const { data: orgPhones } = await admin
    .from("tenant_phone_numbers")
    .select("*")
    .eq("org_id", params.orgId);

  const targetDigits = normalizePhone(normalized);
  const existingForOrg = (orgPhones ?? []).find(
    (row) => normalizePhone(row.phone_number) === targetDigits
  );

  await admin
    .from("tenant_phone_numbers")
    .update({ is_primary: false })
    .eq("org_id", params.orgId);

  if (existingForOrg) {
    const { data, error } = await admin
      .from("tenant_phone_numbers")
      .update({
        phone_number: normalized,
        is_primary: true,
        channel,
        ...(params.twilioSid !== undefined
          ? { twilio_sid: params.twilioSid }
          : {}),
      })
      .eq("id", existingForOrg.id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update phone number");
    }

    return data as TenantPhoneNumber;
  }

  const keys = phoneLookupKeys(normalized);
  const { data: globalMatch } = await admin
    .from("tenant_phone_numbers")
    .select("id, org_id, phone_number")
    .in("phone_number", keys)
    .limit(1)
    .maybeSingle();

  if (globalMatch && globalMatch.org_id !== params.orgId) {
    throw new Error("PHONE_IN_USE");
  }

  const { data, error } = await admin
    .from("tenant_phone_numbers")
    .insert({
      org_id: params.orgId,
      phone_number: normalized,
      channel,
      is_primary: true,
      twilio_sid: params.twilioSid ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      throw new Error("PHONE_IN_USE");
    }
    throw new Error(error?.message ?? "Failed to save phone number");
  }

  return data as TenantPhoneNumber;
}

export function formatPhoneInput(value: string): string {
  return toE164(value.trim());
}
