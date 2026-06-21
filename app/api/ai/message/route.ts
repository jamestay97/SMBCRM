import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserOrgId } from "@/lib/auth/org";
import { handleInboundMessage } from "@/lib/leads/ingest";

const messageSchema = z.object({
  lead_id: z.string().uuid(),
  message: z.string().min(1).max(4000),
});

function inboundMessageStatus(err: unknown): number {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("Lead not found") || message.includes("Conversation not found")) {
    return 404;
  }
  return 500;
}

export async function POST(request: NextRequest) {
  const orgId = await getUserOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await handleInboundMessage({
      orgId,
      leadId: parsed.data.lead_id,
      message: parsed.data.message,
      channel: "webchat",
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI message failed";
    return NextResponse.json(
      { error: message },
      { status: inboundMessageStatus(err) }
    );
  }
}
