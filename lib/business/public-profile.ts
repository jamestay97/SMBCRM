import { parseServiceTerms } from "@/lib/leads/verify-scope";
import { getTenantInboundAccess } from "@/lib/tenant/access";
import { toE164 } from "@/lib/twilio/phone";
import { createAdminClient } from "@/lib/supabase/admin";

export type PublicBusinessProfile = {
  id: string;
  business_name: string;
  public_slug: string;
  services_scope: string;
  services: string[];
  phone_e164: string | null;
  phone_display: string | null;
  deposit_amount_cents: number;
};

export function formatPhoneForDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return e164;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadOrganizationRecord(identifier: {
  slug?: string;
  orgId?: string;
}) {
  const admin = createAdminClient();
  let query = admin
    .from("organizations")
    .select(
      "id, business_name, public_slug, services_scope, deposit_amount_cents, status"
    );

  if (identifier.orgId) {
    query = query.eq("id", identifier.orgId);
  } else if (identifier.slug) {
    if (UUID_RE.test(identifier.slug)) {
      query = query.eq("id", identifier.slug);
    } else {
      query = query.eq("public_slug", identifier.slug);
    }
  } else {
    return null;
  }

  const { data: org } = await query.maybeSingle();
  if (!org || org.status !== "active") return null;

  const access = await getTenantInboundAccess(org.id);
  if (!access.allowed) return null;

  const { data: phones } = await admin
    .from("tenant_phone_numbers")
    .select("phone_number, is_primary, channel")
    .eq("org_id", org.id)
    .order("is_primary", { ascending: false });

  const primary =
    phones?.find((p) => p.is_primary) ??
    phones?.find((p) => p.channel === "both" || p.channel === "sms") ??
    phones?.[0];

  const phone_e164 = primary?.phone_number
    ? toE164(primary.phone_number)
    : null;

  const services_scope =
    org.services_scope?.trim() ||
    "Home repair and maintenance services. Contact us to schedule.";

  return {
    id: org.id,
    business_name: org.business_name,
    public_slug: org.public_slug ?? org.id,
    services_scope,
    services: parseServiceTerms(services_scope),
    phone_e164,
    phone_display: phone_e164 ? formatPhoneForDisplay(phone_e164) : null,
    deposit_amount_cents: org.deposit_amount_cents,
  } satisfies PublicBusinessProfile;
}

export async function getPublicBusinessBySlug(
  slug: string
): Promise<PublicBusinessProfile | null> {
  return loadOrganizationRecord({ slug });
}

export function buildCustomerPagePath(slug: string): string {
  return `/b/${slug}`;
}

export function buildSmsHref(phoneE164: string, businessName: string): string {
  const body = encodeURIComponent(
    `Hi ${businessName}, I'd like to schedule a service.`
  );
  return `sms:${phoneE164}?body=${body}`;
}

export function buildTelHref(phoneE164: string): string {
  return `tel:${phoneE164}`;
}
