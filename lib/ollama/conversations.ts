import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TranscriptEntry } from "@/types/database";

export async function createConversationForLead(params: {
  orgId: string;
  leadId: string;
  systemPrompt: string;
  channel?: "sms" | "voice" | "webchat";
}): Promise<{ conversationId: string; sessionId: string }> {
  const admin = createAdminClient();
  const sessionId = `ollama-${randomUUID()}`;

  const { data: conversation, error } = await admin
    .from("ai_conversations")
    .insert({
      lead_id: params.leadId,
      org_id: params.orgId,
      openai_thread_id: sessionId,
      channel: params.channel ?? null,
      transcript_json: [
        {
          role: "system",
          content: params.systemPrompt,
          at: new Date().toISOString(),
        },
      ],
    })
    .select("id")
    .single();

  if (error || !conversation) {
    throw new Error(`Failed to create ai_conversation: ${error?.message}`);
  }

  return { conversationId: conversation.id, sessionId };
}

export async function getTranscript(
  conversationId: string
): Promise<TranscriptEntry[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("ai_conversations")
    .select("transcript_json")
    .eq("id", conversationId)
    .single();

  if (error || !data) {
    throw new Error(`Conversation not found: ${error?.message}`);
  }

  return (data.transcript_json ?? []) as TranscriptEntry[];
}

export async function appendTranscript(
  conversationId: string,
  entry: Omit<TranscriptEntry, "at"> & { at?: string }
): Promise<void> {
  const admin = createAdminClient();

  const { data: existing, error: fetchError } = await admin
    .from("ai_conversations")
    .select("transcript_json")
    .eq("id", conversationId)
    .single();

  if (fetchError || !existing) {
    throw new Error(`Conversation not found: ${fetchError?.message}`);
  }

  const transcript = (existing.transcript_json ?? []) as TranscriptEntry[];
  transcript.push({
    ...entry,
    at: entry.at ?? new Date().toISOString(),
  });

  const { error: updateError } = await admin
    .from("ai_conversations")
    .update({ transcript_json: transcript })
    .eq("id", conversationId);

  if (updateError) {
    throw new Error(`Failed to update transcript: ${updateError.message}`);
  }
}

export async function getConversationByLeadId(leadId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_conversations")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load conversation: ${error.message}`);
  }

  return data;
}
