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
import { createAdminClient } from "@/lib/supabase/admin";
import type { InboundJobPayload } from "@/types/database";

export const runtime = "nodejs";

function formDataToRecord(formData: FormData): Record<string, string> {
  const record: Record<string, string> = {};
  formData.forEach((value, key) => {
    record[key] = String(value);
  });
  return record;
}

function twimlResponse(twiml: string): NextResponse {
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

export async function POST(request: NextRequest) {
  if (!requireTwilioWebhookAuth()) {
    return new NextResponse("Twilio webhook auth not configured", { status: 503 });
  }

  const formData = await request.formData();
  const fields = formDataToRecord(formData);

  const signature = request.headers.get("x-twilio-signature");
  const webhookUrl = `${getWebhookBaseUrl()}/api/twilio/voice`;

  if (process.env.TWILIO_AUTH_TOKEN) {
    const valid = validateTwilioSignature(signature, webhookUrl, fields);
    if (!valid) {
      return new NextResponse("Invalid Twilio signature", { status: 403 });
    }
  }

  const from = fields.From;
  const to = fields.To;
  const speechResult = fields.SpeechResult?.trim();

  if (!from || !to) {
    return new NextResponse("Missing From or To", { status: 400 });
  }

  const tenant = await resolveOrgByPhoneNumber(to);
  if (!tenant) {
    return twimlResponse(
      `<Response><Say>Sorry, this number is not configured.</Say></Response>`
    );
  }

  const access = await getTenantInboundAccess(tenant.orgId);
  if (!access.allowed) {
    return twimlResponse(
      `<Response><Say>This business is currently unavailable. Please try again later.</Say></Response>`
    );
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("business_name")
    .eq("id", tenant.orgId)
    .single();

  const businessName = escapeXml(org?.business_name ?? "our team");

  if (!speechResult) {
    return twimlResponse(
      `<Response>
        <Say voice="Polly.Joanna">Thanks for calling ${businessName}. After the tone, tell us what you need help with.</Say>
        <Gather input="speech" action="${webhookUrl}" method="POST" speechTimeout="auto" timeout="6">
          <Say>What can we help you with today?</Say>
        </Gather>
        <Say>We didn't catch that. Please text us instead. Goodbye.</Say>
      </Response>`
    );
  }

  const payload: InboundJobPayload = {
    from,
    to,
    transcript: speechResult,
    channel: "voice",
  };

  try {
    const jobId = await enqueueInboundJob({
      orgId: tenant.orgId,
      channel: "voice",
      payload,
      slaTargetSeconds: access.slaTargetSeconds,
    });

    if (process.env.NODE_ENV !== "production") {
      processInboundJob(jobId).catch((err) => {
        console.error("[twilio/voice] background job failed", jobId, err);
      });
    }

    return twimlResponse(
      `<Response>
        <Say voice="Polly.Joanna">Thanks. Our AI assistant is reviewing your request and will text you back shortly with next steps.</Say>
      </Response>`
    );
  } catch (err) {
    console.error("[twilio/voice] enqueue failed", err);
    return twimlResponse(
      `<Response><Say>Sorry, we're having trouble right now. Please try texting us instead.</Say></Response>`
    );
  }
}
