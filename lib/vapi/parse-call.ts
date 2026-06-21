import type { VoiceCall, VoiceCallStatus } from "@/types/database";
import { toE164 } from "@/lib/twilio/phone";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapVapiStatus(raw: string | null, eventType: string): VoiceCallStatus {
  if (eventType === "end-of-call-report") return "completed";

  const normalized = raw?.toLowerCase() ?? "";
  if (
    normalized.includes("ended") ||
    normalized.includes("completed") ||
    normalized === "done"
  ) {
    return "completed";
  }
  if (normalized.includes("failed") || normalized.includes("error")) {
    return "failed";
  }
  if (normalized.includes("busy")) return "busy";
  if (normalized.includes("no-answer") || normalized.includes("no_answer")) {
    return "no_answer";
  }
  return "in_progress";
}

export type ParsedVapiCall = {
  vapiCallId: string;
  customerPhone: string;
  businessPhone: string | null;
  status: VoiceCallStatus;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
  endedReason: string | null;
};

export function extractVapiCallId(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;

  const message = asRecord(root.message);
  const call = asRecord(message?.call) ?? asRecord(root.call);
  return readString(call?.id) ?? readString(root.callId);
}

export function extractBusinessPhoneNumber(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;

  const candidates: unknown[] = [
    root.phoneNumber,
    asRecord(root.message)?.phoneNumber,
    asRecord(root.call)?.phoneNumber,
    asRecord(asRecord(root.message)?.call)?.phoneNumber,
  ];

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (record && typeof record.number === "string") {
      return toE164(record.number);
    }
    if (typeof candidate === "string" && candidate.trim()) {
      return toE164(candidate);
    }
  }

  return null;
}

export function extractCustomerPhoneNumber(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;

  const message = asRecord(root.message);
  const call = asRecord(message?.call) ?? asRecord(root.call);
  const customer =
    asRecord(call?.customer) ??
    asRecord(message?.customer) ??
    asRecord(root.customer);

  const number =
    readString(customer?.number) ??
    readString(call?.from) ??
    readString(root.from);

  return number ? toE164(number) : null;
}

export function extractVapiTranscript(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) return undefined;

  const message = asRecord(root.message);

  const direct =
    readString(message?.transcript) ??
    readString(root.transcript) ??
    readString(asRecord(message?.artifact)?.transcript);

  if (direct) return direct;

  const artifact = asRecord(message?.artifact);
  const messages = artifact?.messages;
  if (Array.isArray(messages)) {
    const lines = messages
      .map((entry) => asRecord(entry))
      .filter(Boolean)
      .map((entry) => {
        const role = entry?.role === "assistant" ? "Assistant" : "Customer";
        const text =
          readString(entry?.message) ??
          readString(entry?.content) ??
          readString(entry?.text);
        return text ? `${role}: ${text}` : null;
      })
      .filter(Boolean);

    if (lines.length) {
      return lines.join("\n");
    }
  }

  return undefined;
}

export function parseVapiCallPayload(
  body: unknown,
  eventType: string
): ParsedVapiCall | null {
  const vapiCallId = extractVapiCallId(body);
  const customerPhone = extractCustomerPhoneNumber(body);
  if (!vapiCallId || !customerPhone) return null;

  const root = asRecord(body);
  const message = asRecord(root?.message);
  const call = asRecord(message?.call) ?? asRecord(root?.call);
  const artifact = asRecord(message?.artifact);

  const status = mapVapiStatus(readString(call?.status), eventType);
  const startedAt =
    readString(call?.startedAt) ??
    readString(message?.startedAt) ??
    readString(root?.startedAt);
  const endedAt =
    readString(call?.endedAt) ??
    readString(message?.endedAt) ??
    readString(root?.endedAt);

  return {
    vapiCallId,
    customerPhone,
    businessPhone: extractBusinessPhoneNumber(body),
    status,
    startedAt,
    endedAt: eventType === "end-of-call-report" ? endedAt ?? new Date().toISOString() : endedAt,
    durationSeconds:
      readNumber(message?.durationSeconds) ??
      readNumber(call?.durationSeconds) ??
      readNumber(artifact?.durationSeconds),
    transcript: extractVapiTranscript(body) ?? null,
    summary: readString(message?.summary) ?? readString(artifact?.summary),
    recordingUrl:
      readString(message?.recordingUrl) ??
      readString(artifact?.recordingUrl) ??
      readString(asRecord(artifact?.recording)?.url),
    endedReason:
      readString(message?.endedReason) ??
      readString(call?.endedReason) ??
      readString(artifact?.endedReason),
  };
}

export function formatCallDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function voiceCallToRow(
  orgId: string,
  leadId: string | null,
  parsed: ParsedVapiCall
): Omit<VoiceCall, "id" | "created_at" | "updated_at"> {
  return {
    org_id: orgId,
    lead_id: leadId,
    vapi_call_id: parsed.vapiCallId,
    customer_phone: parsed.customerPhone,
    business_phone: parsed.businessPhone,
    status: parsed.status,
    direction: "inbound",
    started_at: parsed.startedAt,
    ended_at: parsed.endedAt,
    duration_seconds: parsed.durationSeconds,
    transcript: parsed.transcript,
    summary: parsed.summary,
    recording_url: parsed.recordingUrl,
    ended_reason: parsed.endedReason,
  };
}
