import type { AvailableSlot } from "@/lib/calendar/slots";
import { getAvailableSlots } from "@/lib/calendar/slots";
import {
  findMatchingAvailableSlot,
  parseClockTime,
  collectDayHints,
  filterSlotsByDayHints,
} from "@/lib/calendar/match-slot";
import {
  scheduleAppointment,
} from "@/lib/calendar/schedule";
import type { OllamaChatMessage } from "@/lib/ollama/client";
import { syncLeadIntakeFromUserMessage } from "@/lib/ollama/intake-sync";
import { looksLikeToolJson, stripToolArtifactsFromText, sanitizeAssistantReply } from "@/lib/ollama/tool-calls";
import {
  getMissingBookingFields,
  isBookingReady,
  type LeadIntakeRecord,
} from "@/lib/leads/intake";
import {
  loadLeadIntakeRecord,
  updateLeadIntake,
} from "@/lib/leads/intake-actions";
import { createDepositPayment } from "@/lib/stripe/create-deposit-payment";
import { loadLeadBookingPaymentState } from "@/lib/stripe/payment-status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Appointment } from "@/types/database";

const AFFIRMATIVE_RE =
  /\b(yes|yeah|yep|sure|ok|okay|fine|works|good|sounds good|that works|book it|perfect|confirm|let'?s do|i'?ll take|is fine|go ahead)\b/i;

const PAYMENT_PLACEHOLDER_RE =
  /\[payment_url\]|\{payment_url\}|\{\{payment_url\}\}/i;

export function polishAssistantReply(content: string): string {
  let text = content.trim();
  if (!text) return "";

  text = text.replace(/^(assistant|Assistant)\s*[:\-]?\s*/i, "");
  text = stripToolArtifactsFromText(text);
  const sanitized = sanitizeAssistantReply(text);
  return (sanitized || text).trim();
}

export function replyNeedsPaymentUrl(reply: string): boolean {
  return PAYMENT_PLACEHOLDER_RE.test(reply) || /\bdeposit\b/i.test(reply);
}

export function applyPaymentUrlToReply(reply: string, paymentUrl: string): string {
  if (!paymentUrl) return reply;

  let result = reply
    .replace(/\[payment_url\]/gi, paymentUrl)
    .replace(/\{payment_url\}/gi, paymentUrl)
    .replace(/\{\{payment_url\}\}/gi, paymentUrl);

  if (!result.includes(paymentUrl)) {
    result = `${result.trim()}\n\nPay your deposit here: ${paymentUrl}`;
  }

  return result;
}

function isPureAffirmative(message: string): boolean {
  const trimmed = message.trim();
  if (!AFFIRMATIVE_RE.test(trimmed)) return false;
  if (parseClockTime(trimmed, trimmed)) return false;
  if (
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i.test(
      trimmed
    )
  ) {
    return false;
  }
  return true;
}

function isAffirmativeMessage(message: string): boolean {
  return AFFIRMATIVE_RE.test(message.trim());
}

function isTimeSelectionMessage(message: string): boolean {
  const trimmed = message.trim();
  if (/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\b/i.test(trimmed)) {
    return true;
  }
  if (
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  return isAffirmativeMessage(trimmed);
}

function isFollowUpConfusion(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return /^(what|huh|\?|wait)\??$/.test(trimmed);
}

function getLastTimeSelectionUserMessage(
  messages: OllamaChatMessage[]
): string | null {
  let fallback: string | null = null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user" || isFollowUpConfusion(message.content)) {
      continue;
    }

    const trimmed = message.content.trim();
    if (
      parseClockTime(trimmed, trimmed) ||
      /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i.test(
        trimmed
      )
    ) {
      return message.content;
    }

    if (!fallback && isTimeSelectionMessage(trimmed)) {
      fallback = message.content;
    }
  }

  return fallback;
}

export function getSchedulingContext(
  messages: OllamaChatMessage[],
  assistantReply?: string
): string {
  const assistantMessages: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === "assistant" && message.content.trim()) {
      assistantMessages.unshift(message.content.trim());
      if (assistantMessages.length >= 3) break;
    }
  }

  if (assistantReply?.trim()) {
    assistantMessages.push(assistantReply.trim());
  }

  return assistantMessages.join(" ");
}

function buildFullConversationContext(
  messages: OllamaChatMessage[],
  userMessage: string,
  assistantReply?: string
): string {
  const userLines = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);

  if (userMessage.trim()) {
    userLines.push(userMessage.trim());
  }

  return `${userLines.join(" ")} ${getSchedulingContext(messages, assistantReply)}`.trim();
}

function replyClaimsFakeBooking(reply: string): boolean {
  const lower = reply.toLowerCase();
  return (
    /scheduled the appointment|appointment is (booked|reserved|confirmed)/i.test(
      lower
    ) ||
    /reply with "yes/i.test(lower) ||
    (/to confirm/i.test(lower) && /deposit/i.test(lower) && !/https?:\/\//i.test(lower))
  );
}

function formatAlternativesReply(params: {
  slots: AvailableSlot[];
  dayHints: string[];
  timeZone: string;
  service?: string | null;
}): string {
  const intro = params.service?.trim()
    ? `We can help with ${params.service.trim()}. `
    : "";

  if (params.slots.length === 0) {
    return `${intro}We're fully booked for the next few days. I can check a later date if you'd like.`;
  }

  const daySlots = filterSlotsByDayHints(
    params.slots,
    params.dayHints,
    params.timeZone
  );

  if (params.dayHints.length > 0 && daySlots.length === 0) {
    const dayLabel = params.dayHints.includes("thu")
      ? "Thursday"
      : params.dayHints.includes("fri")
        ? "Friday"
        : params.dayHints.includes("sat")
          ? "Saturday"
          : params.dayHints.includes("sun")
            ? "Sunday"
            : params.dayHints.includes("mon")
              ? "Monday"
              : params.dayHints.includes("tue")
                ? "Tuesday"
                : params.dayHints.includes("wed")
                  ? "Wednesday"
                  : "that day";
    return `${intro}We don't have ${dayLabel} openings right now. ${formatSlotOptions(params.slots)}`;
  }

  const pool = daySlots.length > 0 ? daySlots : params.slots;
  return `${intro}${formatSlotOptions(pool)}`;
}

const BOOKING_INTENT_RE =
  /\b(book|deposit|send.*link|confirm|go ahead|please do|lock it in|reserve|agree)\b/i;

function resolveScheduleSourceMessage(
  userMessage: string,
  messages: OllamaChatMessage[]
): string | null {
  if (isFollowUpConfusion(userMessage)) {
    return getLastTimeSelectionUserMessage(messages);
  }
  if (isPureAffirmative(userMessage)) {
    return getLastTimeSelectionUserMessage(messages) ?? userMessage;
  }
  if (isTimeSelectionMessage(userMessage) && !isFollowUpConfusion(userMessage)) {
    return userMessage;
  }
  return getLastTimeSelectionUserMessage(messages);
}

function userWantsToBook(userMessage: string): boolean {
  const trimmed = userMessage.trim();
  return (
    isAffirmativeMessage(trimmed) ||
    BOOKING_INTENT_RE.test(trimmed)
  );
}

function userPickedSpecificTime(
  sourceMessage: string | null,
  fullContext: string
): boolean {
  if (!sourceMessage && !fullContext.trim()) return false;
  const text = `${sourceMessage ?? ""} ${fullContext}`.trim();
  return (
    Boolean(parseClockTime(text, text)) ||
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i.test(
      text
    )
  );
}

async function createDepositForAppointment(params: {
  orgId: string;
  leadId: string;
}): Promise<{ paymentUrl: string; confirmationMessage: string } | null> {
  try {
    const deposit = await createDepositPayment({
      orgId: params.orgId,
      leadId: params.leadId,
    });
    return {
      paymentUrl: deposit.paymentUrl,
      confirmationMessage: deposit.confirmationMessage,
    };
  } catch (err) {
    console.error("[booking-fallback] create deposit failed", err);
    return null;
  }
}
async function ensureBookingIntake(params: {
  orgId: string;
  leadId: string;
}): Promise<LeadIntakeRecord> {
  const lead = await loadLeadIntakeRecord(params);

  if (lead.first_name?.trim() && lead.last_name?.trim()) {
    return lead;
  }

  const nameParts = lead.name.trim().split(/\s+/).filter(Boolean);
  if (nameParts.length === 0) {
    return lead;
  }

  return updateLeadIntake({
    orgId: params.orgId,
    leadId: params.leadId,
    patch: {
      first_name: lead.first_name?.trim() || nameParts[0],
      last_name:
        lead.last_name?.trim() || nameParts.slice(1).join(" ") || nameParts[0],
    },
  });
}

async function loadPendingAppointment(params: {
  orgId: string;
  leadId: string;
}): Promise<Appointment | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("appointments")
    .select("*")
    .eq("org_id", params.orgId)
    .eq("lead_id", params.leadId)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Appointment | null) ?? null;
}

async function loadPendingPaymentUrl(leadId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("payments")
    .select("checkout_url")
    .eq("lead_id", leadId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.checkout_url ?? null;
}

export type AutoFinalizeBookingResult = {
  appointment?: Appointment;
  paymentUrl?: string;
  confirmationMessage?: string;
  suggestedReply?: string;
};

export async function tryAutoFinalizeBooking(params: {
  orgId: string;
  leadId: string;
  userMessage: string;
  messages: OllamaChatMessage[];
  existingPaymentUrl?: string;
  assistantReply?: string;
  servicesScope?: string;
}): Promise<AutoFinalizeBookingResult> {
  const result: AutoFinalizeBookingResult = {};

  const paidState = await loadLeadBookingPaymentState({
    orgId: params.orgId,
    leadId: params.leadId,
  });
  if (paidState.isPaid) {
    result.suggestedReply =
      paidState.paidReply ??
      "Your deposit is confirmed and your appointment is locked in.";
    result.appointment = paidState.confirmedAppointment ?? undefined;
    return result;
  }

  if (params.existingPaymentUrl) {
    result.paymentUrl = params.existingPaymentUrl;
    return result;
  }

  const existingPayment = await loadPendingPaymentUrl(params.leadId);
  if (existingPayment) {
    result.paymentUrl = existingPayment;
    return result;
  }

  if (params.servicesScope) {
    const fullContext = buildFullConversationContext(
      params.messages,
      params.userMessage,
      params.assistantReply
    );
    await syncLeadIntakeFromUserMessage({
      orgId: params.orgId,
      leadId: params.leadId,
      userMessage: fullContext,
      servicesScope: params.servicesScope,
    });
  }

  const fullContext = buildFullConversationContext(
    params.messages,
    params.userMessage,
    params.assistantReply
  );

  const scheduleSourceMessage = resolveScheduleSourceMessage(
    params.userMessage,
    params.messages
  );
  const wantsBook = userWantsToBook(params.userMessage);
  const pickedTime = userPickedSpecificTime(scheduleSourceMessage, fullContext);

  if (!wantsBook && !pickedTime) {
    return result;
  }

  const intake = await ensureBookingIntake({
    orgId: params.orgId,
    leadId: params.leadId,
  });
  const missing = getMissingBookingFields(intake);
  if (missing.length > 0) {
    result.suggestedReply = `Before I can book your appointment, I still need your ${missing.join(", ")}.`;
    return result;
  }

  const context = getSchedulingContext(params.messages, params.assistantReply);
  const matchText = [scheduleSourceMessage, fullContext, context]
    .filter(Boolean)
    .join(" ");

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", params.orgId)
    .single();

  const timeZone = org?.timezone ?? "America/New_York";
  const dayHints = collectDayHints(matchText, context);
  let appointment = await loadPendingAppointment({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const slots = await getAvailableSlots({
    orgId: params.orgId,
    daysAhead: 14,
  });

  if (!appointment) {
    try {
      const matched = findMatchingAvailableSlot({
        requestedStartsAt: undefined,
        userMessage: matchText,
        assistantContext: context,
        slots,
        timeZone,
        strict: !userPickedSpecificTime(scheduleSourceMessage, fullContext),
      });

      if (!matched) {
        result.suggestedReply = formatAlternativesReply({
          slots,
          dayHints,
          timeZone,
          service: intake.appointment_reason,
        });
        return result;
      }

      appointment = await scheduleAppointment({
        orgId: params.orgId,
        leadId: params.leadId,
        startsAt: matched.starts_at,
      });
      result.appointment = appointment;
    } catch (err) {
      console.error("[booking-fallback] auto-schedule failed", err);
      result.suggestedReply = formatAlternativesReply({
        slots,
        dayHints,
        timeZone,
        service: intake.appointment_reason,
      });
      return result;
    }
  } else {
    result.appointment = appointment;
  }

  const deposit = await createDepositForAppointment({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  if (deposit) {
    result.paymentUrl = deposit.paymentUrl;
    result.confirmationMessage = deposit.confirmationMessage;
    result.suggestedReply = deposit.confirmationMessage;
  } else if (appointment) {
    result.suggestedReply =
      "Your appointment time is reserved. We'll send your deposit payment link shortly — if you don't receive it in a few minutes, let us know.";
  }

  return result;
}

export function shouldUseSuggestedReply(params: {
  reply: string;
  suggestedReply?: string;
  paymentUrl?: string;
}): string {
  if (params.suggestedReply && params.paymentUrl) {
    return params.suggestedReply;
  }

  const trimmed = params.reply.trim();
  const isGeneric =
    !trimmed ||
    /^thanks — we'?ll be in touch shortly\.?$/i.test(trimmed) ||
    /^thanks for your message — we'?ll follow up shortly\.?$/i.test(trimmed);

  if (
    params.suggestedReply &&
    (isGeneric ||
      PAYMENT_PLACEHOLDER_RE.test(trimmed) ||
      replyClaimsFakeBooking(trimmed) ||
      /want me to book|would you like me to show|which time works best|can't schedule|cannot schedule|can't schedule/i.test(
        trimmed
      ) ||
      /scheduling conflict|isn'?t available|not available|reschedule/i.test(
        trimmed
      ))
  ) {
    return params.suggestedReply;
  }

  return params.reply;
}

const ASKS_FOR_TIMES_RE =
  /\b(what time|available|availability|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|come out|come on|slot|when can|will \d|can you come|openings?|schedule|appointment time|tiling|tile)\b/i;

const VAGUE_SCHEDULING_REPLY_RE =
  /still in progress|haven'?t finalized|would you like me to show|go over them|check if this|within our scope|update lead intake|verify_service_scope/i;

function formatSlotOptions(slots: AvailableSlot[]): string {
  const labels = slots.slice(0, 5).map((slot) => slot.label);
  if (labels.length === 0) {
    return "We're fully booked for the next few days. I can add you to our waitlist or check a later date if you'd like.";
  }
  if (labels.length === 1) {
    return `We have an opening on ${labels[0]}. Does that work for you?`;
  }
  const last = labels.pop();
  return `We have openings on ${labels.join(", ")}, and ${last}. Which time works best for you?`;
}

function replyNeedsSchedulingHelp(reply: string, userMessage: string): boolean {
  const polished = polishAssistantReply(reply);
  if (replyClaimsFakeBooking(polished)) return true;

  const schedulingIntent =
    ASKS_FOR_TIMES_RE.test(userMessage) ||
    /\b\d{1,2}\s*(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\b/i.test(userMessage);

  if (!schedulingIntent) return false;

  if (!polished.trim()) return true;
  if (looksLikeToolJson(polished)) return true;
  if (VAGUE_SCHEDULING_REPLY_RE.test(polished)) return true;

  const usesRealSlotLabels =
    /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/i.test(polished) ||
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(polished);

  const offersRangeTimes = /\d{1,2}:\d{2}\s*(AM|PM)\s*-\s*\d{1,2}:\d{2}\s*(AM|PM)/i.test(
    polished
  );

  if (offersRangeTimes && !usesRealSlotLabels) return true;

  const offersConcreteTime =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      polished
    ) && /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\b/i.test(polished);

  return !offersConcreteTime && !usesRealSlotLabels;
}

export async function trySchedulingAssistReply(params: {
  orgId: string;
  leadId: string;
  userMessage: string;
  assistantReply: string;
  hasPendingBooking?: boolean;
}): Promise<string | null> {
  if (params.hasPendingBooking) {
    return null;
  }

  if (userWantsToBook(params.userMessage)) {
    return null;
  }

  const lead = await loadLeadIntakeRecord({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  if (!isBookingReady(lead)) {
    const missing = getMissingBookingFields(lead);
    if (missing.length > 0 && ASKS_FOR_TIMES_RE.test(params.userMessage)) {
      return `I can check our calendar as soon as I have your ${missing.join(", ")}.`;
    }
    return null;
  }

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("timezone, business_name")
    .eq("id", params.orgId)
    .single();

  const timeZone = org?.timezone ?? "America/New_York";
  const slots = await getAvailableSlots({
    orgId: params.orgId,
    daysAhead: 14,
  });

  const clock = parseClockTime(params.userMessage, params.userMessage);
  const wantsSpecificTime =
    Boolean(clock) ||
    /\b(saturday|sunday|monday|tuesday|wednesday|thursday|friday)\b/i.test(
      params.userMessage
    );

  if (wantsSpecificTime && slots.length > 0) {
    const matched = findMatchingAvailableSlot({
      userMessage: params.userMessage,
      assistantContext: params.assistantReply,
      slots,
      timeZone,
    });

    if (matched) {
      return null;
    }

    if (replyNeedsSchedulingHelp(params.assistantReply, params.userMessage)) {
      const dayHints = collectDayHints(params.userMessage, params.assistantReply);
      return formatAlternativesReply({
        slots,
        dayHints,
        timeZone,
        service: lead.appointment_reason,
      });
    }
  }

  if (replyNeedsSchedulingHelp(params.assistantReply, params.userMessage)) {
    const dayHints = collectDayHints(params.userMessage, params.assistantReply);
    return formatAlternativesReply({
      slots,
      dayHints,
      timeZone,
      service: lead.appointment_reason,
    });
  }

  return null;
}
