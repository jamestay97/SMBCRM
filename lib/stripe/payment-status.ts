import { buildAppointmentConfirmationMessage } from "@/lib/calendar/format-appointment";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Appointment, LeadStatus, PaymentStatus } from "@/types/database";

export type LeadBookingPaymentState = {
  leadStatus: LeadStatus | null;
  paymentStatus: PaymentStatus | null;
  appointmentStatus: Appointment["status"] | null;
  isPaid: boolean;
  confirmedAppointment: Appointment | null;
  paidReply: string | null;
};

export async function loadLeadBookingPaymentState(params: {
  orgId: string;
  leadId: string;
}): Promise<LeadBookingPaymentState> {
  const admin = createAdminClient();

  const [{ data: lead }, { data: payment }, { data: appointment }, { data: org }] =
    await Promise.all([
      admin
        .from("leads")
        .select("status, appointment_reason, intent")
        .eq("id", params.leadId)
        .eq("org_id", params.orgId)
        .maybeSingle(),
      admin
        .from("payments")
        .select("status")
        .eq("lead_id", params.leadId)
        .eq("org_id", params.orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("appointments")
        .select("*")
        .eq("lead_id", params.leadId)
        .eq("org_id", params.orgId)
        .in("status", ["confirmed", "pending_payment"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("organizations")
        .select("business_name, timezone, deposit_amount_cents")
        .eq("id", params.orgId)
        .maybeSingle(),
    ]);

  const confirmedAppointment =
    appointment?.status === "confirmed"
      ? (appointment as Appointment)
      : null;

  const isPaid =
    lead?.status === "locked_in" ||
    payment?.status === "succeeded" ||
    confirmedAppointment !== null;

  let paidReply: string | null = null;
  if (isPaid && confirmedAppointment) {
    paidReply = `${buildAppointmentConfirmationMessage({
      businessName: org?.business_name ?? "Our team",
      serviceReason: lead?.appointment_reason ?? lead?.intent,
      startsAt: confirmedAppointment.starts_at,
      endsAt: confirmedAppointment.ends_at,
      timeZone: org?.timezone ?? "America/New_York",
      depositCents: org?.deposit_amount_cents,
    })} Your deposit is confirmed — you're all set!`;
  } else if (isPaid) {
    paidReply =
      "Your deposit is confirmed and your appointment is locked in. We'll see you soon!";
  }

  return {
    leadStatus: lead?.status ?? null,
    paymentStatus: payment?.status ?? null,
    appointmentStatus: appointment?.status ?? null,
    isPaid,
    confirmedAppointment,
    paidReply,
  };
}
