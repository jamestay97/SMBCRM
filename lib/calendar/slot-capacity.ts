import type { TenantCalendarSettings } from "@/types/database";

type TimedBooking = {
  starts_at: string;
  ends_at: string;
};

export function countOverlappingBookings(
  slotStart: Date,
  slotEnd: Date,
  bookings: TimedBooking[]
): number {
  const slotStartMs = slotStart.getTime();
  const slotEndMs = slotEnd.getTime();

  return bookings.filter((booking) => {
    const busyStart = new Date(booking.starts_at).getTime();
    const busyEnd = new Date(booking.ends_at).getTime();
    return slotStartMs < busyEnd && slotEndMs > busyStart;
  }).length;
}

export function getSlotCapacityLimit(
  settings: Pick<
    TenantCalendarSettings,
    "limit_appointments_per_slot" | "max_appointments_per_slot"
  >
): number | null {
  if (!settings.limit_appointments_per_slot) {
    return null;
  }

  return Math.max(1, settings.max_appointments_per_slot ?? 1);
}

export function isSlotAtCapacity(
  slotStart: Date,
  slotEnd: Date,
  bookings: TimedBooking[],
  settings: Pick<
    TenantCalendarSettings,
    "limit_appointments_per_slot" | "max_appointments_per_slot"
  >
): boolean {
  const limit = getSlotCapacityLimit(settings);
  if (limit === null) {
    return false;
  }

  return countOverlappingBookings(slotStart, slotEnd, bookings) >= limit;
}

export function slotCapacityReason(
  settings: Pick<
    TenantCalendarSettings,
    "limit_appointments_per_slot" | "max_appointments_per_slot"
  >
): string {
  const limit = getSlotCapacityLimit(settings);
  if (limit === 1) {
    return "This time slot is already booked.";
  }
  return `This time slot is full (maximum ${limit} appointments).`;
}
