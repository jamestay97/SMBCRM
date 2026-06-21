/**
 * Base URL for customer-facing redirects (Stripe success/cancel pages).
 * In local dev, prefer localhost so payers are not sent to a stale ngrok tunnel.
 */
function normalizeOrigin(url: string): string {
  const trimmed = url.trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/** Strip paths — NEXT_PUBLIC_APP_URL must be origin only (no /payment/success). */
function appOriginOnly(url: string): string {
  try {
    const parsed = new URL(
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `https://${url}`
    );
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return normalizeOrigin(url);
  }
}

function isLocalhostUrl(url?: string | null): boolean {
  if (!url?.trim()) return true;
  try {
    const parsed = new URL(
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : `https://${url}`
    );
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return url.includes("localhost") || url.includes("127.0.0.1");
  }
}

function getVercelAppUrl(): string | null {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return normalizeOrigin(production);

  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return normalizeOrigin(deployment);

  return null;
}

export function getAppUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit && !isLocalhostUrl(explicit)) {
    return appOriginOnly(explicit);
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    if (!configured || configured.includes("ngrok")) {
      return "http://localhost:3000";
    }
    return appOriginOnly(configured);
  }

  // Production: never send Stripe redirects to localhost.
  if (configured && !isLocalhostUrl(configured)) {
    return appOriginOnly(configured);
  }

  const vercelUrl = getVercelAppUrl();
  if (vercelUrl) return vercelUrl;

  return normalizeOrigin(configured ?? "http://localhost:3000");
}

/** Base URL shown for inbound webhooks (Twilio, etc.) — may be ngrok in dev. */
export function getWebhookBaseUrl(): string {
  const webhook = process.env.WEBHOOK_BASE_URL?.trim();
  if (webhook && !isLocalhostUrl(webhook)) {
    return appOriginOnly(webhook);
  }

  if (process.env.NODE_ENV !== "development") {
    const vercelUrl = getVercelAppUrl();
    if (vercelUrl) return vercelUrl;
  }

  return getAppUrl();
}
