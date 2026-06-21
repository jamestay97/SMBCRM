import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyInternalSecret, unauthorizedResponse } from "@/lib/auth/internal";
import { createDepositPayment } from "@/lib/stripe/create-deposit-payment";
import { loadLeadBookingPaymentState } from "@/lib/stripe/payment-status";

const bodySchema = z.object({
  org_id: z.string().uuid(),
  lead_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  if (!verifyInternalSecret(request)) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const paidState = await loadLeadBookingPaymentState({
      orgId: parsed.data.org_id,
      leadId: parsed.data.lead_id,
    });

    if (paidState.isPaid) {
      return NextResponse.json({
        payment_status: "succeeded",
        already_paid: true,
        confirmation_message:
          paidState.paidReply ??
          "Deposit already received — appointment is confirmed.",
      });
    }

    const result = await createDepositPayment({
      orgId: parsed.data.org_id,
      leadId: parsed.data.lead_id,
    });

    return NextResponse.json({
      payment_url: result.paymentUrl,
      payment_status: "pending",
      stripe_intent_id: result.stripeIntentId,
      amount_cents: result.amountCents,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create deposit payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
