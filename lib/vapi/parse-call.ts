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

function normalizePhoneCandidate(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    try {
      return toE164(value);
    } catch {
      return null;
    }
  }

  const record = asRecord(value);
  if (!record) return null;

  for (const key of ["number", "phoneNumber", "phone", "e164"]) {
    const candidate = readString(record[key]);
    if (!candidate) continue;
    try {
      return toE164(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function mapVapiStatus(
  raw: string | null,
  eventType: string,
  messageStatus: string | null
): VoiceCallStatus {
  if (eventType === "end-of-call-report") return "completed";
  if (eventType === "status-update" && messageStatus?.toLowerCase() === "ended") {
    return "completed";
  }

  const normalized = raw?.toLowerCase() ?? messageStatus?.toLowerCase() ?? "";
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
  return readString(call?.id) ?? readString(root.callId) ?? readString(message?.callId);
}

export function extractBusinessPhoneNumber(body: unknown): string | null {
  const root = asRecord(body);
  if (!root) return null;

  const message = asRecord(root.message);
  const call = asRecord(message?.call) ?? asRecord(root.call);

  const candidates: unknown[] = [
    message?.phoneNumber,
    call?.phoneNumber,
    root.phoneNumber,
    call?.to,
    message?.to,
    root.to,
  ];

  for (const candidate of candidates) {
    const normalized = normalizePhoneCandidate(candidate);
    if (normalized) return normalized;
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

  const candidates: unknown[] = [
    customer,
    customer?.number,
    customer?.phoneNumber,
    call?.customerNumber,
    message?.customerNumber,
    call?.from,
    message?.from,
    root.from,
    call?.caller,
    message?.caller,
    asRecord(call?.transport)?.from,
    asRecord(call?.transport)?.caller,
    asRecord(call?.transport)?.customerNumber,
    asRecord(call?.phoneCallProviderDetails)?.from,
  ];

  for (const candidate of candidates) {
    const normalized = normalizePhoneCandidate(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function transcriptFromMessages(messages: unknown): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;

  const lines = messages
    .map((entry) => asRecord(entry))
    .filter(Boolean)
    .map((entry) => {
      const roleRaw = readString(entry?.role)?.toLowerCase() ?? "user";
      const role =
        roleRaw === "assistant" || roleRaw === "bot" ? "Assistant" : "Customer";
      const text =
        readString(entry?.message) ??
        readString(entry?.content) ??
        readString(entry?.text) ??
        readString(entry?.transcript);
      return text ? `${role}: ${text}` : null;
    })
    .filter(Boolean);

  return lines.length ? lines.join("\n") : undefined;
}

export function extractVapiTranscript(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) return undefined;

  const message = asRecord(root.message);
  const call = asRecord(message?.call) ?? asRecord(root.call);
  const artifact = asRecord(message?.artifact);

  const direct =
    readString(message?.transcript) ??
    readString(root.transcript) ??
    readString(artifact?.transcript) ??
    readString(call?.transcript);

  if (direct) return direct;

  return (
    transcriptFromMessages(artifact?.messages) ??
    transcriptFromMessages(message?.messages) ??
    transcriptFromMessages(call?.messages)
  );
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
  const messageStatus = readString(message?.status);

  const status = mapVapiStatus(readString(call?.status), eventType, messageStatus);
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
    endedAt:
      eventType === "end-of-call-report" ||
      (eventType === "status-update" && messageStatus?.toLowerCase() === "ended")
        ? endedAt ?? new Date().toISOString()
        : endedAt,
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
