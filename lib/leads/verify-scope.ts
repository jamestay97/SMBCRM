import {
  extractPrimaryServiceSubject,
  formatReasonForCustomer,
} from "@/lib/leads/appointment-reason";
import { llmJsonCompletion } from "@/lib/llm/chat";
import { scopeWordsMatch } from "@/lib/leads/scope-word-match";
import type { LlmProvider } from "@/types/database";

export type ScopeVerificationResult = {
  in_scope: boolean;
  summary: string;
  customer_message: string;
};

export type ScopeMatchResult = {
  match: "in" | "out" | "ambiguous";
  matchedTerms: string[];
};

const SCOPE_STOP_WORDS = new Set([
  "about",
  "appointment",
  "broken",
  "customer",
  "fix",
  "fixing",
  "help",
  "need",
  "please",
  "repair",
  "repairs",
  "service",
  "services",
  "the",
  "their",
  "want",
  "with",
  "would",
  "like",
  "get",
  "have",
  "just",
  "fine",
  "okay",
]);

const SCOPE_PROMPT = `You decide if a customer's appointment request fits what the business offers.
Return ONLY valid JSON:
{
  "in_scope": boolean,
  "summary": string,
  "customer_message": string
}

Rules:
- in_scope is true only when the request clearly fits the business services list.
- When the services list is broad or general (e.g. "general service appointments", "home repair"), treat typical residential repair/maintenance requests as in scope unless clearly unrelated.
- Do not reject a request when its service type appears in the services list.
- When out of scope, politely decline and list what the business does handle. Invite them to choose an in-scope service you can schedule.
- summary is a short internal note for staff.
- customer_message is what to tell the customer. If in_scope, confirm we can help and mention next steps (collect details, schedule). If out of scope, decline and suggest an in-scope alternative when possible.`;

const BROAD_SCOPE_HINTS =
  /\b(general|appointment|appointments|maintenance|handyman|home service|residential|commercial service|all types|variety|wide range|repair and maintenance)\b/i;

const CLEAR_IN_SCOPE_HOME_SERVICES =
  /\b(sinks?|faucets?|toilets?|drains?|pipes?|garbage disposals?|water heaters?|outlets?|wiring|leaks?|drywall|tiles?|grout|doors?|windows?|hvac|furnaces?|heaters?|mailboxes?|bathrooms?|kitchens?)\b/i;

export function isBroadServicesScope(servicesScope: string): boolean {
  const terms = parseServiceTerms(servicesScope);
  if (terms.length === 0) return true;
  if (terms.length <= 2) {
    return terms.every(
      (term) =>
        BROAD_SCOPE_HINTS.test(term) ||
        term.split(/\s+/).length <= 4
    );
  }
  return false;
}

export function parseServiceTerms(servicesScope: string): string[] {
  return servicesScope
    .split(/[,;\n•]|(?:\s+and\s+)/i)
    .map((segment) =>
      segment
        .trim()
        .replace(
          /^(we\s+)?(specialize in|offer|do|handle|provide|support)\s+/i,
          ""
        )
        .replace(/\.$/, "")
    )
    .filter((term) => term.length > 2);
}

export function extractSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !SCOPE_STOP_WORDS.has(word));
}

function termMatchesReason(term: string, reason: string): boolean {
  const normalizedTerm = term.toLowerCase().trim();
  const normalizedReason = reason.toLowerCase().trim();

  if (normalizedReason.includes(normalizedTerm)) return true;

  const termWords = extractSignificantWords(normalizedTerm);
  const reasonWords = extractSignificantWords(normalizedReason);
  const termsToCheck =
    termWords.length > 0 ? termWords : normalizedTerm.length >= 3 ? [normalizedTerm] : [];

  for (const termWord of termsToCheck) {
    if (normalizedReason.includes(termWord)) return true;
    for (const reasonWord of reasonWords) {
      if (scopeWordsMatch(termWord, reasonWord)) return true;
    }
  }

  return false;
}

function collectScopeOverlaps(
  reasonWords: string[],
  servicesScope: string
): string[] {
  const terms = parseServiceTerms(servicesScope);
  const matched = new Set<string>();

  for (const reasonWord of reasonWords) {
    for (const term of terms) {
      if (termMatchesReason(term, reasonWord)) {
        matched.add(term);
      }
    }

    const scopeWords = extractSignificantWords(servicesScope);
    for (const scopeWord of scopeWords) {
      if (scopeWordsMatch(reasonWord, scopeWord)) {
        matched.add(scopeWord);
      }
    }
  }

  return Array.from(matched);
}

export function matchServiceScope(
  appointmentReason: string,
  servicesScope: string
): ScopeMatchResult {
  const reason = appointmentReason.toLowerCase().trim();
  const scope = servicesScope.toLowerCase().trim();

  if (!reason) {
    return { match: "ambiguous", matchedTerms: [] };
  }

  if (!scope) {
    return { match: "ambiguous", matchedTerms: [] };
  }

  const terms = parseServiceTerms(servicesScope);
  const matchedTerms: string[] = [];

  for (const term of terms) {
    if (termMatchesReason(term, reason)) {
      matchedTerms.push(term);
    }
  }

  if (matchedTerms.length > 0) {
    return { match: "in", matchedTerms };
  }

  const reasonWords = extractSignificantWords(reason);
  const overlapping = collectScopeOverlaps(reasonWords, servicesScope);

  if (overlapping.length > 0) {
    return { match: "in", matchedTerms: overlapping };
  }

  if (terms.length > 0 && reasonWords.length > 0) {
    if (isBroadServicesScope(servicesScope)) {
      if (CLEAR_IN_SCOPE_HOME_SERVICES.test(reason)) {
        const label =
          extractPrimaryServiceSubject(reason) ??
          reasonWords.find((word) => CLEAR_IN_SCOPE_HOME_SERVICES.test(word)) ??
          reason;
        return { match: "in", matchedTerms: [label] };
      }
      return { match: "ambiguous", matchedTerms: [] };
    }
    return { match: "out", matchedTerms: [] };
  }

  return { match: "ambiguous", matchedTerms: [] };
}

function formatServicesSummary(servicesScope: string): string {
  const terms = parseServiceTerms(servicesScope);
  if (terms.length === 0) return servicesScope.slice(0, 200);
  if (terms.length <= 4) return terms.join(", ");
  return `${terms.slice(0, 4).join(", ")}, and more`;
}

export function buildServicesOfferMessage(servicesScope: string): string {
  const terms = parseServiceTerms(servicesScope);
  if (terms.length === 0) {
    return "We handle a range of home repair and maintenance services. Tell me what you need and I'll confirm we can help, collect your details, and get you on the calendar.";
  }
  const summary = formatServicesSummary(servicesScope);
  return `We specialize in ${summary}. Tell me what you need help with and I'll confirm we can handle it, verify your contact info, and schedule your appointment.`;
}

export function buildOutOfScopeGuidanceReply(params: {
  servicesScope: string;
  appointmentReason?: string | null;
}): string {
  const offer = buildServicesOfferMessage(params.servicesScope);
  const reason = params.appointmentReason?.trim();
  if (reason) {
    const label = formatReasonForCustomer(reason, params.servicesScope);
    return `I'm sorry, ${label} isn't something we handle. ${offer}`;
  }
  return offer;
}

function deterministicScopeResult(params: {
  appointmentReason: string;
  servicesScope: string;
  match: ScopeMatchResult;
}): ScopeVerificationResult {
  const servicesSummary = formatServicesSummary(params.servicesScope);

  if (params.match.match === "in") {
    return {
      in_scope: true,
      summary: `Matches services scope (${params.match.matchedTerms.join(", ")}).`,
      customer_message: `Yes — we handle ${formatReasonForCustomer(params.appointmentReason, params.servicesScope)}. I'd be happy to get you scheduled.`,
    };
  }

  return {
    in_scope: false,
    summary: `No overlap with services scope: ${servicesSummary}.`,
    customer_message: `I'm sorry, ${formatReasonForCustomer(params.appointmentReason, params.servicesScope)} isn't something we handle. We specialize in ${servicesSummary}. If any of those work for you, tell me which one and I'll get you scheduled.`,
  };
}

export async function verifyServiceScope(params: {
  servicesScope: string;
  businessName: string;
  appointmentReason: string;
  model?: string;
  baseUrl?: string;
  provider?: LlmProvider;
  apiKey?: string | null;
}): Promise<ScopeVerificationResult> {
  const deterministic = matchServiceScope(
    params.appointmentReason,
    params.servicesScope
  );

  if (deterministic.match === "in" || deterministic.match === "out") {
    return deterministicScopeResult({
      appointmentReason: params.appointmentReason,
      servicesScope: params.servicesScope,
      match: deterministic,
    });
  }

  return llmScopeCheck(params);
}

async function llmScopeCheck(params: {
  servicesScope: string;
  businessName: string;
  appointmentReason: string;
  model?: string;
  baseUrl?: string;
  provider?: LlmProvider;
  apiKey?: string | null;
}): Promise<ScopeVerificationResult> {
  const userContent = `Business: ${params.businessName}
Services we offer:
${params.servicesScope}

Customer's reason for appointment:
${params.appointmentReason}`;

  try {
    const raw = await llmJsonCompletion({
      systemPrompt: SCOPE_PROMPT,
      userContent,
      model: params.model,
      baseUrl: params.baseUrl,
      provider: params.provider,
      apiKey: params.apiKey,
    });

    if (!raw) {
      return ambiguousFallback(params);
    }

    const parsed = JSON.parse(raw) as ScopeVerificationResult;
    return {
      in_scope: Boolean(parsed.in_scope),
      summary: parsed.summary ?? "",
      customer_message:
        parsed.customer_message ??
        (parsed.in_scope
          ? `Yes — we can help with ${params.appointmentReason}.`
          : `I'm sorry, that may be outside what we handle.`),
    };
  } catch {
    return ambiguousFallback(params);
  }
}

function ambiguousFallback(params: {
  servicesScope: string;
  appointmentReason: string;
}): ScopeVerificationResult {
  const servicesSummary = formatServicesSummary(params.servicesScope);
  return {
    in_scope: false,
    summary: "Could not confidently match request to services scope.",
    customer_message: `I want to make sure we can help before booking. We handle ${servicesSummary}. Does your request fit one of those?`,
  };
}
