import type { AvailableSlot } from "@/lib/calendar/slots";
import { getAvailableSlots } from "@/lib/calendar/slots";
import {
  collectDayHints,
  filterSlotsByDayHints,
  findMatchingAvailableSlot,
  parseClockTime,
  slotsMentionedInContext,
} from "@/lib/calendar/match-slot";
import {
  buildAppointmentConfirmationMessage,
  formatAppointmentWindow,
  formatDepositAmount,
} from "@/lib/calendar/format-appointment";
import { scheduleAppointment } from "@/lib/calendar/schedule";
import type { OllamaChatMessage } from "@/lib/ollama/client";
import { isCustomerQuestion, isServicesCatalogQuestion } from "@/lib/leads/infer-contact";
import {
  inferAppointmentReasonFromMessage,
  syncLeadIntakeFromUserMessage,
} from "@/lib/ollama/intake-sync";
import {
  isPlausibleAppointmentReason,
  normalizeAppointmentReason,
} from "@/lib/leads/appointment-reason";
import {
  buildOutOfScopeGuidanceReply,
  buildServicesOfferMessage,
  matchServiceScope,
} from "@/lib/leads/verify-scope";
import {
  buildContactConfirmationPrompt,
  buildNextIntakeQuestion,
  composeSalesReply,
  buildIntakeCaptureReply,
  getMissingBookingFields,
  isBookingReady,
  type LeadIntakeRecord,
} from "@/lib/leads/intake";
import {
  acknowledgeServiceScope,
  confirmLeadContact,
  loadLeadIntakeRecord,
  runServiceScopeVerification,
} from "@/lib/leads/intake-actions";
import { createDepositPayment } from "@/lib/stripe/create-deposit-payment";
import { loadLeadBookingPaymentState } from "@/lib/stripe/payment-status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Appointment } from "@/types/database";

export type BookingTurnResult = {
  reply?: string;
  /** Keep the LLM reply and append the pipeline step (for Q&A turns). */
  mergeWithAssistant?: boolean;
  pipelineAppend?: string;
  paymentUrl?: string;
  appointment?: Appointment;
};

function shouldMergeWithAssistant(params: {
  userMessage: string;
  assistantReply: string;
}): boolean {
  return (
    isCustomerQuestion(params.userMessage) &&
    params.assistantReply.trim().length >= 40
  );
}

function bookingReply(params: {
  userMessage: string;
  assistantReply: string;
  reply?: string;
  pipelineAppend?: string;
  forceReplace?: boolean;
}): BookingTurnResult {
  if (params.forceReplace) {
    return { reply: params.reply ?? params.pipelineAppend };
  }

  const assistant = params.assistantReply.trim();
  const isQuestion = isCustomerQuestion(params.userMessage);

  // Customer asked something — keep the LLM answer and append the next pipeline step.
  if (params.pipelineAppend && assistant && isQuestion) {
    return {
      mergeWithAssistant: true,
      pipelineAppend: params.pipelineAppend,
    };
  }

  if (params.pipelineAppend && !params.reply) {
    return { reply: params.pipelineAppend };
  }

  if (
    params.pipelineAppend &&
    assistant &&
    shouldMergeWithAssistant(params)
  ) {
    return {
      mergeWithAssistant: true,
      pipelineAppend: params.pipelineAppend,
    };
  }

  return { reply: params.reply ?? params.pipelineAppend };
}

function buildServicesCatalogTurn(params: {
  userMessage: string;
  assistantReply: string;
  servicesScope: string;
}): BookingTurnResult {
  const catalogReply = buildServicesOfferMessage(params.servicesScope);
  const assistant = params.assistantReply.trim();

  if (assistant.length >= 40 && isCustomerQuestion(params.userMessage)) {
    const invite =
      "Which of those would you like help with? I can confirm we handle it and get you scheduled.";
    if (
      assistant.toLowerCase().includes("specialize") ||
      assistant.toLowerCase().includes("we handle") ||
      assistant.toLowerCase().includes("we offer")
    ) {
      return { mergeWithAssistant: true, pipelineAppend: invite };
    }
  }

  return bookingReply({
    userMessage: params.userMessage,
    assistantReply: params.assistantReply,
    reply: catalogReply,
  });
}

const CONFIRM_RE =
  /^(yes|yeah|yep|sure|ok|okay|confirm|confirmed|sounds good|that works|book it|perfect|go ahead|i agree|let'?s do it)\.?!?$/i;

const NEW_SERVICE_REQUEST_RE =
  /\b(can i have|could i get|can you help|need someone|come out|fix my|repair my|install|help with|looking for|looking to|i am looking|i'm looking|someone to|have someone)\b/i;

const TIME_ONLY_RE =
  /^\s*\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)\.?\s*$/i;

function buildUserContext(
  messages: OllamaChatMessage[],
  userMessage: string
): string {
  const lines = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content.trim())
    .filter(Boolean);
  if (userMessage.trim()) lines.push(userMessage.trim());
  return lines.join(" ");
}

function buildAssistantContext(
  messages: OllamaChatMessage[],
  assistantReply?: string
): string {
  const lines: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.content.trim()) {
      lines.unshift(m.content.trim());
      if (lines.length >= 3) break;
    }
  }
  if (assistantReply?.trim()) lines.push(assistantReply.trim());
  return lines.join(" ");
}

function isNewServiceRequest(message: string): boolean {
  return NEW_SERVICE_REQUEST_RE.test(message.trim());
}

function isExplicitConfirmation(message: string): boolean {
  const trimmed = message.trim();
  if (isNewServiceRequest(trimmed)) return false;
  if (TIME_ONLY_RE.test(trimmed)) return false;
  if (CONFIRM_RE.test(trimmed)) return true;
  if (trimmed.length <= 24 && /\b(yes|yeah|yep|sure|ok|okay|confirm|book it)\b/i.test(trimmed)) {
    return !isNewServiceRequest(trimmed);
  }
  return false;
}

function userMessageHasExplicitTime(message: string): boolean {
  const trimmed = message.trim();
  if (TIME_ONLY_RE.test(trimmed)) return true;
  if (parseClockTime(trimmed, trimmed) && trimmed.length <= 48) return true;
  if (
    parseClockTime(trimmed, trimmed) &&
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/i.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

function assistantOfferedSlots(context: string): boolean {
  return (
    /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/i.test(context) ||
    /which time works best|we have openings on|we have an opening on/i.test(
      context
    )
  );
}

function messageMatchesSlotLabel(
  message: string,
  slots: AvailableSlot[]
): AvailableSlot | null {
  const lower = message.trim().toLowerCase();
  if (!lower) return null;
  return (
    slots.find((slot) => lower.includes(slot.label.toLowerCase())) ?? null
  );
}

async function reloadLead(params: {
  orgId: string;
  leadId: string;
}): Promise<LeadIntakeRecord> {
  return loadLeadIntakeRecord(params);
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

async function cancelPendingAppointments(params: {
  orgId: string;
  leadId: string;
}): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("org_id", params.orgId)
    .eq("lead_id", params.leadId)
    .eq("status", "pending_payment");
}

function formatSlotOffer(params: {
  slots: AvailableSlot[];
  service?: string | null;
  dayHints?: string[];
  timeZone: string;
}): string {
  const intro = params.service?.trim()
    ? `We can help with ${params.service.trim()}. `
    : "";

  if (params.slots.length === 0) {
    return `${intro}We're fully booked for the next two weeks. Want me to check later dates?`;
  }

  const dayHints = params.dayHints ?? [];
  const daySlots =
    dayHints.length > 0
      ? filterSlotsByDayHints(params.slots, dayHints, params.timeZone)
      : params.slots;

  if (dayHints.length > 0 && daySlots.length === 0) {
    const labels = params.slots.slice(0, 5).map((s) => s.label);
    const last = labels.pop();
    const list =
      labels.length > 0 ? `${labels.join(", ")}, and ${last}` : last;
    return `${intro}We don't have that day open. Our next openings are ${list}. Which works for you?`;
  }

  const pool = (daySlots.length > 0 ? daySlots : params.slots).slice(0, 5);
  const labels = pool.map((s) => s.label);
  const last = labels.pop();
  const list = labels.length > 0 ? `${labels.join(", ")}, and ${last}` : last;
  return `${intro}Here are our next openings: ${list}. Which time works best for you?`;
}

async function advancePipelineReply(params: {
  orgId: string;
  lead: LeadIntakeRecord;
  message?: string;
}): Promise<BookingTurnResult | null> {
  let lead = params.lead;

  if (!lead.scope_acknowledged && lead.appointment_reason?.trim()) {
    return null;
  }

  if (!lead.scope_confirmed) {
    return null;
  }

  const nextIntake = buildNextIntakeQuestion(lead);
  if (nextIntake) {
    return {
      reply: params.message ? composeSalesReply(lead, params.message) : nextIntake,
    };
  }

  if (isBookingReady(lead) && !lead.contact_confirmed) {
    return { reply: buildContactConfirmationPrompt(lead) };
  }

  if (lead.contact_confirmed) {
    const pending = await loadPendingAppointment({
      orgId: params.orgId,
      leadId: lead.id,
    });
    if (pending) {
      const payment = await loadPendingPaymentUrl(lead.id);
      if (payment) {
        return { reply: `Pay your deposit here to confirm your spot: ${payment}`, paymentUrl: payment, appointment: pending };
      }
    }

    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("business_name, timezone")
      .eq("id", params.orgId)
      .single();
    const slots = await getAvailableSlots({ orgId: params.orgId, daysAhead: 14 });
    return {
      reply: formatSlotOffer({
        slots,
        service: lead.appointment_reason,
        timeZone: org?.timezone ?? "America/New_York",
      }),
    };
  }

  return null;
}

async function bookSlotAndCollectDeposit(params: {
  orgId: string;
  leadId: string;
  slot: AvailableSlot;
  intake: LeadIntakeRecord;
  timeZone: string;
  businessName: string;
  depositCents: number;
}): Promise<BookingTurnResult> {
  await cancelPendingAppointments({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const appointment = await scheduleAppointment({
    orgId: params.orgId,
    leadId: params.leadId,
    startsAt: params.slot.starts_at,
  });

  try {
    const deposit = await createDepositPayment({
      orgId: params.orgId,
      leadId: params.leadId,
    });
    return {
      appointment,
      paymentUrl: deposit.paymentUrl,
      reply: deposit.confirmationMessage,
    };
  } catch (err) {
    console.error("[booking-orchestrator] deposit failed", err);
    const summary = buildAppointmentConfirmationMessage({
      businessName: params.businessName,
      serviceReason: params.intake.appointment_reason,
      startsAt: appointment.starts_at,
      endsAt: appointment.ends_at,
      timeZone: params.timeZone,
      depositCents: params.depositCents,
    });
    return {
      appointment,
      reply:
        `${summary} ` +
        `You're booked on ${params.slot.label}. ` +
        `We couldn't generate the deposit link automatically — our team will send payment details shortly.`,
    };
  }
}

/**
 * Deterministic booking pipeline (server-enforced order):
 * 1. Capture appointment reason
 * 2. Verify request is in services scope
 * 3. Collect name, phone, email, service address
 * 4. Customer confirms contact details
 * 5. Offer calendar slots → book appointment → send deposit link
 */
export async function resolveBookingTurn(params: {
  orgId: string;
  leadId: string;
  userMessage: string;
  messages: OllamaChatMessage[];
  assistantReply: string;
  servicesScope: string;
  existingPaymentUrl?: string;
}): Promise<BookingTurnResult> {
  const userMessage = params.userMessage.trim();
  const userContext = buildUserContext(params.messages, userMessage);
  const assistantContext = buildAssistantContext(
    params.messages,
    params.assistantReply
  );

  const paidState = await loadLeadBookingPaymentState({
    orgId: params.orgId,
    leadId: params.leadId,
  });
  if (paidState.isPaid) {
    return {
      reply:
        paidState.paidReply ??
        "Your deposit is confirmed and your appointment is locked in. We'll see you then!",
      appointment: paidState.confirmedAppointment ?? undefined,
    };
  }

  const leadBefore = await reloadLead({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  await syncLeadIntakeFromUserMessage({
    orgId: params.orgId,
    leadId: params.leadId,
    userMessage,
    servicesScope: params.servicesScope,
  });

  let lead = await reloadLead({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const intakeAck = buildIntakeCaptureReply(leadBefore, lead);
  if (intakeAck && lead.scope_confirmed) {
    return { reply: intakeAck };
  }

  const existingPayment =
    params.existingPaymentUrl ??
    (await loadPendingPaymentUrl(params.leadId)) ??
    undefined;

  if (existingPayment) {
    const pending = await loadPendingAppointment({
      orgId: params.orgId,
      leadId: params.leadId,
    });
    if (pending) {
      const admin = createAdminClient();
      const { data: org } = await admin
        .from("organizations")
        .select("business_name, timezone, deposit_amount_cents")
        .eq("id", params.orgId)
        .single();
      const summary = buildAppointmentConfirmationMessage({
        businessName: org?.business_name ?? "Our team",
        serviceReason: lead.appointment_reason,
        startsAt: pending.starts_at,
        endsAt: pending.ends_at,
        timeZone: org?.timezone ?? "America/New_York",
        depositCents: org?.deposit_amount_cents,
      });
      return {
        paymentUrl: existingPayment,
        appointment: pending,
        reply:
          `${summary} ` +
          `Pay ${formatDepositAmount(org?.deposit_amount_cents ?? 0)} here: ${existingPayment}`,
      };
    }
  }

  // Step 1 — need a reason for the visit
  if (!lead.appointment_reason?.trim()) {
    if (isServicesCatalogQuestion(userMessage)) {
      return buildServicesCatalogTurn({
        userMessage,
        assistantReply: params.assistantReply,
        servicesScope: params.servicesScope,
      });
    }
    if (isNewServiceRequest(userMessage)) {
      return {
        reply:
          "I can help with that. Could you describe what's going on so I can confirm it's something we handle?",
      };
    }
    return {};
  }

  // Step 2 — tell the customer whether we handle their request (never skip this)
  if (!lead.scope_acknowledged) {
    try {
      const scope = await acknowledgeServiceScope({
        orgId: params.orgId,
        leadId: params.leadId,
        appointmentReason: lead.appointment_reason,
      });
      lead = scope.lead;

      if (!scope.in_scope) {
        return bookingReply({
          userMessage,
          assistantReply: params.assistantReply,
          reply: buildOutOfScopeGuidanceReply({
            servicesScope: params.servicesScope,
            appointmentReason: lead.appointment_reason,
          }),
        });
      }

      const nextStep = buildNextIntakeQuestion(scope.lead);
      return bookingReply({
        userMessage,
        assistantReply: params.assistantReply,
        reply: composeSalesReply(scope.lead, scope.customer_message),
        pipelineAppend: nextStep ?? undefined,
      });
    } catch (err) {
      console.error("[booking-orchestrator] scope verification failed", err);
      return {
        reply:
          "Let me check on that for you. Could you describe what you need help with?",
      };
    }
  }

  if (!lead.scope_confirmed) {
    if (isServicesCatalogQuestion(userMessage)) {
      return buildServicesCatalogTurn({
        userMessage,
        assistantReply: params.assistantReply,
        servicesScope: params.servicesScope,
      });
    }

    const messageScope = matchServiceScope(userMessage, params.servicesScope);
    const inferredReason = inferAppointmentReasonFromMessage(
      userMessage,
      params.servicesScope
    );
    const canReverify =
      messageScope.match === "in" ||
      (inferredReason &&
        matchServiceScope(inferredReason, params.servicesScope).match === "in");

    if (canReverify) {
      try {
        const reasonToVerify =
          normalizeAppointmentReason({
            candidate:
              inferredReason ??
              messageScope.matchedTerms.join(", ") ??
              userMessage.trim(),
            servicesScope: params.servicesScope,
            fallback: lead.appointment_reason,
          }) ?? lead.appointment_reason?.trim();
        if (!reasonToVerify || !isPlausibleAppointmentReason(reasonToVerify)) {
          throw new Error("Could not determine service for scope verification");
        }
        const scope = await runServiceScopeVerification({
          orgId: params.orgId,
          leadId: params.leadId,
          appointmentReason: reasonToVerify,
        });
        lead = scope.lead;

        if (scope.in_scope) {
          const nextStep = buildNextIntakeQuestion(scope.lead);
          return bookingReply({
            userMessage,
            assistantReply: params.assistantReply,
            reply: composeSalesReply(scope.lead, scope.customer_message),
            pipelineAppend: nextStep ?? undefined,
          });
        }
      } catch (err) {
        console.error("[booking-orchestrator] scope re-verification failed", err);
      }
    }

    return bookingReply({
      userMessage,
      assistantReply: params.assistantReply,
      reply: buildOutOfScopeGuidanceReply({
        servicesScope: params.servicesScope,
        appointmentReason: lead.appointment_reason,
      }),
    });
  }

  // Step 3 — collect contact fields in chat (name → phone → email → address)
  const intakePrompt = buildNextIntakeQuestion(lead);
  if (intakePrompt && !userMessageHasExplicitTime(userMessage)) {
    return bookingReply({
      userMessage,
      assistantReply: params.assistantReply,
      pipelineAppend: intakePrompt,
    });
  }

  if (!isBookingReady(lead)) {
    const missing = getMissingBookingFields(lead);
    if (missing.length > 0) {
      const next = buildNextIntakeQuestion(lead);
      if (next) {
        return bookingReply({
          userMessage,
          assistantReply: params.assistantReply,
          pipelineAppend: next,
        });
      }
      return {
        reply: `To schedule your ${lead.appointment_reason!.trim()} visit, I still need your ${missing.join(", ")}.`,
      };
    }
    const fallback = await advancePipelineReply({
      orgId: params.orgId,
      lead,
    });
    if (fallback) return fallback;
    return {};
  }

  // Step 4 — read back and confirm contact details
  if (!lead.contact_confirmed) {
    if (isExplicitConfirmation(userMessage)) {
      lead = await confirmLeadContact({
        orgId: params.orgId,
        leadId: params.leadId,
      });
    } else {
      return { reply: buildContactConfirmationPrompt(lead) };
    }
  }

  // Step 5 — offer slots, book on calendar, send deposit link
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("business_name, timezone, deposit_amount_cents")
    .eq("id", params.orgId)
    .single();

  const timeZone = org?.timezone ?? "America/New_York";
  const slots = await getAvailableSlots({ orgId: params.orgId, daysAhead: 14 });
  const dayHints = collectDayHints(userMessage, userContext, assistantContext);

  const existingPending = await loadPendingAppointment({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  const labelMatch = messageMatchesSlotLabel(userMessage, slots);
  const explicitTime = userMessageHasExplicitTime(userMessage);
  const confirming = isExplicitConfirmation(userMessage);
  const offeredSlots = assistantOfferedSlots(assistantContext);
  const wantsReschedule =
    Boolean(labelMatch) ||
    explicitTime ||
    isNewServiceRequest(userMessage) ||
    /\b(reschedule|different time|another time|change the time)\b/i.test(
      userMessage
    );

  if (existingPending && !wantsReschedule) {
    const payment = await loadPendingPaymentUrl(params.leadId);
    const label =
      slots.find((s) => s.starts_at === existingPending.starts_at)?.label ??
      formatAppointmentWindow(
        existingPending.starts_at,
        existingPending.ends_at,
        timeZone
      );
    if (payment) {
      return {
        reply: `You're scheduled for ${label}. Pay your deposit here: ${payment}`,
        paymentUrl: payment,
        appointment: existingPending,
      };
    }
    return {
      reply: `You're scheduled for ${label}. I'll send your deposit link now.`,
      appointment: existingPending,
    };
  }

  let matchedSlot: AvailableSlot | null = labelMatch;

  if (!matchedSlot && explicitTime) {
    matchedSlot = findMatchingAvailableSlot({
      userMessage,
      assistantContext,
      slots,
      timeZone,
    });
  } else if (!matchedSlot && confirming && offeredSlots) {
    const mentioned = slotsMentionedInContext(assistantContext, slots);
    if (mentioned.length === 1) {
      matchedSlot = mentioned[0];
    }
  }

  const shouldBook =
    lead.contact_confirmed &&
    matchedSlot &&
    (explicitTime || Boolean(labelMatch) || (confirming && matchedSlot)) &&
    !isNewServiceRequest(userMessage);

  if (shouldBook && matchedSlot) {
    return bookSlotAndCollectDeposit({
      orgId: params.orgId,
      leadId: params.leadId,
      slot: matchedSlot,
      intake: lead,
      timeZone,
      businessName: org?.business_name ?? "Our team",
      depositCents: org?.deposit_amount_cents ?? 0,
    });
  }

  if (
    isExplicitConfirmation(userMessage) &&
    lead.contact_confirmed &&
    !explicitTime &&
    !labelMatch
  ) {
    return {
      reply: formatSlotOffer({
        slots,
        service: lead.appointment_reason,
        dayHints,
        timeZone,
      }),
    };
  }

  if (/\b(what time|when is it|what'?s the time)\b/i.test(userMessage)) {
    const pending = await loadPendingAppointment({
      orgId: params.orgId,
      leadId: params.leadId,
    });
    if (pending) {
      const label =
        slots.find((s) => s.starts_at === pending.starts_at)?.label ??
        buildAppointmentConfirmationMessage({
          businessName: org?.business_name ?? "Our team",
          serviceReason: lead.appointment_reason,
          startsAt: pending.starts_at,
          endsAt: pending.ends_at,
          timeZone,
        });
      const payment = await loadPendingPaymentUrl(params.leadId);
      if (payment) {
        return {
          reply: `You're scheduled for ${label}. Pay your deposit here: ${payment}`,
          paymentUrl: payment,
          appointment: pending,
        };
      }
      return {
        reply: `You're scheduled for ${label}. I'll send your deposit link now.`,
        appointment: pending,
      };
    }
    return {
      reply: formatSlotOffer({
        slots,
        service: lead.appointment_reason,
        dayHints,
        timeZone,
      }),
    };
  }

  const wantsScheduling =
    lead.contact_confirmed &&
    (isNewServiceRequest(userMessage) ||
      explicitTime ||
      /\b(thursday|friday|saturday|sunday|monday|tuesday|wednesday|tomorrow|today|available|schedule|appointment|come out)\b/i.test(
        userMessage
      ));

  if (wantsScheduling && !confirming && lead.appointment_reason?.trim()) {
    return {
      reply: formatSlotOffer({
        slots,
        service: lead.appointment_reason,
        dayHints,
        timeZone,
      }),
    };
  }

  if (confirming && offeredSlots && !matchedSlot && lead.contact_confirmed) {
    return {
      reply: formatSlotOffer({
        slots,
        service: lead.appointment_reason,
        dayHints,
        timeZone,
      }),
    };
  }

  const pipeline = await advancePipelineReply({
    orgId: params.orgId,
    lead,
  });
  if (pipeline) return pipeline;

  return {};
}

