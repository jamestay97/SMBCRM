import {
  DEPOSIT_TOOL_DEFINITION,
  DEPOSIT_TOOL_NAME,
  type OllamaChatMessage,
} from "@/lib/ollama/client";
import { llmChat } from "@/lib/llm/chat";
import type { LlmProvider } from "@/types/database";
import {
  SCHEDULE_TOOL_DEFINITION,
  SCHEDULE_TOOL_NAME,
  SLOTS_TOOL_DEFINITION,
  SLOTS_TOOL_NAME,
  parseScheduleToolArguments,
  parseSlotsToolArguments,
} from "@/lib/ollama/calendar-tools";
import {
  ASSISTANT_SALES_WORKFLOW,
  UPDATE_INTAKE_TOOL_DEFINITION,
  UPDATE_INTAKE_TOOL_NAME,
  VERIFY_SCOPE_TOOL_DEFINITION,
  VERIFY_SCOPE_TOOL_NAME,
  parseUpdateIntakeArguments,
  parseVerifyScopeArguments,
} from "@/lib/ollama/intake-tools";
import {
  appendTranscript,
  getTranscript,
} from "@/lib/ollama/conversations";
import {
  applyPaymentUrlToReply,
  getSchedulingContext,
  polishAssistantReply,
} from "@/lib/ollama/booking-fallback";
import { resolveBookingTurn } from "@/lib/ollama/booking-orchestrator";
import { getAvailableSlots } from "@/lib/calendar/slots";
import { isBookingReady } from "@/lib/leads/intake";
import {
  extractToolCallsFromAssistantMessage,
} from "@/lib/ollama/tool-calls";
import { syncLeadIntakeFromUserMessage } from "@/lib/ollama/intake-sync";
import { appendPipelineStep, isPlausibleInferredName } from "@/lib/leads/infer-contact";
import {
  buildAppointmentConfirmationMessage,
  formatDepositAmount,
} from "@/lib/calendar/format-appointment";
import {
  listAvailableSlotsForAssistant,
  scheduleAppointment,
} from "@/lib/calendar/schedule";
import {
  findMatchingAvailableSlot,
  formatSlotsForToolError,
} from "@/lib/calendar/match-slot";
import {
  loadLeadIntakeRecord,
  runServiceScopeVerification,
  updateLeadIntake,
} from "@/lib/leads/intake-actions";
import { formatIntakeStatus } from "@/lib/leads/intake";
import {
  buildScopeHintForMessage,
  formatServicesScopeForPrompt,
} from "@/lib/leads/services-scope-tags";
import {
  buildOutOfScopeGuidanceReply,
  buildServicesOfferMessage,
  matchServiceScope,
} from "@/lib/leads/verify-scope";
import { isServicesCatalogQuestion } from "@/lib/leads/infer-contact";
import { createDepositPayment } from "@/lib/stripe/create-deposit-payment";
import { loadLeadBookingPaymentState } from "@/lib/stripe/payment-status";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TranscriptEntry } from "@/types/database";

const MAX_TOOL_ROUNDS = 10;

const ASSISTANT_TOOLS = [
  UPDATE_INTAKE_TOOL_DEFINITION,
  VERIFY_SCOPE_TOOL_DEFINITION,
  SLOTS_TOOL_DEFINITION,
  SCHEDULE_TOOL_DEFINITION,
  DEPOSIT_TOOL_DEFINITION,
];

type RunAssistantParams = {
  conversationId: string;
  orgId: string;
  leadId: string;
  systemPrompt: string;
  userMessage: string;
  channel?: TranscriptEntry["channel"];
  model?: string;
  baseUrl?: string;
  provider?: LlmProvider;
  apiKey?: string | null;
};

type RunAssistantResult = {
  reply: string;
  paymentUrl?: string;
};

type ScopeToolState = {
  in_scope: boolean;
  customer_message: string;
  verified_reason: string;
};

function parseScopeFromToolContent(content: string): ScopeToolState | null {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    if (
      typeof data.in_scope === "boolean" &&
      typeof data.customer_message === "string"
    ) {
      return {
        in_scope: data.in_scope,
        customer_message: data.customer_message,
        verified_reason: String(data.verified_reason ?? ""),
      };
    }

    const scope = data.scope as Record<string, unknown> | undefined;
    if (scope && typeof scope.in_scope === "boolean") {
      return {
        in_scope: Boolean(scope.in_scope),
        customer_message: String(scope.customer_message ?? ""),
        verified_reason: String(scope.verified_reason ?? ""),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function getLastScopeState(messages: OllamaChatMessage[]): ScopeToolState | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;
    const parsed = parseScopeFromToolContent(msg.content);
    if (parsed) return parsed;
  }
  return null;
}

function replyContradictsInScope(reply: string): boolean {
  const lower = reply.toLowerCase();
  return (
    /don'?t (actually )?offer/.test(lower) ||
    /don'?t handle/.test(lower) ||
    /not something we/.test(lower) ||
    /outside (of )?what we/.test(lower) ||
    /cannot help/.test(lower) ||
    /can'?t help/.test(lower) ||
    /we don'?t (do|offer|provide|handle)/.test(lower)
  );
}

function buildScopeFollowUpInstruction(state: ScopeToolState): string {
  if (state.in_scope) {
    return (
      `Scope verification result: IN SCOPE for "${state.verified_reason}". ` +
      `You MUST confirm we offer this service. Use this message: ${state.customer_message}. ` +
      "Never tell the customer we do not offer this service."
    );
  }

  return (
    `Scope verification result: OUT OF SCOPE for "${state.verified_reason}". ` +
    `Use this message: ${state.customer_message}. Do not offer appointment times.`
  );
}

function formatScopeToolPayload(
  result: Awaited<ReturnType<typeof runServiceScopeVerification>>
) {
  return {
    in_scope: result.in_scope,
    scope_confirmed: result.scope_confirmed,
    verified_reason: result.verified_reason,
    summary: result.summary,
    customer_message: result.customer_message,
    reply_instruction: result.in_scope
      ? `Confirm we can help with "${result.verified_reason}" and continue intake or offer appointment times.`
      : `Politely decline "${result.verified_reason}" using customer_message. Do not offer times.`,
    intake_status: formatIntakeStatus(result.lead),
  };
}

function fallbackReplyForUserMessage(
  userMessage: string,
  servicesScope: string
): string | null {
  if (isServicesCatalogQuestion(userMessage)) {
    return buildServicesOfferMessage(servicesScope);
  }

  const match = matchServiceScope(userMessage, servicesScope);

  if (match.match === "in") {
    const serviceLabel = match.matchedTerms[0] ?? "that";
    return `Yes, we can help with ${serviceLabel}. Could I get your name and contact details to get started?`;
  }

  if (match.match === "out") {
    return buildOutOfScopeGuidanceReply({
      servicesScope,
      appointmentReason: userMessage.trim(),
    });
  }

  return null;
}

async function buildSystemPrompt(
  systemPrompt: string,
  orgId: string,
  leadId: string,
  userMessage: string
): Promise<{ prompt: string; servicesScope: string }> {
  const admin = createAdminClient();
  const lead = await loadLeadIntakeRecord({ orgId, leadId });

  const { data: org } = await admin
    .from("organizations")
    .select("services_scope, business_name, deposit_amount_cents")
    .eq("id", orgId)
    .single();

  const servicesScope =
    org?.services_scope?.trim() ||
    "Configure services scope in dashboard settings.";

  const depositLine = org?.deposit_amount_cents
    ? `Deposit to secure an appointment: ${formatDepositAmount(org.deposit_amount_cents)}.`
    : "";

  let prompt = `${systemPrompt}

Business: ${org?.business_name ?? "our company"}
Services we support (only offer these — if a service is listed here, we DO handle it):
${formatServicesScopeForPrompt(servicesScope)}
${depositLine ? `\n${depositLine}` : ""}

${ASSISTANT_SALES_WORKFLOW}

Conversation style:
- Answer the customer's questions directly (scope, process, timeline, pricing). Be helpful and conversational.
- For pricing: give a reasonable ballpark when you can; if exact pricing depends on the job, say so clearly and explain we assess on-site. Always tie back to booking.
- Never invent a customer's name from greeting words or question text — only use names they clearly give you.
- After answering, always guide toward the next booking step.

Current customer intake status:
${formatIntakeStatus(lead)}`;

  const scopeHint = buildScopeHintForMessage(userMessage, servicesScope);
  if (scopeHint) {
    prompt += `\n\n${scopeHint}`;
  }

  if (isBookingReady(lead) && lead.contact_confirmed) {
    try {
      const slots = await getAvailableSlots({ orgId, daysAhead: 14 });
      if (slots.length > 0) {
        prompt += `\n\nOpen appointment slots (ONLY offer these exact times — never invent ranges):
${formatSlotsForToolError(slots)}`;
      } else {
        prompt += `\n\nNo appointment slots are currently available in the calendar. Do not offer times until slots exist.`;
      }
    } catch {
      // Calendar not configured yet.
    }
  }

  const paymentState = await loadLeadBookingPaymentState({ orgId, leadId });
  if (paymentState.isPaid) {
    prompt +=
      "\n\nPayment status: DEPOSIT PAID — appointment is confirmed. Do NOT send another payment link. Thank the customer and confirm their appointment details.";
    if (paymentState.paidReply) {
      prompt += `\nConfirmed booking: ${paymentState.paidReply}`;
    }
  } else if (paymentState.appointmentStatus === "pending_payment") {
    prompt +=
      "\n\nPayment status: appointment booked, deposit still pending — include the payment link if the customer asks.";
  }

  return { prompt, servicesScope };
}

function transcriptToOllamaMessages(
  transcript: TranscriptEntry[],
  systemPrompt: string
): OllamaChatMessage[] {
  const messages: OllamaChatMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const entry of transcript) {
    if (entry.role === "system") continue;
    if (entry.role === "user" || entry.role === "assistant") {
      messages.push({ role: entry.role, content: entry.content });
    }
  }

  return messages;
}

type DepositToolState = {
  payment_url: string;
  appointment_summary: string;
  confirmation_message: string;
  amount_cents: number;
};

function parseDepositFromToolContent(content: string): DepositToolState | null {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    if (typeof data.payment_url !== "string") return null;
    return {
      payment_url: data.payment_url,
      appointment_summary: String(data.appointment_summary ?? ""),
      confirmation_message: String(data.confirmation_message ?? ""),
      amount_cents: Number(data.amount_cents ?? 0),
    };
  } catch {
    return null;
  }
}

function getLastDepositState(
  messages: OllamaChatMessage[]
): DepositToolState | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;
    const parsed = parseDepositFromToolContent(msg.content);
    if (parsed) return parsed;
  }
  return null;
}

function buildDepositFollowUpInstruction(state: DepositToolState): string {
  return (
    `Deposit link created for the confirmed appointment. ` +
    `Recap: ${state.appointment_summary}. ` +
    `You MUST include this payment link in your reply: ${state.payment_url}`
  );
}

function ensurePaymentLinkInReply(reply: string, paymentUrl: string): string {
  return applyPaymentUrlToReply(reply, paymentUrl);
}

async function getOrgBookingContext(orgId: string) {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("business_name, deposit_amount_cents, timezone")
    .eq("id", orgId)
    .single();

  return {
    businessName: org?.business_name ?? "our company",
    depositCents: org?.deposit_amount_cents ?? 0,
    timeZone: org?.timezone ?? "America/New_York",
  };
}

async function executeDepositTool(params: {
  orgId: string;
  leadId: string;
}): Promise<{ paymentUrl?: string; toolContent: string }> {
  const paidState = await loadLeadBookingPaymentState({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  if (paidState.isPaid) {
    return {
      toolContent: JSON.stringify({
        payment_status: "succeeded",
        already_paid: true,
        appointment_status: paidState.appointmentStatus ?? "confirmed",
        confirmation_message:
          paidState.paidReply ??
          "Deposit already received — appointment is confirmed.",
        reply_instruction:
          "Tell the customer their deposit was received and their appointment is locked in. Do not send another payment link.",
      }),
    };
  }

  const result = await createDepositPayment({
    orgId: params.orgId,
    leadId: params.leadId,
  });

  return {
    paymentUrl: result.paymentUrl,
    toolContent: JSON.stringify({
      payment_url: result.paymentUrl,
      payment_status: "pending",
      amount_cents: result.amountCents,
      appointment_id: result.appointmentId,
      appointment_summary: result.appointmentSummary,
      confirmation_message: result.confirmationMessage,
      reply_instruction:
        "Recap the confirmed appointment details and include payment_url in your reply.",
    }),
  };
}

async function executeToolCall(params: {
  toolName: string;
  orgId: string;
  leadId: string;
  rawArguments: Record<string, unknown> | string;
  userMessage?: string;
  schedulingContext?: string;
}): Promise<{ paymentUrl?: string; toolContent: string }> {
  if (params.toolName === UPDATE_INTAKE_TOOL_NAME) {
    try {
      const args = parseUpdateIntakeArguments(params.rawArguments);
      const patch = {
        first_name: args.first_name,
        last_name: args.last_name,
        phone: args.phone,
        email: args.email,
        service_address: args.service_address,
        appointment_reason: args.appointment_reason,
      };

      if (
        patch.first_name &&
        patch.last_name &&
        !isPlausibleInferredName(patch.first_name, patch.last_name)
      ) {
        delete patch.first_name;
        delete patch.last_name;
      }

      if (Object.values(patch).every((value) => value === undefined)) {
        return {
          toolContent: JSON.stringify({
            saved: false,
            error:
              "No valid fields to save. Only pass details the customer actually provided.",
          }),
        };
      }

      const lead = await updateLeadIntake({
        orgId: params.orgId,
        leadId: params.leadId,
        patch,
      });

      const payload: Record<string, unknown> = {
        saved: true,
        intake_status: formatIntakeStatus(lead),
      };

      if (args.appointment_reason) {
        const scope = await runServiceScopeVerification({
          orgId: params.orgId,
          leadId: params.leadId,
          appointmentReason: args.appointment_reason,
        });
        Object.assign(payload, formatScopeToolPayload(scope));
      }

      return {
        toolContent: JSON.stringify(payload),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update intake";
      return { toolContent: JSON.stringify({ error: message }) };
    }
  }

  if (params.toolName === VERIFY_SCOPE_TOOL_NAME) {
    try {
      const args = parseVerifyScopeArguments(params.rawArguments);
      const result = await runServiceScopeVerification({
        orgId: params.orgId,
        leadId: params.leadId,
        appointmentReason: args.appointment_reason,
      });

      return {
        toolContent: JSON.stringify(formatScopeToolPayload(result)),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Scope verification failed";
      return { toolContent: JSON.stringify({ error: message }) };
    }
  }

  if (params.toolName === SLOTS_TOOL_NAME) {
    const args = parseSlotsToolArguments(params.rawArguments);
    try {
      const result = await listAvailableSlotsForAssistant({
        orgId: params.orgId,
        leadId: params.leadId,
        daysAhead: args.days_ahead,
      });
      return { toolContent: JSON.stringify(result) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to list slots";
      return { toolContent: JSON.stringify({ error: message }) };
    }
  }

  if (params.toolName === SCHEDULE_TOOL_NAME) {
    const args = parseScheduleToolArguments(params.rawArguments);
    const orgContext = await getOrgBookingContext(params.orgId);

    try {
      const { slots } = await listAvailableSlotsForAssistant({
        orgId: params.orgId,
        leadId: params.leadId,
      });

      const matched = findMatchingAvailableSlot({
        requestedStartsAt: args.starts_at,
        userMessage: params.userMessage ?? "",
        assistantContext: params.schedulingContext ?? "",
        slots,
        timeZone: orgContext.timeZone,
        strict: true,
      });

      if (!matched) {
        return {
          toolContent: JSON.stringify({
            error:
              "Could not match that time to an open slot. Only offer times from get_available_appointment_slots.",
            available_slots: slots.slice(0, 8),
            slots_formatted: formatSlotsForToolError(slots),
            reply_instruction:
              "Apologize briefly and offer times from available_slots only. Use the exact starts_at when scheduling.",
          }),
        };
      }

      const appointment = await scheduleAppointment({
        orgId: params.orgId,
        leadId: params.leadId,
        startsAt: matched.starts_at,
      });

      const intake = await loadLeadIntakeRecord({
        orgId: params.orgId,
        leadId: params.leadId,
      });
      const confirmationSummary = buildAppointmentConfirmationMessage({
        businessName: orgContext.businessName,
        serviceReason: intake.appointment_reason,
        startsAt: appointment.starts_at,
        endsAt: appointment.ends_at,
        timeZone: orgContext.timeZone,
        depositCents: orgContext.depositCents,
      });

      return {
        toolContent: JSON.stringify({
          appointment_id: appointment.id,
          starts_at: appointment.starts_at,
          ends_at: appointment.ends_at,
          status: appointment.status,
          booked_slot_label: matched.label,
          confirmation_summary: confirmationSummary,
          reply_instruction:
            "Confirm the booked_slot_label with the customer and ask them to confirm before creating the deposit link.",
        }),
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to schedule appointment";

      let slotsFormatted = "";
      try {
        const { slots } = await listAvailableSlotsForAssistant({
          orgId: params.orgId,
          leadId: params.leadId,
        });
        slotsFormatted = formatSlotsForToolError(slots);
      } catch {
        slotsFormatted = "";
      }

      return {
        toolContent: JSON.stringify({
          error: message,
          slots_formatted: slotsFormatted,
          reply_instruction:
            "Do not claim the customer's chosen time is unavailable if it appears in slots_formatted. Pick the matching starts_at and call schedule_appointment again.",
        }),
      };
    }
  }

  if (params.toolName === DEPOSIT_TOOL_NAME) {
    try {
      return await executeDepositTool({
        orgId: params.orgId,
        leadId: params.leadId,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to create deposit link";
      return { toolContent: JSON.stringify({ error: message }) };
    }
  }

  return { toolContent: JSON.stringify({ error: "Unknown tool" }) };
}

function stripUserEcho(reply: string, userMessage: string): string {
  let result = reply.trim();
  const user = userMessage.trim();
  if (user.length > 16) {
    while (result.includes(user)) {
      result = result.replace(user, "").trim();
    }
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

export async function runAssistant(
  params: RunAssistantParams
): Promise<RunAssistantResult> {
  const admin = createAdminClient();

  await appendTranscript(params.conversationId, {
    role: "user",
    content: params.userMessage,
    channel: params.channel,
  });

  await admin
    .from("leads")
    .update({ status: "engaged" })
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .in("status", ["new", "engaged"]);

  const transcript = await getTranscript(params.conversationId);

  const { data: orgScope } = await createAdminClient()
    .from("organizations")
    .select("services_scope")
    .eq("id", params.orgId)
    .single();

  const servicesScopeForSync =
    orgScope?.services_scope?.trim() ||
    "Configure services scope in dashboard settings.";

  await syncLeadIntakeFromUserMessage({
    orgId: params.orgId,
    leadId: params.leadId,
    userMessage: params.userMessage,
    servicesScope: servicesScopeForSync,
  });

  const { prompt: systemPrompt, servicesScope } = await buildSystemPrompt(
    params.systemPrompt,
    params.orgId,
    params.leadId,
    params.userMessage
  );

  const messages = transcriptToOllamaMessages(transcript, systemPrompt);

  let paymentUrl: string | undefined;
  let reply = "Thanks — we'll be in touch shortly.";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await llmChat({
      messages,
      tools: ASSISTANT_TOOLS,
      model: params.model,
      baseUrl: params.baseUrl,
      provider: params.provider,
      apiKey: params.apiKey,
    });

    const assistantMessage = response.message;
    const toolCalls = extractToolCallsFromAssistantMessage(assistantMessage);

    if (toolCalls.length === 0) {
      reply =
        polishAssistantReply(assistantMessage.content) ||
        fallbackReplyForUserMessage(params.userMessage, servicesScope) ||
        "Thanks — we'll be in touch shortly.";
      break;
    }

    messages.push({
      role: "assistant",
      content: polishAssistantReply(assistantMessage.content),
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const toolResult = await executeToolCall({
        toolName: toolCall.function.name,
        orgId: params.orgId,
        leadId: params.leadId,
        rawArguments: toolCall.function.arguments,
        userMessage: params.userMessage,
        schedulingContext: getSchedulingContext(messages),
      });

      if (toolResult.paymentUrl) {
        paymentUrl = toolResult.paymentUrl;
      }

      messages.push({
        role: "tool",
        content: toolResult.toolContent,
        tool_call_id: toolCall.id,
      });
    }

    if (round === MAX_TOOL_ROUNDS - 1) {
      throw new Error("LLM exceeded maximum tool call rounds");
    }
  }

  if (messages[messages.length - 1]?.role === "tool") {
    const scopeState = getLastScopeState(messages);
    const depositState = getLastDepositState(messages);
    const followUpMessages = [...messages];

    if (scopeState) {
      followUpMessages.push({
        role: "system",
        content: buildScopeFollowUpInstruction(scopeState),
      });
    }

    if (depositState) {
      followUpMessages.push({
        role: "system",
        content: buildDepositFollowUpInstruction(depositState),
      });
    }

    const followUp = await llmChat({
      messages: followUpMessages,
      model: params.model,
      baseUrl: params.baseUrl,
      provider: params.provider,
      apiKey: params.apiKey,
    });
    reply =
      polishAssistantReply(followUp.message.content) ||
      depositState?.confirmation_message ||
      (paymentUrl
        ? `Your appointment is booked. Pay your deposit here: ${paymentUrl}`
        : "Thanks — we'll be in touch shortly.");

    if (
      scopeState?.in_scope &&
      reply &&
      replyContradictsInScope(reply)
    ) {
      reply = scopeState.customer_message;
    } else if (
      !reply &&
      scopeState
    ) {
      reply = scopeState.customer_message;
    }
  }

  const bookingTurn = await resolveBookingTurn({
    orgId: params.orgId,
    leadId: params.leadId,
    userMessage: params.userMessage,
    messages,
    assistantReply: reply,
    servicesScope,
    existingPaymentUrl: paymentUrl,
  });

  if (bookingTurn.paymentUrl) {
    paymentUrl = bookingTurn.paymentUrl;
  }

  if (bookingTurn.mergeWithAssistant && bookingTurn.pipelineAppend) {
    reply = appendPipelineStep(reply, bookingTurn.pipelineAppend);
  } else if (bookingTurn.reply) {
    reply = bookingTurn.reply;
  }

  if (bookingTurn.appointment) {
    reply = bookingTurn.reply ?? reply;
  }

  reply = stripUserEcho(reply, params.userMessage);

  if (paymentUrl) {
    reply = applyPaymentUrlToReply(reply, paymentUrl);
  }

  if (!reply.trim()) {
    reply = "Thanks for your message — we'll follow up shortly.";
  }

  await appendTranscript(params.conversationId, {
    role: "assistant",
    content: reply,
    channel: params.channel,
  });

  return { reply, paymentUrl };
}
