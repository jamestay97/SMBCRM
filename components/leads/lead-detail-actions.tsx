"use client";

import { DeleteLeadButton } from "@/components/leads/delete-lead-button";
import { useDashboardContext } from "@/components/dashboard/dashboard-shell";

export function LeadDetailActions({
  leadId,
  leadName,
}: {
  leadId: string;
  leadName: string;
}) {
  const { canManage } = useDashboardContext();

  if (!canManage) return null;

  return <DeleteLeadButton leadId={leadId} leadName={leadName} />;
}
