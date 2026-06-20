"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DeleteLeadButton } from "@/components/leads/delete-lead-button";
import { useDashboardContext } from "@/components/dashboard/dashboard-shell";

export function LeadTableActions({
  leadId,
  leadName,
}: {
  leadId: string;
  leadName: string;
}) {
  const { canManage } = useDashboardContext();

  return (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" asChild>
        <Link href={`/dashboard/leads/${leadId}`}>Edit</Link>
      </Button>
      {canManage && (
        <DeleteLeadButton
          leadId={leadId}
          leadName={leadName}
          size="sm"
          variant="outline"
        />
      )}
    </div>
  );
}
