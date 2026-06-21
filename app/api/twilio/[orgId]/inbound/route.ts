import { getWebhookBaseUrl } from "@/lib/app-url";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueInboundJob } from "@/lib/jobs/enqueue";
import { processInboundJob } from "@/lib/jobs/process-inbound-job";
import { validateTwilioSignature } from "@/lib/twilio/client";
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

/** @deprecated Use POST /api/twilio/inbound with phone-number routing */
export async function POST(
  request: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const orgId = params.orgId;
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, status, sla_target_seconds")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError || !org) {
    return new NextResponse("Organization not found", { status: 404 });
  }

  const formData = await request.formData();
  const fields = formDataToRecord(formData);

  const signature = request.headers.get("x-twilio-signature");
  const webhookUrl = `${getWebhookBaseUrl()}/api/twilio/${orgId}/inbound`;

  if (process.env.TWILIO_AUTH_TOKEN) {
    const valid = validateTwilioSignature(signature, webhookUrl, fields);
    if (!valid) {
      return new NextResponse("Invalid Twilio signature", { status: 403 });
    }
  }

  const from = fields.From;
  const body = fields.Body?.trim();

  if (!from || !body) {
    return new NextResponse("Missing From or Body", { status: 400 });
  }

  if (org.status === "suspended") {
    return twimlResponse("This business is currently unavailable.");
  }

  const payload: InboundJobPayload = {
    from,
    to: fields.To,
    body,
    message_sid: fields.MessageSid,
    channel: "sms",
  };

  try {
    const jobId = await enqueueInboundJob({
      orgId,
      channel: "sms",
      payload,
      slaTargetSeconds: org.sla_target_seconds ?? 300,
    });

    processInboundJob(jobId).catch((err) => {
      console.error("[twilio/legacy/inbound] job failed", jobId, err);
    });

    return twimlResponse(ACK_MESSAGE);
  } catch (err) {
    console.error("[twilio/legacy/inbound] error", err);
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
