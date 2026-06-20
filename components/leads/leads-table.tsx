"use client";

import Link from "next/link";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeadTableActions } from "@/components/leads/lead-table-actions";
import {
  UnreadLeadDot,
  useUnreadMessages,
} from "@/components/dashboard/unread-messages-provider";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Lead } from "@/types/database";

export function LeadsTable({ leads }: { leads: Lead[] }) {
  const { summary } = useUnreadMessages();

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Messages</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                No leads yet. Create one from the dashboard.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => {
              const unread = summary.byLeadId[lead.id];

              return (
                <TableRow
                  key={lead.id}
                  className={unread ? "bg-amber-50/60" : undefined}
                >
                  <TableCell>
                    <Link
                      href={`/dashboard/leads/${lead.id}`}
                      className="inline-flex items-center gap-2 font-medium hover:underline"
                    >
                      <UnreadLeadDot leadId={lead.id} />
                      {lead.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {lead.phone ?? lead.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    <LeadStatusBadge status={lead.status} />
                  </TableCell>
                  <TableCell>
                    {unread ? (
                      <Badge variant="warning" className="font-normal">
                        {unread.unreadCount} new
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{formatDate(lead.created_at)}</TableCell>
                  <TableCell>
                    <LeadTableActions leadId={lead.id} leadName={lead.name} />
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
