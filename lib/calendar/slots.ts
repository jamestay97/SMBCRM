import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AppointmentStatus,
  TenantAvailability,
  TenantCalendarSettings,
} from "@/types/database";
import {
  addDaysToYmd,
  formatSlotLabel,
  getDatePartsInTimeZone,
  parseTimeToMinutes,
  zonedDateTimeToUtc,
} from "@/lib/calendar/timezone";
import {
  isSlotAtCapacity,
  slotCapacityReason,
} from "@/lib/calendar/slot-capacity";

export type AvailableSlot = {
  starts_at: string;
  ends_at: string;
  label: string;
};

type SchedulingContext = {
  orgId: string;
  timeZone: string;
  settings: TenantCalendarSettings;
  availability: TenantAvailability[];
};

type BusyAppointment = {
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
};

async function loadSchedulingContext(
  orgId: string
): Promise<SchedulingContext> {
  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .single();

  if (orgError || !org) {
    throw new Error(`Organization not found: ${orgError?.message}`);
  }

  const { data: settings, error: settingsError } = await admin
    .from("tenant_calendar_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  if (settingsError) {
    throw new Error(`Failed to load calendar settings: ${settingsError.message}`);
  }

  const { data: availability, error: availabilityError } = await admin
    .from("tenant_availability")
    .select("*")
    .eq("org_id", orgId)
    .order("day_of_week");

  if (availabilityError) {
    throw new Error(
      `Failed to load availability: ${availabilityError.message}`
    );
  }

  return {
    orgId,
    timeZone: org.timezone ?? "America/New_York",
    settings: settings ?? {
      org_id: orgId,
      slot_duration_minutes: 60,
      min_notice_hours: 2,
      booking_horizon_days: 30,
      limit_appointments_per_slot: true,
      max_appointments_per_slot: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    availability: availability ?? [],
  };
}

async function loadBusyAppointments(
  orgId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<BusyAppointment[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("appointments")
    .select("starts_at, ends_at, status")
    .eq("org_id", orgId)
    .in("status", ["pending_payment", "confirmed"])
    .lt("starts_at", rangeEnd.toISOString())
    .gt("ends_at", rangeStart.toISOString());

  if (error) {
    throw new Error(`Failed to load appointments: ${error.message}`);
  }

  return data ?? [];
}

export async function getAvailableSlots(params: {
  orgId: string;
  daysAhead?: number;
}): Promise<AvailableSlot[]> {
  const ctx = await loadSchedulingContext(params.orgId);
  const daysAhead = params.daysAhead ?? 7;
  const now = new Date();
  const minStart = new Date(
    now.getTime() + ctx.settings.min_notice_hours * 60 * 60 * 1000
  );
  const horizonEnd = new Date(
    now.getTime() + ctx.settings.booking_horizon_days * 24 * 60 * 60 * 1000
  );

  const busy = await loadBusyAppointments(params.orgId, now, horizonEnd);
  const slots: AvailableSlot[] = [];
  const todayParts = getDatePartsInTimeZone(now, ctx.timeZone);

  for (let dayOffset = 0; dayOffset < daysAhead; dayOffset++) {
    const ymd = addDaysToYmd(
      todayParts.year,
      todayParts.month,
      todayParts.day,
      dayOffset
    );
    const dayStartUtc = zonedDateTimeToUtc(
      ymd.year,
      ymd.month,
      ymd.day,
      12,
      0,
      ctx.timeZone
    );
    const dayParts = getDatePartsInTimeZone(dayStartUtc, ctx.timeZone);
    const window = ctx.availability.find(
      (row) => row.day_of_week === dayParts.dayOfWeek && row.is_enabled
    );

    if (!window) continue;

    const startMinutes = parseTimeToMinutes(window.start_time);
    const endMinutes = parseTimeToMinutes(window.end_time);
    const slotDuration = ctx.settings.slot_duration_minutes;

    for (
      let minute = startMinutes;
      minute + slotDuration <= endMinutes;
      minute += slotDuration
    ) {
      const hour = Math.floor(minute / 60);
      const min = minute % 60;
      const slotStart = zonedDateTimeToUtc(
        ymd.year,
        ymd.month,
        ymd.day,
        hour,
        min,
        ctx.timeZone
      );
      const slotEnd = new Date(
        slotStart.getTime() + slotDuration * 60 * 1000
      );

      if (slotStart < minStart || slotStart > horizonEnd) continue;
      if (isSlotAtCapacity(slotStart, slotEnd, busy, ctx.settings)) continue;

      slots.push({
        starts_at: slotStart.toISOString(),
        ends_at: slotEnd.toISOString(),
        label: formatSlotLabel(slotStart, ctx.timeZone),
      });
    }
  }

  return slots;
}

export async function validateSlotAvailability(params: {
  orgId: string;
  startsAt: Date;
  endsAt: Date;
  excludeAppointmentId?: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ctx = await loadSchedulingContext(params.orgId);
  const now = new Date();
  const minStart = new Date(
    now.getTime() + ctx.settings.min_notice_hours * 60 * 60 * 1000
  );
  const horizonEnd = new Date(
    now.getTime() + ctx.settings.booking_horizon_days * 24 * 60 * 60 * 1000
  );

  if (params.startsAt < minStart) {
    return {
      ok: false,
      reason: "This time is too soon. Choose a later slot.",
    };
  }

  if (params.startsAt > horizonEnd) {
    return {
      ok: false,
      reason: "This time is outside the booking window.",
    };
  }

  const durationMinutes =
    (params.endsAt.getTime() - params.startsAt.getTime()) / (60 * 1000);
  if (durationMinutes !== ctx.settings.slot_duration_minutes) {
    return {
      ok: false,
      reason: `Appointments must be ${ctx.settings.slot_duration_minutes} minutes.`,
    };
  }

  const parts = getDatePartsInTimeZone(params.startsAt, ctx.timeZone);
  const window = ctx.availability.find(
    (row) => row.day_of_week === parts.dayOfWeek && row.is_enabled
  );

  if (!window) {
    return { ok: false, reason: "This day is not available for booking." };
  }

  const slotStartMinutes = parts.hour * 60 + parts.minute;
  const slotEndMinutes = slotStartMinutes + durationMinutes;
  const windowStart = parseTimeToMinutes(window.start_time);
  const windowEnd = parseTimeToMinutes(window.end_time);

  if (slotStartMinutes < windowStart || slotEndMinutes > windowEnd) {
    return {
      ok: false,
      reason: "This time is outside your available hours.",
    };
  }

  const busy = await loadBusyAppointments(
    params.orgId,
    params.startsAt,
    params.endsAt
  );

  const admin = createAdminClient();
  let filteredBusy = busy;

  if (params.excludeAppointmentId) {
    const { data: current } = await admin
      .from("appointments")
      .select("starts_at, ends_at, status")
      .eq("id", params.excludeAppointmentId)
      .maybeSingle();

    filteredBusy = busy.filter(
      (appointment) =>
        appointment.starts_at !== current?.starts_at ||
        appointment.ends_at !== current?.ends_at
    );
  }

  if (isSlotAtCapacity(params.startsAt, params.endsAt, filteredBusy, ctx.settings)) {
    return { ok: false, reason: slotCapacityReason(ctx.settings) };
  }

  return { ok: true };
}
