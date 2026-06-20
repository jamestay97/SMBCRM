import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import {
  getCheckoutPaymentIntentId,
  linkPendingPaymentToIntent,
} from "@/lib/stripe/payment-reference";
import { cancelPaymentFollowups } from "@/lib/leads/payment-followups";
import { notifyBusinessOwnerOfDeposit } from "@/lib/alerts/notify-owner";
import { notifyLeadPaymentConfirmed } from "@/lib/email/notify-lead";
import { createAdminClient } from "@/lib/supabase/admin";

export type ConfirmPaymentResult = {
  paymentId: string;
  leadId: string;
  orgId: string;
  leadName: string;
  businessName: string;
  amountPaidCents: number;
  alreadyConfirmed: boolean;
};

type PaymentSucceededRow = {
  payment_id: string;
  lead_id: string;
  org_id: string;
  lead_name: string;
  business_name: string;
};

async function ensurePaymentLinked(params: {
  paymentIntentId: string;
  checkoutSessionId?: string;
  orgId?: string;
  leadId?: string;
}): Promise<void> {
  await linkPendingPaymentToIntent(params);

  const admin = createAdminClient();
  const { data: byIntent } = await admin
    .from("payments")
    .select("id")
    .eq("stripe_intent_id", params.paymentIntentId)
    .maybeSingle();

  if (byIntent) return;

  if (params.checkoutSessionId) {
    const { data: bySession } = await admin
      .from("payments")
      .select("id")
      .eq("stripe_intent_id", params.checkoutSessionId)
      .eq("status", "pending")
      .maybeSingle();

    if (bySession) {
      await admin
        .from("payments")
        .update({ stripe_intent_id: params.paymentIntentId })
        .eq("id", bySession.id)
        .eq("status", "pending");
    }
  }
}

export async function confirmPaymentSucceeded(params: {
  paymentIntentId: string;
  amountPaidCents: number;
  checkoutSessionId?: string;
  orgId?: string;
  leadId?: string;
}): Promise<ConfirmPaymentResult | null> {
  await ensurePaymentLinked({
    paymentIntentId: params.paymentIntentId,
    checkoutSessionId: params.checkoutSessionId,
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const admin = createAdminClient();

  const { data: existingPayment } = await admin
    .from("payments")
    .select("status")
    .eq("stripe_intent_id", params.paymentIntentId)
    .maybeSingle();

  const isFirstSuccess = existingPayment?.status !== "succeeded";

  const { data, error } = await admin.rpc("handle_payment_succeeded", {
    p_stripe_intent_id: params.paymentIntentId,
    p_amount_paid: params.amountPaidCents,
  });

  if (error) {
    console.error("[confirm-payment] handle_payment_succeeded failed", error);
    throw new Error(error.message);
  }

  const rows = (data ?? []) as PaymentSucceededRow[];
  const result = rows[0];
  if (!result) return null;

  if (isFirstSuccess) {
    await cancelPaymentFollowups({
      orgId: result.org_id,
      leadId: result.lead_id,
    });

    await notifyBusinessOwnerOfDeposit({
      orgId: result.org_id,
      leadId: result.lead_id,
      leadName: result.lead_name,
      businessName: result.business_name,
      amountPaidCents: params.amountPaidCents,
      stripeIntentId: params.paymentIntentId,
    });

    await notifyLeadPaymentConfirmed({
      orgId: result.org_id,
      leadId: result.lead_id,
      amountPaidCents: params.amountPaidCents,
    });
  }

  return {
    paymentId: result.payment_id,
    leadId: result.lead_id,
    orgId: result.org_id,
    leadName: result.lead_name,
    businessName: result.business_name,
    amountPaidCents: params.amountPaidCents,
    alreadyConfirmed: !isFirstSuccess,
  };
}

export async function confirmStripeCheckoutSession(
  sessionId: string
): Promise<ConfirmPaymentResult | null> {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== "paid") {
    return null;
  }

  const paymentIntentId = getCheckoutPaymentIntentId(session);
  if (!paymentIntentId) {
    return null;
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  return confirmPaymentSucceeded({
    paymentIntentId: paymentIntent.id,
    amountPaidCents: paymentIntent.amount_received,
    checkoutSessionId: session.id,
    orgId: session.metadata?.org_id,
    leadId: session.metadata?.lead_id,
  });
}

export async function confirmStripePaymentIntent(
  paymentIntent: Stripe.PaymentIntent
): Promise<ConfirmPaymentResult | null> {
  if (paymentIntent.status !== "succeeded") {
    return null;
  }

  return confirmPaymentSucceeded({
    paymentIntentId: paymentIntent.id,
    amountPaidCents: paymentIntent.amount_received,
    orgId: paymentIntent.metadata?.org_id,
    leadId: paymentIntent.metadata?.lead_id,
  });
}
