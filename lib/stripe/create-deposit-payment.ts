import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getCheckoutStripeReferenceId } from "@/lib/stripe/payment-reference";
import { loadLeadBookingPaymentState } from "@/lib/stripe/payment-status";
import {
  buildAppointmentConfirmationMessage,
  formatDepositAmount,
} from "@/lib/calendar/format-appointment";
import { assertLeadReadyForBooking } from "@/lib/leads/intake";
import { schedulePaymentFollowups } from "@/lib/leads/payment-followups";
import { loadLeadIntakeRecord } from "@/lib/leads/intake-actions";
import { sendAppointmentDepositEmail } from "@/lib/email/notify-lead";
import { getAppUrl } from "@/lib/app-url";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Appointment } from "@/types/database";

type CreateDepositPaymentParams = {
  orgId: string;
  leadId: string;
  scheduleFollowups?: boolean;
};

type CreateDepositPaymentResult = {
  paymentUrl: string;
  stripeIntentId: string;
  amountCents: number;
  appointmentId: string;
  appointmentSummary: string;
  confirmationMessage: string;
};

export async function createDepositPayment(
  params: CreateDepositPaymentParams
): Promise<CreateDepositPaymentResult> {
  const admin = createAdminClient();
  const stripe = getStripe();
  const appUrl = getAppUrl();

  const intake = await loadLeadIntakeRecord({
    orgId: params.orgId,
    leadId: params.leadId,
  });
  assertLeadReadyForBooking(intake);

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select(
      "business_name, deposit_amount_cents, stripe_account_id, timezone"
    )
    .eq("id", params.orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization not found: ${orgError?.message}`);
  }

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("id, name, email, status, org_id, appointment_reason, intent")
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .single();

  if (leadError || !lead) {
    throw new Error(`Lead not found: ${leadError?.message}`);
  }

  const { data: pendingAppointment, error: appointmentError } = await admin
    .from("appointments")
    .select("*")
    .eq("org_id", params.orgId)
    .eq("lead_id", params.leadId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (appointmentError) {
    throw new Error(`Failed to load appointment: ${appointmentError.message}`);
  }

  if (!pendingAppointment) {
    throw new Error(
      "No pending appointment found. Call schedule_appointment first, confirm the details with the customer, then create the deposit link."
    );
  }

  const appointment = pendingAppointment as Appointment;
  const timeZone = org.timezone ?? "America/New_York";
  const serviceReason = lead.appointment_reason ?? lead.intent;
  const appointmentSummary = buildAppointmentConfirmationMessage({
    businessName: org.business_name,
    serviceReason,
    startsAt: appointment.starts_at,
    endsAt: appointment.ends_at,
    timeZone,
    depositCents: org.deposit_amount_cents,
  });

  const metadata: Record<string, string> = {
    org_id: params.orgId,
    lead_id: params.leadId,
    appointment_id: appointment.id,
  };

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: org.deposit_amount_cents,
          product_data: {
            name: `${org.business_name} — Appointment Deposit`,
            description: appointmentSummary,
          },
        },
      },
    ],
    payment_intent_data: {
      metadata,
    },
    metadata,
    success_url: `${appUrl}/payment/success?lead_id=${params.leadId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/payment/cancelled?lead_id=${params.leadId}`,
  };

  if (org.stripe_account_id) {
    sessionParams.payment_intent_data = {
      ...sessionParams.payment_intent_data,
      transfer_data: { destination: org.stripe_account_id },
    };
  }

  if (lead.email) {
    sessionParams.customer_email = lead.email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) {
    throw new Error("Stripe Checkout Session did not return a URL");
  }

  const stripeReferenceId = getCheckoutStripeReferenceId(session);

  const { data: existingPaid } = await admin
    .from("payments")
    .select("id, checkout_url, status")
    .eq("org_id", params.orgId)
    .eq("lead_id", params.leadId)
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingPaid) {
    const paidState = await loadLeadBookingPaymentState({
      orgId: params.orgId,
      leadId: params.leadId,
    });
    return {
      paymentUrl: existingPaid.checkout_url ?? session.url,
      stripeIntentId: stripeReferenceId,
      amountCents: org.deposit_amount_cents,
      appointmentId: appointment.id,
      appointmentSummary,
      confirmationMessage:
        paidState.paidReply ??
        `${appointmentSummary} Your deposit is already confirmed.`,
    };
  }

  const { error: paymentError } = await admin.from("payments").insert({
    org_id: params.orgId,
    lead_id: params.leadId,
    stripe_intent_id: stripeReferenceId,
    checkout_session_id: session.id,
    amount_paid: org.deposit_amount_cents,
    status: "pending",
    checkout_url: session.url,
  });

  if (paymentError) {
    throw new Error(`Failed to record payment: ${paymentError.message}`);
  }

  const { error: leadUpdateError } = await admin
    .from("leads")
    .update({ status: "payment_pending" })
    .eq("id", params.leadId)
    .eq("org_id", params.orgId);

  if (leadUpdateError) {
    throw new Error(`Failed to update lead status: ${leadUpdateError.message}`);
  }

  if (params.scheduleFollowups !== false) {
    await schedulePaymentFollowups({
      orgId: params.orgId,
      leadId: params.leadId,
    });
  }

  const confirmationMessage =
    `You're booked on our calendar. ${appointmentSummary} ` +
    `Pay ${formatDepositAmount(org.deposit_amount_cents)} here: ${session.url}`;

  if (lead.email?.trim()) {
    try {
      await sendAppointmentDepositEmail({
        orgId: params.orgId,
        leadId: params.leadId,
        leadEmail: lead.email.trim(),
        leadName: lead.name,
        businessName: org.business_name,
        appointmentSummary,
        depositAmountCents: org.deposit_amount_cents,
        paymentUrl: session.url,
      });
    } catch (err) {
      console.error("[create-deposit-payment] deposit email failed", err);
    }
  }

  return {
    paymentUrl: session.url,
    stripeIntentId: stripeReferenceId,
    amountCents: org.deposit_amount_cents,
    appointmentId: appointment.id,
    appointmentSummary,
    confirmationMessage,
  };
}
