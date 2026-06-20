import type { Lead } from "@/types/database";

export type LeadIntakeFields = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  service_address: string | null;
  appointment_reason: string | null;
  scope_confirmed: boolean;
  scope_acknowledged: boolean;
  intake_name_collected: boolean;
  intake_phone_collected: boolean;
  intake_email_collected: boolean;
  intake_address_collected: boolean;
  contact_confirmed: boolean;
};

export type LeadIntakeRecord = LeadIntakeFields & {
  id: string;
  org_id: string;
  name: string;
};

const INTAKE_FIELD_LABELS: Record<
  Exclude<
    keyof LeadIntakeFields,
    | "scope_confirmed"
    | "scope_acknowledged"
    | "contact_confirmed"
    | "intake_name_collected"
    | "intake_phone_collected"
    | "intake_email_collected"
    | "intake_address_collected"
  >,
  string
> = {
  first_name: "first name",
  last_name: "last name",
  phone: "phone number",
  email: "email",
  service_address: "service address",
  appointment_reason: "reason for appointment",
};

export function looksLikePersonName(value: string): boolean {
  return /^[A-Za-z][A-Za-z'`-]{0,39}$/.test(value.trim());
}

export function looksLikePhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function isScopeInquiry(message: string): boolean {
  const lower = message.trim().toLowerCase();
  return (
    /\b(do you do|can you do|do you handle|can you handle|do you offer|can you help with|will you fix|can you fix|are you able to|do you work on)\b/.test(
      lower
    ) ||
    /\b(do you|can you|will you)\b.*\b(repair|fix|install|service|help)\b/.test(
      lower
    )
  );
}

function hasValidName(lead: LeadIntakeFields): boolean {
  return Boolean(
    lead.first_name?.trim() &&
      lead.last_name?.trim() &&
      looksLikePersonName(lead.first_name) &&
      looksLikePersonName(lead.last_name)
  );
}

function chatIntakeComplete(lead: LeadIntakeFields): boolean {
  return (
    lead.intake_name_collected &&
    lead.intake_phone_collected &&
    lead.intake_email_collected &&
    lead.intake_address_collected
  );
}

export function getMissingIntakeFields(lead: LeadIntakeFields): string[] {
  const missing: string[] = [];

  if (!lead.appointment_reason?.trim()) {
    missing.push(INTAKE_FIELD_LABELS.appointment_reason);
  }
  if (!lead.scope_acknowledged) {
    missing.push("scope acknowledgment");
  }
  if (!lead.scope_confirmed) {
    missing.push("in-scope service confirmation");
  }
  if (!lead.intake_name_collected || !hasValidName(lead)) {
    missing.push("first and last name");
  }
  if (!lead.intake_phone_collected || !lead.phone?.trim()) {
    missing.push(INTAKE_FIELD_LABELS.phone);
  }
  if (!lead.intake_email_collected || !lead.email?.trim()) {
    missing.push(INTAKE_FIELD_LABELS.email);
  }
  if (!lead.intake_address_collected || !lead.service_address?.trim()) {
    missing.push(INTAKE_FIELD_LABELS.service_address);
  }

  return missing;
}

/** Fields required before offering appointment times. */
export function getMissingBookingFields(lead: LeadIntakeFields): string[] {
  return getMissingIntakeFields(lead);
}

export function isIntakeComplete(lead: LeadIntakeFields): boolean {
  return getMissingIntakeFields(lead).length === 0;
}

export function isBookingReady(lead: LeadIntakeFields): boolean {
  return (
    lead.scope_acknowledged &&
    lead.scope_confirmed &&
    chatIntakeComplete(lead) &&
    hasValidName(lead) &&
    Boolean(lead.phone?.trim()) &&
    Boolean(lead.email?.trim()) &&
    Boolean(lead.service_address?.trim()) &&
    Boolean(lead.appointment_reason?.trim())
  );
}

export function assertLeadReadyForBooking(lead: LeadIntakeFields): void {
  const missing = getMissingBookingFields(lead);
  if (missing.length > 0) {
    throw new Error(
      `Cannot book yet — still need: ${missing.join(", ")}. ` +
        "Use update_lead_intake to save customer details and verify_service_scope before scheduling."
    );
  }
  if (!lead.contact_confirmed) {
    throw new Error(
      "Cannot book yet — customer contact details must be confirmed first."
    );
  }
}

export function formatContactSummary(lead: LeadIntakeFields): string {
  const lines = [
    `Name: ${lead.first_name?.trim()} ${lead.last_name?.trim()}`.trim(),
    `Phone: ${lead.phone?.trim() ?? ""}`,
    `Email: ${lead.email?.trim() ?? ""}`,
    `Service address: ${lead.service_address?.trim() ?? ""}`,
  ];

  if (lead.appointment_reason?.trim()) {
    lines.push(`Appointment: ${lead.appointment_reason.trim()}`);
  }

  return lines.filter(Boolean).join("\n");
}

export function buildContactConfirmationPrompt(lead: LeadIntakeFields): string {
  const service = lead.appointment_reason?.trim() ?? "your request";
  const summary = formatContactSummary(lead);
  return (
    `Before we pick a time, please verify your contact details for ${service}:\n${summary}\n\n` +
    `Is everything correct? Reply yes to confirm, or tell me what to update.`
  );
}

export function buildNextIntakeQuestion(lead: LeadIntakeFields): string | null {
  if (!lead.appointment_reason?.trim() || !lead.scope_acknowledged || !lead.scope_confirmed) {
    return null;
  }

  if (!lead.intake_name_collected || !hasValidName(lead)) {
    return `I'd be happy to get you on the schedule. What's your first and last name?`;
  }
  if (!lead.intake_phone_collected || !lead.phone?.trim()) {
    return `Thanks, ${lead.first_name?.trim()}. What's the best phone number to reach you?`;
  }
  if (!lead.intake_email_collected || !lead.email?.trim()) {
    return `And what's your email address? We'll send your appointment confirmation there.`;
  }
  if (!lead.intake_address_collected || !lead.service_address?.trim()) {
    return `What's the service address where our technician should come out?`;
  }

  return null;
}

/** Keep the sales conversation moving — append the next pipeline step when ready. */
export function composeSalesReply(lead: LeadIntakeFields, message: string): string {
  const trimmed = message.trim();
  const next = buildNextIntakeQuestion(lead);
  if (next) {
    if (!trimmed) return next;
    if (trimmed.includes(next)) return trimmed;
    return `${trimmed} ${next}`;
  }

  if (isBookingReady(lead) && !lead.contact_confirmed) {
    return buildContactConfirmationPrompt(lead);
  }

  return trimmed;
}

export function buildIntakeCaptureReply(
  before: LeadIntakeFields,
  after: LeadIntakeFields
): string | null {
  const ack: string[] = [];

  if (
    after.intake_name_collected &&
    !before.intake_name_collected &&
    after.first_name?.trim()
  ) {
    const name = [after.first_name, after.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    ack.push(`Thanks, ${name}!`);
  }

  if (
    after.intake_address_collected &&
    !before.intake_address_collected &&
    after.service_address?.trim()
  ) {
    ack.push(`I have the service address as ${after.service_address.trim()}.`);
  }

  if (
    after.intake_email_collected &&
    !before.intake_email_collected &&
    after.email?.trim()
  ) {
    ack.push(`Got your email: ${after.email.trim()}.`);
  }

  if (
    after.intake_phone_collected &&
    !before.intake_phone_collected &&
    after.phone?.trim() &&
    !before.phone?.trim()
  ) {
    ack.push(`I'll reach you at ${after.phone.trim()}.`);
  }

  if (ack.length === 0) return null;

  const next = buildNextIntakeQuestion(after);
  if (next) return `${ack.join(" ")} ${next}`;

  if (isBookingReady(after) && !after.contact_confirmed) {
    return `${ack.join(" ")} ${buildContactConfirmationPrompt(after)}`;
  }

  return ack.join(" ");
}

export function formatIntakeStatus(lead: LeadIntakeFields): string {
  const bookingMissing = getMissingBookingFields(lead);
  const lines: string[] = [];

  if (lead.first_name?.trim()) lines.push(`First name: ${lead.first_name.trim()}`);
  if (lead.last_name?.trim()) lines.push(`Last name: ${lead.last_name.trim()}`);
  if (lead.phone?.trim()) lines.push(`Phone: ${lead.phone.trim()}`);
  if (lead.email?.trim()) lines.push(`Email: ${lead.email.trim()}`);
  if (lead.service_address?.trim()) {
    lines.push(`Service address: ${lead.service_address.trim()}`);
  }
  if (lead.appointment_reason?.trim()) {
    lines.push(`Reason for appointment: ${lead.appointment_reason.trim()}`);
  }
  lines.push(`Scope acknowledged: ${lead.scope_acknowledged ? "yes" : "no"}`);
  lines.push(`In scope: ${lead.scope_confirmed ? "yes" : "no"}`);
  lines.push(`Contact confirmed: ${lead.contact_confirmed ? "yes" : "no"}`);

  if (bookingMissing.length > 0) {
    lines.push(`Still needed before booking: ${bookingMissing.join(", ")}`);
  } else if (!lead.contact_confirmed) {
    lines.push(
      "All contact fields collected in chat — read back details and ask the customer to confirm before offering times."
    );
  } else {
    lines.push("Intake complete — you may offer calendar times and collect deposit.");
  }

  return lines.join("\n");
}

export function buildDisplayName(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  fallback = "Unknown"
): string {
  const full = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return full || fallback;
}
