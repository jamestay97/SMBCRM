import {
  matchServiceScope,
  parseServiceTerms,
} from "@/lib/leads/verify-scope";
import { isServicesCatalogQuestion } from "@/lib/leads/infer-contact";

export function servicesScopeToTags(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  return parseServiceTerms(value);
}

export function tagsToServicesScope(tags: string[]): string {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .join(", ");
}

export function normalizeServiceTag(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function formatServicesScopeForPrompt(servicesScope: string): string {
  const terms = parseServiceTerms(servicesScope);
  if (terms.length === 0) return servicesScope;
  return terms.map((term) => `- ${term}`).join("\n");
}

export function buildScopeHintForMessage(
  userMessage: string,
  servicesScope: string
): string | null {
  if (isServicesCatalogQuestion(userMessage)) {
    const terms = parseServiceTerms(servicesScope);
    return (
      "The customer is asking what services you offer. " +
      `List these clearly: ${terms.join(", ") || servicesScope}. ` +
      "Invite them to pick one so you can confirm scope, collect their contact details, and schedule an appointment."
    );
  }

  const match = matchServiceScope(userMessage, servicesScope);
  if (match.match === "in") {
    return (
      `The customer's latest message matches your in-scope service(s): ${match.matchedTerms.join(", ")}. ` +
      "If they want this, save appointment_reason with update_lead_intake, verify scope, then confirm we can help."
    );
  }
  if (match.match === "out") {
    return (
      "The customer's latest message does not match any service you offer. " +
      "Politely decline that specific request, list what you do handle, and invite them to choose an in-scope service. " +
      "If they describe a new request, verify scope again before continuing. " +
      "Do not offer appointment times until scope is confirmed."
    );
  }
  return (
    "Scope for this request is unclear — call verify_service_scope with their current request before booking."
  );
}
