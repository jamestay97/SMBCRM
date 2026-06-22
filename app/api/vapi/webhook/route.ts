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

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id") ?? undefined;
  return NextResponse.json({
    ok: true,
    service: "SMBCRM Vapi webhook",
    ...getVapiWebhookSetup(orgId ?? undefined),
  });
}

export async function POST(request: NextRequest) {
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

  const orgIdQuery = request.nextUrl.searchParams.get("org_id");
  const resolved = await resolveOrgIdForVapiWebhook({
    body,
    orgIdFromQuery: orgIdQuery,
  });
  if ("error" in resolved) {
    return resolved.error;
  }

  return handleVapiWebhookBody(resolved.orgId, body);
}
