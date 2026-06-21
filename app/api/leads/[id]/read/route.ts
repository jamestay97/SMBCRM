import { NextRequest, NextResponse } from "next/server";
import { getUserOrgId } from "@/lib/auth/org";
import { markLeadConversationRead } from "@/lib/leads/conversation-unread";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const orgId = await getUserOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await markLeadConversationRead({ orgId, leadId: params.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to mark conversation read";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
