import { getWebhookBaseUrl } from "@/lib/app-url";
import { NextRequest, NextResponse } from "next/server";
import {
  enqueueInboundJob,
  resolveOrgByPhoneNumber,
} from "@/lib/jobs/enqueue";
import { processInboundJob } from "@/lib/jobs/process-inbound-job";
import { getTenantInboundAccess } from "@/lib/tenant/access";
import {
  requireTwilioWebhookAuth,
  validateTwilioSignature,
} from "@/lib/twilio/client";
import type { InboundJobPayload } from "@/types/database";

export const runtime = "nodejs";

const ACK_MESSAGE =
  "Thanks for reaching out — our AI rep is reviewing your message and will reply shortly.";

function formDataToRecord(formData: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  formData.forEach((value, key) => {
    record[key] = String(value);
  });
  return record;
}

export async function POST(request: NextRequest) {
  if (!requireTwilioWebhookAuth()) {
    console.error("[twilio/inbound] TWILIO_AUTH_TOKEN is required in production");
    return new NextResponse("Twilio webhook auth not configured", { status: 503 });
  }

  const formData = await request.formData();
  const fields = formDataToRecord(formData);

  const signature = request.headers.get("x-twilio-signature");
  const webhookUrl = `${getWebhookBaseUrl()}/api/twilio/inbound`;

  if (process.env.TWILIO_AUTH_TOKEN) {
    const valid = validateTwilioSignature(signature, webhookUrl, fields);
    if (!valid) {
      return new NextResponse("Invalid Twilio signature", { status: 403 });
    }
  }

  const from = fields.From;
  const to = fields.To;
  const body = fields.Body?.trim();

  if (!from || !to || !body) {
    return new NextResponse("Missing From, To, or Body", { status: 400 });
  }

  const tenant = await resolveOrgByPhoneNumber(to);
  if (!tenant) {
    console.error("[twilio/inbound] unknown To number", to);
    return twimlResponse(
      "Sorry, this number is not configured. Please contact the business directly."
    );
  }

  const access = await getTenantInboundAccess(tenant.orgId);
  if (!access.allowed) {
    return twimlResponse("This business is currently unavailable.");
  }

  const payload: InboundJobPayload = {
    from,
    to,
    body,
    message_sid: fields.MessageSid,
    channel: "sms",
  };

  try {
    const jobId = await enqueueInboundJob({
      orgId: tenant.orgId,
      channel: "sms",
      payload,
      slaTargetSeconds: access.slaTargetSeconds,
    });

    if (process.env.NODE_ENV !== "production") {
      processInboundJob(jobId).catch((err) => {
        console.error("[twilio/inbound] background job failed", jobId, err);
      });
    }

    return twimlResponse(ACK_MESSAGE);
  } catch (err) {
    console.error("[twilio/inbound] enqueue failed", err);
    return twimlResponse(
      "Sorry, we're having trouble right now. Please try again shortly."
    );
  }
}

function twimlResponse(message: string): NextResponse {
  const twiml = `<Response><Message>${escapeXml(message)}</Message></Response>`;
  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
