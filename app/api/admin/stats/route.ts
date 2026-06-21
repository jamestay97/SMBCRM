import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await requirePlatformAdmin();
  } catch (err) {
    const code = err instanceof Error ? err.message : "FORBIDDEN";
    return NextResponse.json(
      { error: code === "UNAUTHORIZED" ? "Unauthorized" : "Forbidden" },
      { status: code === "UNAUTHORIZED" ? 401 : 403 }
    );
  }

  const admin = createAdminClient();

  const [
    { count: tenantCount },
    { count: leadCount },
    { count: queuedJobs },
    { count: breachedJobs },
  ] = await Promise.all([
    admin.from("organizations").select("*", { count: "exact", head: true }),
    admin.from("leads").select("*", { count: "exact", head: true }),
    admin
      .from("inbound_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "queued"),
    admin
      .from("inbound_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "sla_breached"),
  ]);

  return NextResponse.json({
    tenants: tenantCount ?? 0,
    leads: leadCount ?? 0,
    queued_jobs: queuedJobs ?? 0,
    sla_breached_jobs: breachedJobs ?? 0,
  });
}
