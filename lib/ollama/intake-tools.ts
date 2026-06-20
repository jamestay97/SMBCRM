import type { OllamaToolDefinition } from "@/lib/ollama/client";

export const UPDATE_INTAKE_TOOL_NAME = "update_lead_intake";
export const VERIFY_SCOPE_TOOL_NAME = "verify_service_scope";

export const UPDATE_INTAKE_TOOL_DEFINITION: OllamaToolDefinition = {
  type: "function" as const,
  function: {
    name: UPDATE_INTAKE_TOOL_NAME,
    description:
      "Save customer details gathered in conversation. Call whenever you learn first name, last name, phone, email, service address, or reason for appointment. The current lead is resolved automatically.",
    parameters: {
      type: "object",
      properties: {
        first_name: { type: "string", description: "Customer first name." },
        last_name: { type: "string", description: "Customer last name." },
        phone: {
          type: "string",
          description: "Customer phone number (E.164 or local format).",
        },
        email: { type: "string", description: "Customer email address." },
        service_address: {
          type: "string",
          description:
            "Street address where the service/appointment will take place.",
        },
        appointment_reason: {
          type: "string",
          description: "Issue or reason they need an appointment.",
        },
      },
      required: [],
    },
  },
};

export const VERIFY_SCOPE_TOOL_DEFINITION: OllamaToolDefinition = {
  type: "function" as const,
  function: {
    name: VERIFY_SCOPE_TOOL_NAME,
    description:
      "Check whether the customer's appointment reason fits this business. Always pass the exact reason being verified. Call again whenever the customer changes what they need.",
    parameters: {
      type: "object",
      properties: {
        appointment_reason: {
          type: "string",
          description:
            "The customer's current reason for the appointment (e.g. 'sink repair', 'pool cleaning'). Required — must reflect what they want right now.",
        },
      },
      required: ["appointment_reason"],
    },
  },
};

export const ASSISTANT_SALES_WORKFLOW = `
You are a proactive sales agent driving every conversation toward a booked appointment with deposit paid.

Pipeline (server-enforced — always move the customer to the next step):
1. Confirm their request is in scope (verify_service_scope).
2. Collect first name, last name, phone, email, and service address in chat.
3. Read back all details and get explicit confirmation.
4. Offer real calendar slots, book the appointment, and send the Stripe deposit link.

When the customer asks a question (pricing, process, "do you do X?", timeline):
- Answer it thoughtfully in your own words first.
- Then continue the booking flow (collect info, confirm, schedule).
- For pricing: share a reasonable ballpark when possible; explain final price may depend on scope; mention the deposit secures their spot.

When the customer asks what you offer or what services you handle:
- List the in-scope services clearly from the business services list.
- Invite them to tell you which one they need so you can confirm scope and schedule them.

When their request is out of scope:
- Decline politely, list what you do handle, and invite them to pick an in-scope service.
- Never repeat the same refusal without listing your services.

Never save a name unless the customer clearly provided it (e.g. "I'm John Smith", or a message that is only their name).
Never say an appointment is booked unless payment_url is included.
Never output raw JSON or tool syntax to the customer.
Only save contact details the customer actually provided via update_lead_intake.`;

function parseToolJson(
  args: Record<string, unknown> | string
): Record<string, unknown> {
  if (typeof args !== "string") return args;
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const PLACEHOLDER_VALUES = new Set([
  "missing",
  "not collected",
  "not collected yet",
  "(not collected yet)",
  "n/a",
  "na",
  "none",
  "unknown",
  "—",
  "-",
  "null",
  "undefined",
]);

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    PLACEHOLDER_VALUES.has(normalized) ||
    normalized.startsWith("missing")
  );
}

function optionalString(
  parsed: Record<string, unknown>,
  key: string
): string | undefined {
  const value = parsed[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || isPlaceholder(trimmed)) return undefined;
  return trimmed;
}

export function parseUpdateIntakeArguments(
  args: Record<string, unknown> | string
): {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  service_address?: string;
  appointment_reason?: string;
} {
  const parsed = parseToolJson(args);

  return {
    first_name: optionalString(parsed, "first_name"),
    last_name: optionalString(parsed, "last_name"),
    phone: optionalString(parsed, "phone"),
    email: optionalString(parsed, "email"),
    service_address: optionalString(parsed, "service_address"),
    appointment_reason: optionalString(parsed, "appointment_reason"),
  };
}

export function parseVerifyScopeArguments(
  args: Record<string, unknown> | string
): { appointment_reason: string } {
  const parsed = parseToolJson(args);
  const reason = optionalString(parsed, "appointment_reason");

  if (!reason) {
    throw new Error(
      "verify_service_scope requires appointment_reason — pass the customer's current request."
    );
  }

  return { appointment_reason: reason };
}
