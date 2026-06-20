import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TranscriptEntry } from "@/types/database";

export type UnreadLeadSummary = {
  leadId: string;
  leadName: string;
  unreadCount: number;
  lastMessageAt: string;
  preview: string;
};

export type UnreadSummary = {
  total: number;
  leads: UnreadLeadSummary[];
  byLeadId: Record<string, UnreadLeadSummary>;
};

function getInboundMessages(transcript: TranscriptEntry[]): TranscriptEntry[] {
  return transcript.filter((entry) => entry.role === "user");
}

export function countUnreadInboundMessages(
  transcript: TranscriptEntry[],
  staffReadAt: string | null
): number {
  const readAt = staffReadAt ? new Date(staffReadAt).getTime() : 0;

  return getInboundMessages(transcript).filter((entry) => {
    const at = entry.at ? new Date(entry.at).getTime() : 0;
    return at > readAt;
  }).length;
}

export function buildUnreadSummary(
  rows: Array<{
    lead_id: string;
    transcript_json: TranscriptEntry[] | null;
    staff_read_at: string | null;
    leads: { name: string } | { name: string }[] | null;
  }>
): UnreadSummary {
  const leads: UnreadLeadSummary[] = [];

  for (const row of rows) {
    const transcript = (row.transcript_json ?? []) as TranscriptEntry[];
    const unreadCount = countUnreadInboundMessages(
      transcript,
      row.staff_read_at
    );

    if (unreadCount === 0) continue;

    const inbound = getInboundMessages(transcript);
    const lastInbound = inbound[inbound.length - 1];
    const leadRecord = Array.isArray(row.leads) ? row.leads[0] : row.leads;

    leads.push({
      leadId: row.lead_id,
      leadName: leadRecord?.name ?? "Lead",
      unreadCount,
      lastMessageAt: lastInbound?.at ?? new Date().toISOString(),
      preview: lastInbound?.content?.slice(0, 120) ?? "",
    });
  }

  leads.sort(
    (a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  );

  const byLeadId = Object.fromEntries(leads.map((lead) => [lead.leadId, lead]));

  return {
    total: leads.reduce((sum, lead) => sum + lead.unreadCount, 0),
    leads,
    byLeadId,
  };
}

export async function getUnreadSummaryForOrg(
  supabase: SupabaseClient,
  orgId: string
): Promise<UnreadSummary> {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("lead_id, transcript_json, staff_read_at, leads!inner(name)")
    .eq("org_id", orgId);

  if (error) {
    throw new Error(`Failed to load conversations: ${error.message}`);
  }

  return buildUnreadSummary((data ?? []) as Parameters<typeof buildUnreadSummary>[0]);
}

export async function markLeadConversationRead(params: {
  orgId: string;
  leadId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const readAt = new Date().toISOString();

  const { error } = await admin
    .from("ai_conversations")
    .update({ staff_read_at: readAt })
    .eq("org_id", params.orgId)
    .eq("lead_id", params.leadId);

  if (error) {
    throw new Error(`Failed to mark conversation read: ${error.message}`);
  }
}
