import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export function getCheckoutPaymentIntentId(
  session: Stripe.Checkout.Session
): string | null {
  if (typeof session.payment_intent === "string") {
    return session.payment_intent;
  }
  return session.payment_intent?.id ?? null;
}

/**
 * Stripe Checkout may not attach a PaymentIntent until the customer starts paying.
 * We store the Checkout Session id (cs_...) until webhook links the real pi_ id.
 */
export function getCheckoutStripeReferenceId(
  session: Stripe.Checkout.Session
): string {
  return getCheckoutPaymentIntentId(session) ?? session.id;
}

async function findPendingPaymentId(params: {
  paymentIntentId?: string;
  checkoutSessionId?: string;
  orgId?: string;
  leadId?: string;
}): Promise<string | null> {
  const admin = createAdminClient();

  if (params.paymentIntentId) {
    const { data } = await admin
      .from("payments")
      .select("id")
      .eq("stripe_intent_id", params.paymentIntentId)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  if (params.checkoutSessionId) {
    const { data: byIntent } = await admin
      .from("payments")
      .select("id")
      .eq("stripe_intent_id", params.checkoutSessionId)
      .eq("status", "pending")
      .maybeSingle();
    if (byIntent?.id) return byIntent.id;

    const { data: bySessionColumn } = await admin
      .from("payments")
      .select("id")
      .eq("checkout_session_id", params.checkoutSessionId)
      .eq("status", "pending")
      .maybeSingle();
    if (bySessionColumn?.id) return bySessionColumn.id;
  }

  if (params.orgId && params.leadId) {
    const { data } = await admin
      .from("payments")
      .select("id")
      .eq("org_id", params.orgId)
      .eq("lead_id", params.leadId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  return null;
}

/** Point a pending payment row at the real PaymentIntent before webhook settlement. */
export async function linkPendingPaymentToIntent(params: {
  paymentIntentId: string;
  checkoutSessionId?: string;
  orgId?: string;
  leadId?: string;
}): Promise<void> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("payments")
    .select("id")
    .eq("stripe_intent_id", params.paymentIntentId)
    .maybeSingle();

  if (existing) return;

  const paymentId = await findPendingPaymentId(params);
  if (!paymentId) return;

  await admin
    .from("payments")
    .update({
      stripe_intent_id: params.paymentIntentId,
      ...(params.checkoutSessionId
        ? { checkout_session_id: params.checkoutSessionId }
        : {}),
    })
    .eq("id", paymentId)
    .eq("status", "pending");
}
