import type { OllamaChatMessage, OllamaToolCall } from "@/lib/ollama/client";
import { DEPOSIT_TOOL_NAME } from "@/lib/ollama/client";
import {
  SLOTS_TOOL_NAME,
  SCHEDULE_TOOL_NAME,
} from "@/lib/ollama/calendar-tools";
import {
  UPDATE_INTAKE_TOOL_NAME,
  VERIFY_SCOPE_TOOL_NAME,
} from "@/lib/ollama/intake-tools";

const KNOWN_TOOL_NAMES = new Set([
  UPDATE_INTAKE_TOOL_NAME,
  VERIFY_SCOPE_TOOL_NAME,
  SLOTS_TOOL_NAME,
  SCHEDULE_TOOL_NAME,
  DEPOSIT_TOOL_NAME,
]);

const TOOL_NAME_PATTERN =
  "update_lead_intake|verify_service_scope|get_available_appointment_slots|schedule_appointment|create_deposit_payment";

function parseArgumentsValue(
  value: unknown
): Record<string, unknown> | string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return {};
}

function objectToToolCall(
  value: Record<string, unknown>
): OllamaToolCall | null {
  const nestedFunction = value.function;
  if (nestedFunction && typeof nestedFunction === "object") {
    const fn = nestedFunction as Record<string, unknown>;
    const name = fn.name;
    if (typeof name === "string" && KNOWN_TOOL_NAMES.has(name)) {
      return {
        function: {
          name,
          arguments: parseArgumentsValue(
            fn.arguments ?? fn.parameters ?? fn.params
          ),
        },
      };
    }
  }

  const name = value.name ?? value.tool_name ?? value.tool;
  if (typeof name !== "string" || !KNOWN_TOOL_NAMES.has(name)) {
    return null;
  }

  return {
    function: {
      name,
      arguments: parseArgumentsValue(
        value.parameters ?? value.arguments ?? value.params
      ),
    },
  };
}

function parseJsonToolCalls(content: string): OllamaToolCall[] {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) =>
          item && typeof item === "object"
            ? objectToToolCall(item as Record<string, unknown>)
            : null
        )
        .filter((call): call is OllamaToolCall => call !== null);
    }

    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;

      if (Array.isArray(record.tool_calls)) {
        return record.tool_calls
          .map((item) =>
            item && typeof item === "object"
              ? objectToToolCall(item as Record<string, unknown>)
              : null
          )
          .filter((call): call is OllamaToolCall => call !== null);
      }

      const single = objectToToolCall(record);
      return single ? [single] : [];
    }
  } catch {
    return [];
  }

  return [];
}

function findEmbeddedToolJsonSpans(content: string): {
  start: number;
  end: number;
  call: OllamaToolCall;
}[] {
  const spans: { start: number; end: number; call: OllamaToolCall }[] = [];
  const marker = new RegExp(`"name"\\s*:\\s*"(${TOOL_NAME_PATTERN})"`, "g");
  let match: RegExpExecArray | null;

  while ((match = marker.exec(content)) !== null) {
    let start = match.index;
    while (start > 0 && content[start] !== "{") {
      start--;
    }
    if (content[start] !== "{") continue;

    let depth = 0;
    let end = start;
    for (let i = start; i < content.length; i++) {
      if (content[i] === "{") depth++;
      if (content[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }

    const jsonSlice = content.slice(start, end);
    const calls = parseJsonToolCalls(jsonSlice);
    if (calls[0]) {
      spans.push({ start, end, call: calls[0] });
    }
  }

  return spans;
}

export function looksLikeToolJson(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  if (parseJsonToolCalls(trimmed).length > 0) {
    return true;
  }

  if (findEmbeddedToolJsonSpans(trimmed).length > 0) {
    return true;
  }

  return (
    KNOWN_TOOL_NAMES.has(trimmed) ||
    new RegExp(
      `"name"\\s*:\\s*"(${TOOL_NAME_PATTERN})"`
    ).test(trimmed)
  );
}

export function stripToolArtifactsFromText(content: string): string {
  let text = content.trim();
  if (!text) return "";

  const spans = findEmbeddedToolJsonSpans(text);
  for (let i = spans.length - 1; i >= 0; i--) {
    text = `${text.slice(0, spans[i].start)}${text.slice(spans[i].end)}`;
  }

  text = text
    .replace(
      new RegExp(
        `\\{[^{}]*"name"\\s*:\\s*"(${TOOL_NAME_PATTERN})"[^{}]*\\}`,
        "gi"
      ),
      ""
    )
    .replace(/\btool_calls?\s*:\s*\[[\s\S]*?\]/gi, "")
    .replace(/\b(update_lead_intake|verify_service_scope|get_available_appointment_slots|schedule_appointment|create_deposit_payment)\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

export function extractToolCallsFromAssistantMessage(
  message: OllamaChatMessage
): OllamaToolCall[] {
  if (message.tool_calls?.length) {
    return message.tool_calls;
  }

  const content = message.content?.trim();
  if (!content) {
    return [];
  }

  const embedded = findEmbeddedToolJsonSpans(content).map((span) => span.call);
  if (embedded.length > 0) {
    return embedded;
  }

  return parseJsonToolCalls(content);
}

export function sanitizeAssistantReply(content: string): string {
  const stripped = stripToolArtifactsFromText(content);
  if (!stripped || looksLikeToolJson(stripped)) {
    return "";
  }
  return stripped;
}
