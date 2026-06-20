import { createClient } from "@/lib/supabase/server";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export async function getUserOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("org_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load organization membership: ${error.message}`);
  }

  if (!membership?.org_id) return null;

  if (!isValidUuid(membership.org_id)) {
    throw new Error(
      `Invalid organization link on your account (org_id="${membership.org_id}"). ` +
        "Run the fix in Supabase SQL Editor — see supabase/fix_org_membership.sql"
    );
  }

  return membership.org_id;
}

export async function getUserOrgMembership(): Promise<{
  orgId: string;
  role: "owner" | "admin" | "member";
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership, error } = await supabase
    .from("organization_members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load organization membership: ${error.message}`);
  }

  if (!membership?.org_id) return null;

  if (!isValidUuid(membership.org_id)) {
    throw new Error(
      `Invalid organization link on your account (org_id="${membership.org_id}"). ` +
        "Run the fix in Supabase SQL Editor — see supabase/fix_org_membership.sql"
    );
  }

  return { orgId: membership.org_id, role: membership.role };
}
