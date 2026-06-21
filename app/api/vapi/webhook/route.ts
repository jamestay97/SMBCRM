import { NextRequest, NextResponse } from "next/server";
import {
  handleVapiWebhookBody,
  resolveOrgIdForVapiWebhook,
  verifyVapiWebhook,
} from "@/lib/vapi/webhook";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  if (!verifyVapiWebhook(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const resolved = await resolveOrgIdForVapiWebhook({ body });
  if ("error" in resolved) {
    return resolved.error;
  }

  return handleVapiWebhookBody(resolved.orgId, body);
}
