import Stripe from "stripe";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY");
    }
    stripeClient = new Stripe(secretKey, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }
  return stripeClient;
}
