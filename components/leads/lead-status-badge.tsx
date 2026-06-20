import type { LeadStatus } from "@/types/database";
import { Badge } from "@/components/ui/badge";

const statusConfig: Record<
  LeadStatus,
  { label: string; variant: "default" | "secondary" | "warning" | "success" | "muted" }
> = {
  new: { label: "New", variant: "muted" },
  engaged: { label: "Engaged", variant: "secondary" },
  payment_pending: { label: "Payment Pending", variant: "warning" },
  locked_in: { label: "Locked In", variant: "success" },
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const config = statusConfig[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
