import { llmJsonCompletion } from "@/lib/llm/chat";
import { isPlausibleInferredName } from "@/lib/leads/infer-contact";
import type { ExtractedLeadEntities, LlmProvider } from "@/types/database";

const EXTRACTION_PROMPT = `You extract structured lead data from inbound customer messages.
Return ONLY valid JSON with these keys (use null if unknown):
{
  "first_name": string | null,
  "last_name": string | null,
  "name": string | null,
  "phone": string | null,
  "email": string | null,
  "intent": string | null,
  "service_type": string | null,
  "urgency": "low" | "medium" | "high" | null,
  "notes": string | null
}

Rules:
- NEVER infer a name from greeting words, question text, or the first words of a sentence (e.g. "Hi do you..." is NOT a name).
- Only set first_name/last_name when the customer clearly introduces themselves ("I'm John Smith", "my name is Jane Doe").
- For questions about services, set intent/service_type from what they're asking about instead.`;

export async function extractLeadEntities(params: {
  message: string;
  fromPhone?: string;
  model: string;
  baseUrl?: string;
  provider?: LlmProvider;
  apiKey?: string | null;
}): Promise<ExtractedLeadEntities> {
  const userContent = params.fromPhone
    ? `Customer phone: ${params.fromPhone}\nMessage: ${params.message}`
    : params.message;

  const raw = await llmJsonCompletion({
    systemPrompt: EXTRACTION_PROMPT,
    userContent,
    model: params.model,
    baseUrl: params.baseUrl,
    provider: params.provider,
    apiKey: params.apiKey,
  });

  if (!raw) {
    return fallbackExtraction(params.message, params.fromPhone);
  }

  try {
    const parsed = JSON.parse(raw) as ExtractedLeadEntities;
    let firstName = parsed.first_name ?? null;
    let lastName = parsed.last_name ?? null;
    if (
      firstName &&
      lastName &&
      !isPlausibleInferredName(firstName, lastName)
    ) {
      firstName = null;
      lastName = null;
    }
    const fullName =
      parsed.name ??
      ([firstName, lastName].filter(Boolean).join(" ").trim() || null);
    return {
      first_name: firstName,
      last_name: lastName,
      name: fullName ?? params.fromPhone ?? "Unknown",
      phone: parsed.phone ?? params.fromPhone ?? null,
      email: parsed.email ?? null,
      intent: parsed.intent ?? null,
      service_type: parsed.service_type ?? null,
      urgency: parsed.urgency ?? null,
      notes: parsed.notes ?? params.message,
    };
  } catch {
    return fallbackExtraction(params.message, params.fromPhone);
  }
}

function fallbackExtraction(
  message: string,
  fromPhone?: string
): ExtractedLeadEntities {
  return {
    first_name: null,
    last_name: null,
    name: fromPhone ?? "Unknown",
    phone: fromPhone ?? null,
    email: null,
    intent: message.slice(0, 200),
    service_type: null,
    urgency: null,
    notes: message,
  };
}
