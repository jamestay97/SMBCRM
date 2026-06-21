import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function AdminOverviewPage() {
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

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Platform overview</h1>
          <p className="text-muted-foreground">
            Manage tenants, subscriptions, and inbound SLA performance.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/tenants/new">Onboard tenant</Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Tenants</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{tenantCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total leads</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{leadCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Queued jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{queuedJobs ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">SLA breached</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-amber-600">{breachedJobs ?? 0}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
