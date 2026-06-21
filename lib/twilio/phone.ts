import { normalizePhone } from "@/lib/leads/duplicates";
import { createAdminClient } from "@/lib/supabase/admin";

/** Normalize to E.164 for Twilio (US default when 10 digits). */
export function toE164(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;

  const digits = normalizePhone(trimmed);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 0) return `+${digits}`;

  return trimmed;
}

export function phoneLookupKeys(phone: string): string[] {
  const trimmed = phone.trim();
  const e164 = toE164(trimmed);
  const digits = normalizePhone(trimmed);
  return [...new Set([trimmed, e164, `+1${digits}`, digits, `+${digits}`])].filter(
    Boolean
  );
}

export async function getTenantOutboundNumber(
  orgId: string
): Promise<string | null> {
  const admin = createAdminClient();

  const { data: primary } = await admin
    .from("tenant_phone_numbers")
    .select("phone_number")
    .eq("org_id", orgId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();

  if (primary?.phone_number) {
    return toE164(primary.phone_number);
  }

  const { data: fallback } = await admin
    .from("tenant_phone_numbers")
    .select("phone_number")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallback?.phone_number) {
    return toE164(fallback.phone_number);
  }

  const envFrom = process.env.TWILIO_FROM_NUMBER?.trim();
  return envFrom ? toE164(envFrom) : null;
}

export function twilioSmsConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
      process.env.TWILIO_AUTH_TOKEN?.trim()
  );
}
