/**
 * Base URL for customer-facing redirects (Stripe success/cancel pages).
 * In local dev, prefer localhost so payers are not sent to a stale ngrok tunnel.
 */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (process.env.NODE_ENV === "development") {
    if (!configured || configured.includes("ngrok")) {
      return "http://localhost:3000";
    }
  }

  return (configured ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Base URL shown for inbound webhooks (Twilio, etc.) — may be ngrok in dev. */
export function getWebhookBaseUrl(): string {
  const webhook = process.env.WEBHOOK_BASE_URL?.trim();
  if (webhook) {
    return webhook.replace(/\/$/, "");
  }
  return getAppUrl();
}
