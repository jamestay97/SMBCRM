import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export function slugifyBusinessName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return base || "business";
}

export async function generateUniquePublicSlug(
  businessName: string,
  excludeOrgId?: string
): Promise<string> {
  const admin = createAdminClient();
  const base = slugifyBusinessName(businessName);

  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate =
      attempt === 0 ? base : `${base}-${attempt + 1}`.slice(0, 56);

    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("public_slug", candidate)
      .maybeSingle();

    if (!data || data.id === excludeOrgId) {
      return candidate;
    }
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

export async function ensureOrganizationPublicSlug(
  orgId: string,
  businessName: string
): Promise<string> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("public_slug")
    .eq("id", orgId)
    .maybeSingle();

  if (org?.public_slug) {
    return org.public_slug;
  }

  const slug = await generateUniquePublicSlug(businessName, orgId);

  await admin
    .from("organizations")
    .update({ public_slug: slug })
    .eq("id", orgId);

  return slug;
}
