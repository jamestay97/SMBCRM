import type { LeadIntakeRecord } from "@/lib/leads/intake";
import {
  isPlausibleAppointmentReason,
  looksLikeContactInfoMessage,
  normalizeAppointmentReason,
} from "@/lib/leads/appointment-reason";import {
  inferNameFromMessage,
  isPlausibleInferredName,
} from "@/lib/leads/infer-contact";
import {
  loadLeadIntakeRecord,
  updateLeadIntake,
} from "@/lib/leads/intake-actions";
import { matchServiceScope } from "@/lib/leads/verify-scope";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/;
const ADDRESS_EXPLICIT_RE =
  /\b(?:address is|service address is|located at|live at|i'?m at|we'?re at|it would be at|would be at)\s+(.+)/i;
const ADDRESS_AT_NUMBER_RE =
  /\b(?:at\s+)?(\d{1,6}\s+[A-Za-z0-9.'\-\s]{3,80}(?:\b(?:st|street|ste|suite|apt|unit|ave|avenue|rd|road|blvd|boulevard|drive|dr|ln|lane|way|ct|court|pl|place|fl|florida)\b)[A-Za-z0-9.'\-\s]{0,40})/i;
function extractServiceFromInquiry(message: string): string | undefined {
  const trimmed = message.trim();
  const patterns = [
    /\bdo you do\s+(.+?)\??\s*$/i,
    /\bcan you (?:help with|fix|repair|handle|do)\s+(.+?)\??\s*$/i,
    /\bdo you (?:fix|repair|handle|work on|sell|offer)\s+(.+?)\??\s*$/i,
    /\b(?:quote on|quote for|estimate for|price for|cost for|how much (?:for|to))\s+(.+?)\??\s*$/i,
    /\b(?:fix|repair|fixing| repairing)\s+(?:my\s+)?(.+?)\??\s*$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim().replace(/[.!?]+$/, "");
    }
  }

  return undefined;
}

function looksLikeServicePivot(message: string): boolean {
  return /\b(actually|instead|rather|what about|how about|oh really|you just said|you said|can you|could you|give me a quote|quote on|quote for|estimate for|fix my|repair my|help with my|how much)\b/i.test(
    message
  );
}

function inferAppointmentReason(
  userMessage: string,
  servicesScope: string
): string | undefined {
  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length < 4) return undefined;

  const fromInquiry = extractServiceFromInquiry(trimmed);
  if (fromInquiry) return fromInquiry.slice(0, 200);

  const match = matchServiceScope(trimmed, servicesScope);
  if (match.match === "in" && match.matchedTerms.length > 0) {
    return match.matchedTerms.join(", ");
  }

  const lower = trimmed.toLowerCase();
  if (
    /\b(repair|fix|install|replace|clean|service|broken|leak|appointment|tiling|tile|grout|bathroom|drywall|mailbox|sink|window)\b/.test(
      lower
    )
  ) {
    if (looksLikeContactInfoMessage(trimmed)) {
      const scoped = matchServiceScope(trimmed, servicesScope);
      if (scoped.match === "in" && scoped.matchedTerms.length > 0) {
        return scoped.matchedTerms.join(", ").slice(0, 200);
      }
      return undefined;
    }
    const normalized = normalizeAppointmentReason({
      candidate: trimmed,
      servicesScope,
    });
    return normalized;
  }

  return undefined;
}

export function inferAppointmentReasonFromMessage(
  userMessage: string,
  servicesScope: string
): string | undefined {
  return inferAppointmentReason(userMessage, servicesScope);
}

function resolveAppointmentReasonUpdate(params: {
  lead: LeadIntakeRecord;
  userMessage: string;
  servicesScope: string;
}): string | undefined {
  const inferred = inferAppointmentReason(
    params.userMessage,
    params.servicesScope
  );
  if (!inferred || !isPlausibleAppointmentReason(inferred)) return undefined;

  const current = params.lead.appointment_reason?.trim();
  if (!current) return inferred;

  if (looksLikeContactInfoMessage(inferred)) {
    return undefined;
  }

  const currentScope = matchServiceScope(current, params.servicesScope);
  const newScope = matchServiceScope(inferred, params.servicesScope);
  const messageScope = matchServiceScope(
    params.userMessage,
    params.servicesScope
  );

  // Stuck on an out-of-scope reason — customer pivoted to something we handle.
  if (
    !params.lead.scope_confirmed &&
    (messageScope.match === "in" || newScope.match === "in")
  ) {
    return inferred;
  }

  if (looksLikeServicePivot(params.userMessage) && newScope.match === "in") {
    return inferred;
  }

  if (looksLikeCorrection(params.userMessage) && inferred !== current) {
    return inferred;
  }

  if (currentScope.match === "out" && newScope.match === "in") {
    return inferred;
  }

  return undefined;
}

function inferPhoneFromMessage(userMessage: string): string | undefined {
  const match = userMessage.match(PHONE_RE);
  if (!match) return undefined;
  const digits = match[0].replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  return match[0].trim();
}

function inferAddressFromMessage(userMessage: string): string | undefined {
  const trimmed = userMessage.trim();
  const explicit = trimmed.match(ADDRESS_EXPLICIT_RE);
  if (explicit?.[1]) {
    return explicit[1].trim().replace(/[.!?]+$/, "").slice(0, 300);
  }

  const street = trimmed.match(ADDRESS_AT_NUMBER_RE);
  if (street?.[1]) {
    return street[1].trim().replace(/[.!?]+$/, "").slice(0, 300);
  }

  return undefined;
}
function looksLikeCorrection(message: string): boolean {
  return /\b(actually|instead|change|update|correct|wrong|my email|my phone|my address|email is|phone is|address is)\b/i.test(
    message
  );
}

async function clearInvalidLeadName(params: {
  orgId: string;
  leadId: string;
  lead: LeadIntakeRecord;
}): Promise<LeadIntakeRecord> {
  if (
    !params.lead.intake_name_collected ||
    !params.lead.first_name?.trim() ||
    !params.lead.last_name?.trim()
  ) {
    return params.lead;
  }

  if (
    isPlausibleInferredName(params.lead.first_name, params.lead.last_name)
  ) {
    return params.lead;
  }

  return updateLeadIntake({
    orgId: params.orgId,
    leadId: params.leadId,
    patch: { reset_name: true },
  });
}

export async function syncLeadIntakeFromUserMessage(params: {
  orgId: string;
  leadId: string;
  userMessage: string;
  servicesScope: string;
}): Promise<LeadIntakeRecord> {
  let lead = await loadLeadIntakeRecord(params);
  lead = await clearInvalidLeadName({
    orgId: params.orgId,
    leadId: params.leadId,
    lead,
  });

  const patch: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
    service_address?: string;
    appointment_reason?: string;
    intake_name_collected?: boolean;
    intake_phone_collected?: boolean;
    intake_email_collected?: boolean;
    intake_address_collected?: boolean;
  } = {};

  const inferredName = inferNameFromMessage(params.userMessage);
  if (inferredName) {
    patch.first_name = inferredName.first_name;
    patch.last_name = inferredName.last_name;
    patch.intake_name_collected = true;
  }

  const inferredPhone = inferPhoneFromMessage(params.userMessage);
  if (
    inferredPhone &&
    (!lead.intake_phone_collected || looksLikeCorrection(params.userMessage))
  ) {
    patch.phone = inferredPhone;
    patch.intake_phone_collected = true;
  }

  const emailMatch = params.userMessage.match(EMAIL_RE);
  if (
    emailMatch &&
    (!lead.intake_email_collected || looksLikeCorrection(params.userMessage))
  ) {
    patch.email = emailMatch[0];
    patch.intake_email_collected = true;
  }

  const inferredAddress = inferAddressFromMessage(params.userMessage);
  if (
    inferredAddress &&
    (!lead.intake_address_collected || looksLikeCorrection(params.userMessage))
  ) {
    patch.service_address = inferredAddress;
    patch.intake_address_collected = true;
  }

  if (!lead.appointment_reason?.trim()) {
    const reason = inferAppointmentReason(
      params.userMessage,
      params.servicesScope
    );
    if (reason) {
      patch.appointment_reason = reason;
    }
  } else {
    const updatedReason = resolveAppointmentReasonUpdate({
      lead,
      userMessage: params.userMessage,
      servicesScope: params.servicesScope,
    });
    if (updatedReason) {
      patch.appointment_reason = updatedReason;
    }
  }

  if (Object.keys(patch).length > 0) {
    lead = await updateLeadIntake({
      orgId: params.orgId,
      leadId: params.leadId,
      patch,
    });
  }

  // Phone on the lead record (from signup/SMS) counts as collected.
  if (lead.phone?.trim() && !lead.intake_phone_collected) {
    lead = await updateLeadIntake({
      orgId: params.orgId,
      leadId: params.leadId,
      patch: { intake_phone_collected: true },
    });
  }

  return lead;
}
