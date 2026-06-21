import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { LeadsTable } from "@/components/leads/leads-table";
import { UnreadMessagesBanner } from "@/components/dashboard/unread-messages-provider";
import type { Lead } from "@/types/database";

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  const leadList = (leads ?? []) as Lead[];

  return (
    <div className="space-y-6">
      <UnreadMessagesBanner />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Leads</h1>
          <p className="text-muted-foreground">
            All leads engaged by your AI sales rep.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard">+ New lead</Link>
        </Button>
      </div>

      <LeadsTable leads={leadList} />
    </div>
  );
}
