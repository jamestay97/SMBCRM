import { NextRequest, NextResponse } from "next/server";
import { getVapiWebhookSetup } from "@/lib/vapi/diagnostics";
import {
  getVapiWebhookAuthFailureReason,
  handleVapiWebhookBody,
  resolveOrgIdForVapiWebhook,
  verifyVapiWebhook,
} from "@/lib/vapi/webhook";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: { orgId: string } }
) {
  return NextResponse.json({
    ok: true,
    service: "SMBCRM Vapi webhook (org-scoped)",
    org_id: params.orgId,
    ...getVapiWebhookSetup(params.orgId),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { orgId: string } }
) {
  if (!verifyVapiWebhook(request)) {
    return NextResponse.json(
      { error: "Unauthorized", detail: getVapiWebhookAuthFailureReason() },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const resolved = await resolveOrgIdForVapiWebhook({
    orgIdFromPath: params.orgId,
    body,
  });
  if ("error" in resolved) {
    return resolved.error;
  }

  return handleVapiWebhookBody(resolved.orgId, body);
}
