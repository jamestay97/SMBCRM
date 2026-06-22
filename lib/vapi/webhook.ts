import { NextRequest, NextResponse } from "next/server";
import { resolveOrgByPhoneNumber } from "@/lib/jobs/enqueue";
import { getTenantInboundAccess } from "@/lib/tenant/access";
import { syncVapiCallEvent, upsertVoiceCall } from "@/lib/vapi/call-sync";
import {
  extractBusinessPhoneNumber,
  extractCustomerPhoneNumber,
  extractVapiCallId,
  parseVapiCallPayload,
} from "@/lib/vapi/parse-call";
import { createAdminClient } from "@/lib/supabase/admin";

const CALL_SYNC_EVENTS = new Set(["end-of-call-report", "status-update"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function verifyVapiWebhook(request: NextRequest): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const headerCandidates = [
    request.headers.get("x-vapi-secret"),
    request.headers.get("X-Vapi-Secret"),
    request.headers.get("x-vapi-signature"),
    request.headers.get("X-Vapi-Signature"),
  ];

  if (headerCandidates.some((value) => value === secret)) {
    return true;
  }

  const authorization = request.headers.get("authorization")?.trim();
  if (authorization === `Bearer ${secret}` || authorization === secret) {
    return true;
  }

  return false;
}

export function getVapiWebhookAuthFailureReason(): string {
  return (
    "Webhook secret mismatch. Set the same value in Vapi credentials (X-Vapi-Secret, no Bearer prefix) " +
    "and Vercel VAPI_WEBHOOK_SECRET, or remove VAPI_WEBHOOK_SECRET from Vercel while testing."
  );
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

function getVapiStatusUpdateStatus(body: unknown): string | null {
  const message = asRecord(asRecord(body)?.message);
  return message && typeof message.status === "string" ? message.status : null;
}

function isCallCompletionEvent(body: unknown, eventType: string): boolean {
  if (eventType === "end-of-call-report") return true;
  if (eventType !== "status-update") return false;
  return getVapiStatusUpdateStatus(body)?.toLowerCase() === "ended";
}

export {
  extractBusinessPhoneNumber,
  extractCustomerPhoneNumber,
} from "@/lib/vapi/parse-call";

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
  orgIdFromQuery?: string | null;
  body: unknown;
}): Promise<{ orgId: string } | { error: NextResponse }> {
  const orgIdOverride = params.orgIdFromPath ?? params.orgIdFromQuery?.trim();
  if (orgIdOverride) {
    const blocked = await assertOrgAvailable(orgIdOverride);
    if (blocked) return { error: blocked };
    return { orgId: orgIdOverride };
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

  if (!eventType || !CALL_SYNC_EVENTS.has(eventType)) {
    console.info("[vapi/webhook] skipped event", { orgId, eventType: eventType ?? "unknown" });
    return NextResponse.json({
      received: true,
      skipped: eventType ?? "unknown",
      hint:
        "Enable serverMessages end-of-call-report and status-update on your Vapi assistant.",
    });
  }

  const customerNumber = extractCustomerPhoneNumber(body);
  const vapiCallId = extractVapiCallId(body);

  if (!customerNumber || !vapiCallId) {
    console.warn("[vapi/webhook] missing call metadata", {
      orgId,
      eventType,
      vapiCallId,
      hasCustomerNumber: Boolean(customerNumber),
    });
    return NextResponse.json({
      received: true,
      skipped: "missing call metadata",
      event_type: eventType,
      has_call_id: Boolean(vapiCallId),
      has_customer_phone: Boolean(customerNumber),
    });
  }

  try {
    if (isCallCompletionEvent(body, eventType)) {
      const result = await syncVapiCallEvent({ orgId, body, eventType });
      if (!result) {
        console.warn("[vapi/webhook] unparseable completion payload", {
          orgId,
          eventType,
          vapiCallId,
        });
        return NextResponse.json({ received: true, skipped: "unparseable call" });
      }

      console.info("[vapi/webhook] call synced", {
        orgId,
        eventType,
        leadId: result.leadId,
        callId: result.call.id,
        bookingProcessed: Boolean(result.booking),
      });

      return NextResponse.json({
        received: true,
        org_id: orgId,
        lead_id: result.leadId,
        call_id: result.call.id,
        booking_processed: Boolean(result.booking),
        payment_url: result.booking?.paymentUrl ?? null,
      });
    }

    const parsed = parseVapiCallPayload(body, eventType);
    if (!parsed) {
      return NextResponse.json({ received: true, skipped: "unparseable status" });
    }

    const { call } = await upsertVoiceCall({ orgId, parsed });

    return NextResponse.json({
      received: true,
      org_id: orgId,
      lead_id: call.lead_id,
      call_id: call.id,
      status: call.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[vapi/webhook] error", { orgId, eventType, vapiCallId, message, err });
    return NextResponse.json(
      {
        error: "Processing failed",
        detail:
          message.includes("voice_calls") || message.includes("relation")
            ? "Database migration 015_voice_calls.sql may not be applied."
            : message,
      },
      { status: 500 }
    );
  }
}
