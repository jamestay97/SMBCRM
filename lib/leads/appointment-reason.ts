import { matchServiceScope } from "@/lib/leads/verify-scope";

const SERVICE_NOUN_RE =
  /\b(roof(?:ing)?|sinks?|faucets?|toilets?|drains?|pipes?|hvac|furnaces?|heaters?|water heaters?|drywall|tiles?|grout|windows?|doors?|garbage disposals?|outlets?|wiring|leaks?|pools?|decks?|fences?|gutters?|mailboxes?|bathrooms?|kitchens?)\b/i;

const CONTACT_INFO_RE =
  /\b(?:my name is|i'?m|i am|this is|call me|email is|phone is|address is|it would be at|located at|@\w|\d{1,6}\s+\w+\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|way|ct|court|pl|place)\b)/i;

/** True when text looks like contact/intake info, not a service description. */
export function looksLikeContactInfoMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.length > 120 && CONTACT_INFO_RE.test(trimmed)) return true;
  if (CONTACT_INFO_RE.test(trimmed) && trimmed.split(/[,.\n]/).length >= 2) {
    return true;
  }
  return false;
}

export function isPlausibleAppointmentReason(reason: string): boolean {
  const trimmed = reason.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (looksLikeContactInfoMessage(trimmed)) return false;
  if (trimmed.length > 80) return false;
  return true;
}

export function looksLikeNewServiceRequest(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length < 4) return false;
  if (looksLikeContactInfoMessage(trimmed)) return false;

  return (
    /\b(how much|quote|estimate|cost for|price for|fix my|repair my|fix the|repair the|help with my|help with the|can you fix|could you fix|can you repair|could you repair|need someone to|come out for|looking for|looking to|something wrong with)\b/i.test(
      trimmed
    ) ||
    Boolean(extractServiceFromMessage(trimmed)) ||
    SERVICE_NOUN_RE.test(trimmed)
  );
}

export function extractServiceFromMessage(message: string): string | undefined {
  const trimmed = message.trim();
  const patterns = [
    /\bdo you do\s+(.+?)\??\s*$/i,
    /\bcan you (?:help with|fix|repair|handle|do)\s+(.+?)\??\s*$/i,
    /\bdo you (?:fix|repair|handle|work on|sell|offer)\s+(.+?)\??\s*$/i,
    /\b(?:quote on|quote for|estimate for|price for|cost for|how much (?:for|to|would it cost for))\s+(.+?)\??\s*$/i,
    /\b(?:fix|repair|fixing|repairing)\s+(?:my\s+|the\s+|a\s+)?(.+?)\??\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim().replace(/[.!?]+$/, "");
    }
  }

  return undefined;
}

/** Short label for scope checks — avoids storing the entire chat message. */
export function extractPrimaryServiceSubject(message: string): string | undefined {
  const fromInquiry = extractServiceFromMessage(message);
  if (fromInquiry) {
    const noun = fromInquiry.match(SERVICE_NOUN_RE);
    if (noun) return noun[0].toLowerCase();
    if (isPlausibleAppointmentReason(fromInquiry)) return fromInquiry.slice(0, 80);
  }

  const noun = message.match(SERVICE_NOUN_RE);
  if (noun) return noun[0].toLowerCase();

  return undefined;
}

/** Pick a short service label for scope messages — never echo the full chat. */
export function normalizeAppointmentReason(params: {
  candidate: string;
  servicesScope: string;
  fallback?: string | null;
}): string | undefined {
  const trimmed = params.candidate.trim();
  if (!trimmed) return params.fallback?.trim() || undefined;

  if (isPlausibleAppointmentReason(trimmed)) {
    return trimmed.slice(0, 200);
  }

  const match = matchServiceScope(trimmed, params.servicesScope);
  if (match.match === "in" && match.matchedTerms.length > 0) {
    return match.matchedTerms.join(", ").slice(0, 200);
  }

  return params.fallback?.trim() || undefined;
}

export function formatReasonForCustomer(
  reason: string,
  servicesScope: string
): string {
  if (isPlausibleAppointmentReason(reason)) {
    return reason.trim();
  }
  const match = matchServiceScope(reason, servicesScope);
  if (match.matchedTerms.length > 0) {
    return match.matchedTerms[0];
  }
  return "your request";
}
