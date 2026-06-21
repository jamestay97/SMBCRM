import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LeadStatusBadge } from "@/components/leads/lead-status-badge";
import { LeadEditForm } from "@/components/leads/lead-edit-form";
import { LeadDetailActions } from "@/components/leads/lead-detail-actions";
import { WebchatPanel } from "@/components/leads/webchat-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import type {
  AiConversation,
  Appointment,
  Lead,
  Payment,
  TranscriptEntry,
} from "@/types/database";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { payment?: string };
}) {
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!lead) notFound();

  const typedLead = lead as Lead;

  const { data: conversation } = await supabase
    .from("ai_conversations")
    .select("*")
    .eq("lead_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("lead_id", params.id)
    .order("created_at", { ascending: false });

  const { data: appointments } = await supabase
    .from("appointments")
    .select("*")
    .eq("lead_id", params.id)
    .order("starts_at", { ascending: false });

  const typedConversation = conversation as AiConversation | null;
  const typedPayments = (payments ?? []) as Payment[];
  const typedAppointments = (appointments ?? []) as Appointment[];
  const transcript = (typedConversation?.transcript_json ?? []) as TranscriptEntry[];
  const hasPaidPayment = typedPayments.some((p) => p.status === "succeeded");
  const hasConfirmedAppointment = typedAppointments.some(
    (a) => a.status === "confirmed"
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 md:min-h-[calc(100dvh-4rem)]">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{typedLead.name}</h1>
          <p className="text-muted-foreground">
            {typedLead.phone ?? typedLead.email} · Created {formatDate(typedLead.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LeadStatusBadge status={typedLead.status} />
          <LeadDetailActions leadId={typedLead.id} leadName={typedLead.name} />
        </div>
      </div>

      {(searchParams.payment === "success" || hasPaidPayment) && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Payment received — this lead is locked in
          {hasConfirmedAppointment ? " and the calendar appointment is marked paid" : ""}.
        </div>
      )}

      {searchParams.payment === "cancelled" && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Payment was cancelled. The lead can try again from the webchat when ready.
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-3">
        <div className="flex min-h-0 flex-col lg:col-span-2">
          <h2 className="mb-3 shrink-0 text-lg font-semibold">Webchat simulator</h2>
          <WebchatPanel leadId={typedLead.id} transcript={transcript} />
        </div>

        <div className="space-y-4 overflow-y-auto lg:max-h-full">
          <LeadEditForm lead={typedLead} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer intake</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="font-medium">Name:</span>{" "}
                {[typedLead.first_name, typedLead.last_name]
                  .filter(Boolean)
                  .join(" ") || typedLead.name}
              </p>
              <p>
                <span className="font-medium">Phone:</span>{" "}
                {typedLead.phone ?? "—"}
              </p>
              <p>
                <span className="font-medium">Email:</span>{" "}
                {typedLead.email ?? "—"}
              </p>
              <p>
                <span className="font-medium">Reason:</span>{" "}
                {typedLead.appointment_reason ?? typedLead.intent ?? "—"}
              </p>
              <p>
                <span className="font-medium">In scope:</span>{" "}
                {typedLead.scope_confirmed ? "Yes" : "Not yet"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Appointments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {typedAppointments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No appointments yet.</p>
              ) : (
                typedAppointments.map((appointment) => (
                  <div key={appointment.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">
                      {formatDate(appointment.starts_at)}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge
                        variant={
                          appointment.status === "confirmed" ? "default" : "secondary"
                        }
                      >
                        {appointment.status === "confirmed"
                          ? "Paid"
                          : appointment.status === "pending_payment"
                            ? "Pending payment"
                            : appointment.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {typedPayments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments yet.</p>
              ) : (
                typedPayments.map((payment) => (
                  <div key={payment.id} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">{formatCurrency(payment.amount_paid)}</p>
                    <Badge
                      variant={payment.status === "succeeded" ? "default" : "secondary"}
                      className="mt-1 capitalize"
                    >
                      {payment.status === "succeeded" ? "Paid" : payment.status}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integrations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">Twilio SMS:</span>
                <br />
                POST /api/twilio/inbound
              </p>
              <p>
                <span className="font-medium text-foreground">Legacy SMS (org id):</span>
                <br />
                POST /api/twilio/{typedLead.org_id}/inbound
              </p>
              <p>
                <span className="font-medium text-foreground">Vapi voice:</span>
                <br />
                POST /api/vapi/{typedLead.org_id}/webhook
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
