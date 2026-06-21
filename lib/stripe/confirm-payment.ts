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

async function runHandlePaymentSucceeded(
  stripeIntentId: string,
  amountPaidCents: number
): Promise<PaymentSucceededRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("handle_payment_succeeded", {
    p_stripe_intent_id: stripeIntentId,
    p_amount_paid: amountPaidCents,
  });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as PaymentSucceededRow[];
  return rows[0] ?? null;
}

export async function confirmPaymentSucceeded(params: {
  paymentIntentId: string;
  amountPaidCents: number;
  checkoutSessionId?: string;
  orgId?: string;
  leadId?: string;
}): Promise<ConfirmPaymentResult | null> {
  await linkPendingPaymentToIntent({
    paymentIntentId: params.paymentIntentId,
    checkoutSessionId: params.checkoutSessionId,
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const admin = createAdminClient();

  const lookupIds = [
    params.paymentIntentId,
    ...(params.checkoutSessionId &&
    params.checkoutSessionId !== params.paymentIntentId
      ? [params.checkoutSessionId]
      : []),
  ];

  let existingStatus: string | null = null;
  for (const id of lookupIds) {
    const { data } = await admin
      .from("payments")
      .select("status")
      .eq("stripe_intent_id", id)
      .maybeSingle();
    if (data?.status) {
      existingStatus = data.status;
      break;
    }
  }

  if (!existingStatus && params.checkoutSessionId) {
    const { data } = await admin
      .from("payments")
      .select("status")
      .eq("checkout_session_id", params.checkoutSessionId)
      .maybeSingle();
    existingStatus = data?.status ?? null;
  }

  const isFirstSuccess = existingStatus !== "succeeded";

  let result: PaymentSucceededRow | null = null;
  let lastError: Error | null = null;

  for (const id of lookupIds) {
    try {
      result = await runHandlePaymentSucceeded(id, params.amountPaidCents);
      if (result) break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!lastError.message.includes("not found")) {
        throw lastError;
      }
    }
  }

  if (!result && lastError) {
    console.error("[confirm-payment] handle_payment_succeeded failed", lastError);
    throw lastError;
  }

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
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });

  if (session.payment_status !== "paid") {
    return null;
  }

  const paymentIntentId = getCheckoutPaymentIntentId(session);
  const amountPaidCents =
    session.amount_total ??
    (typeof session.payment_intent === "object"
      ? session.payment_intent?.amount_received
      : null) ??
    0;

  if (!paymentIntentId) {
    return confirmPaymentSucceeded({
      paymentIntentId: session.id,
      amountPaidCents,
      checkoutSessionId: session.id,
      orgId: session.metadata?.org_id,
      leadId: session.metadata?.lead_id,
    });
  }

  return confirmPaymentSucceeded({
    paymentIntentId,
    amountPaidCents,
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
