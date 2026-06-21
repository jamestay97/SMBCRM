import { NextRequest, NextResponse } from "next/server";

import Stripe from "stripe";

import { getStripe } from "@/lib/stripe";

import {

  confirmStripeCheckoutSession,

  confirmStripePaymentIntent,

} from "@/lib/stripe/confirm-payment";



export const runtime = "nodejs";



const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;



export async function POST(request: NextRequest) {

  if (!webhookSecret) {

    return NextResponse.json(

      { error: "STRIPE_WEBHOOK_SECRET is not configured" },

      { status: 500 }

    );

  }



  const signature = request.headers.get("stripe-signature");

  if (!signature) {

    return NextResponse.json(

      { error: "Missing stripe-signature header" },

      { status: 400 }

    );

  }



  const rawBody = await request.text();

  const stripe = getStripe();



  let event: Stripe.Event;

  try {

    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

  } catch (err) {

    const message = err instanceof Error ? err.message : "Invalid signature";

    return NextResponse.json({ error: message }, { status: 400 });

  }



  try {

    if (event.type === "payment_intent.succeeded") {

      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      await confirmStripePaymentIntent(paymentIntent);

    }



    if (event.type === "checkout.session.completed") {

      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status === "paid") {

        await confirmStripeCheckoutSession(session.id);

      }

    }

  } catch (err) {

    const message = err instanceof Error ? err.message : "Webhook handler failed";

    console.error("[stripe/webhook]", message, err);

    return NextResponse.json({ error: message }, { status: 500 });

  }



  return NextResponse.json({ received: true });

}

