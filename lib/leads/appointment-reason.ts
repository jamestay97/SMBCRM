import { matchServiceScope } from "@/lib/leads/verify-scope";

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
