import { getAvailableSlots, validateSlotAvailability } from "@/lib/calendar/slots";
import { assertLeadReadyForBooking } from "@/lib/leads/intake";
import { loadLeadIntakeRecord } from "@/lib/leads/intake-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Appointment } from "@/types/database";

export async function scheduleAppointment(params: {
  orgId: string;
  leadId: string;
  startsAt: string;
}): Promise<Appointment> {
  const admin = createAdminClient();
  const intake = await loadLeadIntakeRecord({
    orgId: params.orgId,
    leadId: params.leadId,
  });
  assertLeadReadyForBooking(intake);

  const startsAt = new Date(params.startsAt);

  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Invalid starts_at datetime");
  }

  const { data: settings } = await admin
    .from("tenant_calendar_settings")
    .select("slot_duration_minutes")
    .eq("org_id", params.orgId)
    .maybeSingle();

  const durationMinutes = settings?.slot_duration_minutes ?? 60;
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);

  const validation = await validateSlotAvailability({
    orgId: params.orgId,
    startsAt,
    endsAt,
  });

  if (!validation.ok) {
    throw new Error(validation.reason);
  }

  const availableSlots = await getAvailableSlots({
    orgId: params.orgId,
    daysAhead: 14,
  });
  const exactSlot = availableSlots.find(
    (slot) => slot.starts_at === startsAt.toISOString()
  );
  if (!exactSlot) {
    throw new Error(
      "Selected time is not an available slot. Choose one of the offered appointment times."
    );
  }

  const { data: lead, error: leadError } = await admin
    .from("leads")
    .select("name, intent, appointment_reason, first_name, last_name")
    .eq("id", params.leadId)
    .eq("org_id", params.orgId)
    .single();

  if (leadError || !lead) {
    throw new Error(`Lead not found: ${leadError?.message}`);
  }

  await admin
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("org_id", params.orgId)
    .eq("lead_id", params.leadId)
    .eq("status", "pending_payment");

  const reason = lead.appointment_reason ?? lead.intent;
  const title = reason
    ? `${lead.name} — ${reason}`
    : `${lead.name} — Appointment`;

  const { data: appointment, error } = await admin
    .from("appointments")
    .insert({
      org_id: params.orgId,
      lead_id: params.leadId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "pending_payment",
      title,
    })
    .select("*")
    .single();

  if (error || !appointment) {
    throw new Error(`Failed to schedule appointment: ${error?.message}`);
  }

  return appointment;
}

export async function listAvailableSlotsForAssistant(params: {
  orgId: string;
  leadId: string;
  daysAhead?: number;
}): Promise<{ slots: Awaited<ReturnType<typeof getAvailableSlots>> }> {
  const intake = await loadLeadIntakeRecord({
    orgId: params.orgId,
    leadId: params.leadId,
  });
  assertLeadReadyForBooking(intake);

  const slots = await getAvailableSlots({
    orgId: params.orgId,
    daysAhead: params.daysAhead ?? 7,
  });

  return { slots: slots.slice(0, 12) };
}
