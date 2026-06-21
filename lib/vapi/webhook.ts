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

  if (!eventType || !CALL_SYNC_EVENTS.has(eventType)) {
    return NextResponse.json({ received: true, skipped: eventType ?? "unknown" });
  }

  const customerNumber = extractCustomerPhoneNumber(body);
  const vapiCallId = extractVapiCallId(body);

  if (!customerNumber || !vapiCallId) {
    return NextResponse.json({ received: true, skipped: "missing call metadata" });
  }

  try {
    if (eventType === "end-of-call-report") {
      const result = await syncVapiCallEvent({ orgId, body, eventType });
      if (!result) {
        return NextResponse.json({ received: true, skipped: "unparseable call" });
      }

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
    console.error("[vapi/webhook] error", err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
