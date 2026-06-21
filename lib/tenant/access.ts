import { createAdminClient } from "@/lib/supabase/admin";

const BLOCKED_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "suspended",
  "past_due",
]);

export type TenantInboundAccess = {
  allowed: boolean;
  reason?: "not_found" | "suspended" | "subscription";
  slaTargetSeconds: number;
};

export async function getTenantInboundAccess(
  orgId: string
): Promise<TenantInboundAccess> {
  const admin = createAdminClient();

  const { data: org, error } = await admin
    .from("organizations")
    .select("status, sla_target_seconds")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !org) {
    return { allowed: false, reason: "not_found", slaTargetSeconds: 300 };
  }

  if (org.status === "suspended") {
    return {
      allowed: false,
      reason: "suspended",
      slaTargetSeconds: org.sla_target_seconds ?? 300,
    };
  }

  const { data: sub } = await admin
    .from("tenant_subscriptions")
    .select("status")
    .eq("org_id", orgId)
    .maybeSingle();

  if (sub && BLOCKED_SUBSCRIPTION_STATUSES.has(sub.status)) {
    return {
      allowed: false,
      reason: "subscription",
      slaTargetSeconds: org.sla_target_seconds ?? 300,
    };
  }

  return {
    allowed: true,
    slaTargetSeconds: org.sla_target_seconds ?? 300,
  };
}
