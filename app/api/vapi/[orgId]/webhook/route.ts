import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  findLeadByPhone,
  handleInboundMessage,
  ingestLead,
} from "@/lib/leads/ingest";
import { getTenantInboundAccess } from "@/lib/tenant/access";
import { parseVapiWebhookPayload } from "@/lib/vapi/client";

export const runtime = "nodejs";
export const maxDuration = 120;

function verifyVapiWebhook(request: NextRequest): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("x-vapi-secret") === secret;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { orgId: string } }
) {
  if (!verifyVapiWebhook(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const orgId = params.orgId;
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();

  if (orgError || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const access = await getTenantInboundAccess(orgId);
  if (!access.allowed) {
    return NextResponse.json({ error: "Tenant unavailable" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseVapiWebhookPayload(body);

  if (event.type !== "transcript" && event.type !== "conversation-update") {
    return NextResponse.json({ received: true });
  }

  const customerNumber = event.call?.customer?.number;
  const transcript =
    event.transcript ??
    (event.message?.role === "user" ? event.message.content : undefined);

  if (!customerNumber || !transcript) {
    return NextResponse.json({ received: true });
  }

  try {
    const lead = await findLeadByPhone(orgId, customerNumber);

    if (!lead) {
      await ingestLead({
        orgId,
        name: customerNumber,
        phone: customerNumber,
        initialMessage: transcript,
        channel: "voice",
        sendOutboundSms: false,
      });
      return NextResponse.json({ received: true });
    }

    await handleInboundMessage({
      orgId,
      leadId: lead.id,
      message: transcript,
      channel: "voice",
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[vapi/webhook] error", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
