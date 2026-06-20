import { looksLikePersonName } from "@/lib/leads/intake";

const NOT_NAME_WORDS = new Set([  "a",
  "an",
  "and",
  "are",
  "can",
  "could",
  "do",
  "does",
  "for",
  "get",
  "have",
  "he",
  "hello",
  "hey",
  "hi",
  "how",
  "i",
  "i'd",
  "i'm",
  "if",
  "is",
  "it",
  "me",
  "my",
  "need",
  "no",
  "ok",
  "okay",
  "please",
  "she",
  "thanks",
  "thank",
  "the",
  "this",
  "to",
  "want",
  "we",
  "what",
  "when",
  "where",
  "who",
  "why",
  "will",
  "would",
  "yes",
  "you",
  "your",
]);

export function isPlausibleInferredName(
  firstName: string,
  lastName: string
): boolean {
  const first = firstName.trim();
  const last = lastName.trim();
  if (!looksLikePersonName(first) || !looksLikePersonName(last)) {
    return false;
  }
  if (
    NOT_NAME_WORDS.has(first.toLowerCase()) ||
    NOT_NAME_WORDS.has(last.toLowerCase())
  ) {
    return false;
  }
  return true;
}

export function isCustomerQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return (
    trimmed.includes("?") ||
    /\b(how much|how do|what do|what does|do you|can you|will you|why|when|where|cost|price|quote|estimate|charge|fee|typical|ballpark)\b/i.test(
      trimmed
    )
  );
}

/** Customer is asking what the business offers — not requesting a specific service yet. */
export function isServicesCatalogQuestion(message: string): boolean {
  const lower = message.trim().toLowerCase();
  if (!lower) return false;
  return (
    /\b(what do you offer|what services|what can you help|what do you do|what does your company|what are your services|what kinds of|what type of|list (?:of )?services|tell me what you|what you offer|what you handle|what you specialize|services do you|do you offer)\b/.test(
      lower
    ) ||
    /^(?:what|which)\s+(?:services|things|work|jobs)\b/.test(lower)
  );
}

export function inferNameFromMessage(
  userMessage: string
): { first_name: string; last_name: string } | undefined {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return undefined;
  }

  const introPatterns = [
    /\b(?:i'?m|i am|my name is|this is|call me|it'?s)\s+([A-Za-z][A-Za-z'`-]+)\s+([A-Za-z][A-Za-z'`-]+)/i,
    /\b(?:yeah|yes|yep|ok|okay)[,.]?\s+my name is\s+([A-Za-z][A-Za-z'`-]+)\s+([A-Za-z][A-Za-z'`-]+)/i,
  ];

  for (const pattern of introPatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1] && match?.[2]) {
      const first_name = match[1];
      const last_name = match[2];
      if (isPlausibleInferredName(first_name, last_name)) {
        return { first_name, last_name };
      }
    }
  }

  // Don't treat general questions as name-only messages.
  if (isCustomerQuestion(trimmed)) {
    return undefined;
  }

  // Standalone "First Last" with nothing else in the message.
  const standalone = trimmed.match(
    /^([A-Za-z][A-Za-z'`-]+)\s+([A-Za-z][A-Za-z'`-]+)\.?$/
  );
  if (standalone?.[1] && standalone?.[2]) {
    const first_name = standalone[1];
    const last_name = standalone[2];
    if (isPlausibleInferredName(first_name, last_name)) {
      return { first_name, last_name };
    }
  }

  return undefined;
}

export function appendPipelineStep(
  assistantReply: string,
  pipelineStep: string
): string {
  const assistant = assistantReply.trim();
  const step = pipelineStep.trim();
  if (!step) return assistant;
  if (!assistant) return step;
  if (assistant.includes(step)) return assistant;
  return `${assistant} ${step}`;
}
