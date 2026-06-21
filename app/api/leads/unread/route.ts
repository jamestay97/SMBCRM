import { NextResponse } from "next/server";
import { getUserOrgId } from "@/lib/auth/org";
import { getUnreadSummaryForOrg } from "@/lib/leads/conversation-unread";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const orgId = await getUserOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createClient();
    const summary = await getUnreadSummaryForOrg(supabase, orgId);
    return NextResponse.json(summary);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load unread messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
