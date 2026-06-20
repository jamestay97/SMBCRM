import type { OllamaToolDefinition } from "@/lib/ollama/client";

export const SLOTS_TOOL_NAME = "get_available_appointment_slots";
export const SCHEDULE_TOOL_NAME = "schedule_appointment";

export const SLOTS_TOOL_DEFINITION: OllamaToolDefinition = {
  type: "function" as const,
  function: {
    name: SLOTS_TOOL_NAME,
    description:
      "List open appointment times within the business calendar. Call this before offering times to the lead. The current lead is resolved automatically.",
    parameters: {
      type: "object",
      properties: {
        days_ahead: {
          type: "number",
          description: "How many days ahead to search (default 7, max 14).",
        },
      },
      required: [],
    },
  },
};

export const SCHEDULE_TOOL_DEFINITION: OllamaToolDefinition = {
  type: "function" as const,
  function: {
    name: SCHEDULE_TOOL_NAME,
    description:
      "Reserve an appointment slot after the lead picks a time. Returns confirmation_summary — read it back and get customer approval before creating the deposit link.",
    parameters: {
      type: "object",
      properties: {
        starts_at: {
          type: "string",
          description:
            "ISO 8601 UTC start time from get_available_appointment_slots (e.g. 2025-06-20T14:00:00.000Z).",
        },
      },
      required: ["starts_at"],
    },
  },
};

export function parseSlotsToolArguments(
  args: Record<string, unknown> | string
): { days_ahead: number } {
  const parsed =
    typeof args === "string"
      ? (JSON.parse(args) as Record<string, unknown>)
      : args;

  const daysAhead = Number(parsed.days_ahead ?? 7);
  return {
    days_ahead: Math.min(14, Math.max(1, Number.isFinite(daysAhead) ? daysAhead : 7)),
  };
}

export function parseScheduleToolArguments(
  args: Record<string, unknown> | string
): { starts_at: string } {
  const parsed =
    typeof args === "string"
      ? (JSON.parse(args) as Record<string, unknown>)
      : args;

  return {
    starts_at: String(parsed.starts_at ?? ""),
  };
}
