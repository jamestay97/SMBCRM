import { getAppUrl } from "@/lib/app-url";

export function getVapiWebhookSetup(orgId?: string) {
  const appUrl = getAppUrl();
  const unifiedUrl = `${appUrl}/api/vapi/webhook`;
  const orgUrl = orgId ? `${appUrl}/api/vapi/${orgId}/webhook` : null;
  const orgQueryUrl = orgId
    ? `${appUrl}/api/vapi/webhook?org_id=${orgId}`
    : null;

  return {
    app_url: appUrl,
    recommended_server_url: orgUrl ?? orgQueryUrl ?? unifiedUrl,
    unified_webhook: unifiedUrl,
    org_webhook: orgUrl,
    org_webhook_query: orgQueryUrl,
    required_server_messages: ["end-of-call-report", "status-update"],
    vapi_assistant_example: {
      server: {
        url: orgUrl ?? orgQueryUrl ?? unifiedUrl,
      },
      serverMessages: ["end-of-call-report", "status-update"],
    },
    checklist: [
      "Set Server URL on the Vapi assistant (or phone number) to the recommended_server_url above.",
      "Enable serverMessages: end-of-call-report and status-update on the assistant.",
      "If VAPI_WEBHOOK_SECRET is set in Vercel, configure the same value in Vapi (X-Vapi-Secret header, no Bearer prefix).",
      "Save your Vapi number in Dashboard → Settings → Business phone (required for the unified /api/vapi/webhook URL).",
      "Run Supabase migration 015_voice_calls.sql if voice_calls table is missing.",
      "After a test call, check Vercel logs for [vapi/webhook] — look for call synced vs skipped vs 403.",
    ],
    webhook_secret_configured: Boolean(process.env.VAPI_WEBHOOK_SECRET?.trim()),
  };
}
