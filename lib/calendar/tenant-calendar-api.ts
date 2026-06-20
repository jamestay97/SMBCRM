import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantApiContext } from "@/lib/auth/tenant-api";

export async function getAuthorizedTenantContext() {
  const ctx = await getTenantApiContext();
  if (!ctx) return null;
  return ctx;
}

export function getTenantAdminClient() {
  return createAdminClient();
}
