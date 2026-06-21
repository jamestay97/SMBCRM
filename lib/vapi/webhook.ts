import { NextRequest, NextResponse } from "next/server";
import {
  findLeadByPhone,
  handleInboundMessage,
  ingestLead,
} from "@/lib/leads/ingest";
import { resolveOrgByPhoneNumber } from "@/lib/jobs/enqueue";
import { getTenantInboundAccess } from "@/lib/tenant/access";
import { toE164 } from "@/lib/twilio/phone";
import { createAdminClient } from "@/lib/supabase/admin";

const PROCESSED_EVENT_TYPES = new Set([
  "end-of-call-report",
  "transcript",
  "conversation-update",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function verifyVapiWebhook(request: NextRequest): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("x-vapi-secret") === secret;
}

export function getVapiEventType(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) return undefined;

  const message = asRecord(root.message);
  if (message && typeof message.type === "string") {
    return message.type;
  }

  if (typeof root.type === "string") {
    return root.type;
  }

  return undefined;
}

export function extractBusinessPhoneNumber(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;

  const candidates: unknown[] = [
    root.phoneNumber,
    asRecord(root.message)?.phoneNumber,
    asRecord(root.call)?.phoneNumber,
    asRecord(asRecord(root.message)?.call)?.phoneNumber,
  ];

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record && typeof record.number === "string") {
      return toE164(record.number);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return toE164(candidate);
    }
  }

  return null;
}

export function extractCustomerPhoneNumber(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;

  const message = asRecord(root.message);
  const call = asRecord(message?.call) ?? asRecord(root.call);
  const customer =
    asRecord(call?.customer) ??
    asRecord(message?.customer) ??
    asRecord(root.customer);

  const number =
    (typeof customer?.number === "string" && customer.number) ||
    (typeof call?.from === "string" && call.from) ||
    (typeof root.from === "string" && root.from) ||
    null;

  return number ? toE164(number) : null;
}

export function extractVapiTranscript(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) return undefined;

  const message = asRecord(root.message);

  if (typeof message?.transcript === "string" && message.transcript.trim()) {
    return message.transcript.trim();
  }

  if (typeof root.transcript === "string" && root.transcript.trim()) {
    return root.transcript.trim();
  }

  const artifact = asRecord(message?.artifact);
  if (typeof artifact?.transcript === "string" && artifact.transcript.trim()) {
    return artifact.transcript.trim();
  }

  const messages = artifact?.messages;
  if (Array.isArray(messages)) {
    const userLines = messages
      .map((entry) => asRecord(entry))
      .filter((entry) => entry?.role === "user")
      .map(
        (entry) =>
          (typeof entry?.message === "string" && entry.message) ||
          (typeof entry?.content === "string" && entry.content) ||
          ""
      )
      .filter(Boolean);

    if (userLines.length) {
      return userLines.join("\n");
    }
  }

  const nestedMessage = asRecord(message?.message);
  if (
    nestedMessage?.role === "user" &&
    typeof nestedMessage.content === "string" &&
    nestedMessage.content.trim()
  ) {
    return nestedMessage.content.trim();
  }

  return undefined;
}

async function assertOrgAvailable(orgId: string): Promise<NextResponse | null> {
  const admin = createAdminClient();
  const { data: org, error } = await admin
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  const access = await getTenantInboundAccess(orgId);
  if (!access.allowed) {
    return NextResponse.json({ error: "Tenant unavailable" }, { status: 403 });
  }

  return null;
}

export async function resolveOrgIdForVapiWebhook(params: {
  orgIdFromPath?: string;
  body: unknown;
}): Promise<{ orgId: string } | { error: NextResponse }> {
  if (params.orgIdFromPath) {
    const blocked = await assertOrgAvailable(params.orgIdFromPath);
    if (blocked) return { error: blocked };
    return { orgId: params.orgIdFromPath };
  }

  const businessPhone = extractBusinessPhoneNumber(params.body);
  if (!businessPhone) {
    return {
      error: NextResponse.json(
        {
          error:
            "Could not determine business phone number. Add this number in Settings, or use /api/vapi/{orgId}/webhook.",
        },
        { status: 400 }
      ),
    };
  }

  const tenant = await resolveOrgByPhoneNumber(businessPhone);
  if (!tenant) {
    return {
      error: NextResponse.json(
        {
          error: `No business is assigned to ${businessPhone}. Set it in Dashboard → Settings → Business phone.`,
        },
        { status: 404 }
      ),
    };
  }

  const blocked = await assertOrgAvailable(tenant.orgId);
  if (blocked) return { error: blocked };

  return { orgId: tenant.orgId };
}

export async function handleVapiWebhookBody(
  orgId: string,
  body: unknown
): Promise<NextResponse> {
  const eventType = getVapiEventType(body);

  if (!eventType || !PROCESSED_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ received: true });
  }

  const customerNumber = extractCustomerPhoneNumber(body);
  const transcript = extractVapiTranscript(body);

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
      return NextResponse.json({ received: true, org_id: orgId });
    }

    await handleInboundMessage({
      orgId,
      leadId: lead.id,
      message: transcript,
      channel: "voice",
    });

    return NextResponse.json({ received: true, org_id: orgId });
  } catch (err) {
    console.error("[vapi/webhook] error", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
