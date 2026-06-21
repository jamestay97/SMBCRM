import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";
import { CreateLeadForm } from "@/components/leads/create-lead-form";
import {
  UnreadLeadDot,
  OverviewUnreadBadge,
  UnreadMessagesBanner,
} from "@/components/dashboard/unread-messages-provider";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { getUserOrgId } from "@/lib/auth/org";
import type { Lead } from "@/types/database";

export default async function DashboardPage() {
  const supabase = await createClient();
  const orgId = await getUserOrgId();

  const { data: org } = orgId
    ? await supabase
        .from("organizations")
        .select("business_name, deposit_amount_cents")
        .eq("id", orgId)
        .single()
    : { data: null };

  const { count: totalLeads } = orgId
    ? await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
    : { count: 0 };

  const { count: pending } = orgId
    ? await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "payment_pending")
    : { count: 0 };

  const { count: lockedIn } = orgId
    ? await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "locked_in")
    : { count: 0 };

  const { data: leads } = orgId
    ? await supabase
        .from("leads")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(5)
    : { data: [] };

  const leadList = (leads ?? []) as Lead[];

  return (
    <div className="space-y-8">
      <UnreadMessagesBanner />

      <div>
        <h1 className="text-3xl font-bold">{org?.business_name ?? "Dashboard"}</h1>
        <p className="text-muted-foreground">
          AI autonomous sales rep — engage leads and collect deposits.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalLeads ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Payment pending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{pending ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Locked in
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{lockedIn ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <CreateLeadForm />
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {leadList.length === 0 ? (
              <p className="text-sm text-muted-foreground">No leads yet.</p>
            ) : (
              leadList.map((lead) => (
                <Link
                  key={lead.id}
                  href={`/dashboard/leads/${lead.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <UnreadLeadDot leadId={lead.id} />
                      {lead.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(lead.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <OverviewUnreadBadge leadId={lead.id} />
                    <LeadStatusBadge status={lead.status} />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
