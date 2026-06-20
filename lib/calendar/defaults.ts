export type AvailabilityDraft = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_enabled: boolean;
};

export const DEFAULT_AVAILABILITY: AvailabilityDraft[] = [
  { day_of_week: 0, start_time: "09:00:00", end_time: "17:00:00", is_enabled: false },
  { day_of_week: 1, start_time: "09:00:00", end_time: "17:00:00", is_enabled: true },
  { day_of_week: 2, start_time: "09:00:00", end_time: "17:00:00", is_enabled: true },
  { day_of_week: 3, start_time: "09:00:00", end_time: "17:00:00", is_enabled: true },
  { day_of_week: 4, start_time: "09:00:00", end_time: "17:00:00", is_enabled: true },
  { day_of_week: 5, start_time: "09:00:00", end_time: "17:00:00", is_enabled: true },
  { day_of_week: 6, start_time: "09:00:00", end_time: "17:00:00", is_enabled: false },
];

export const DEFAULT_CALENDAR_SETTINGS = {
  slot_duration_minutes: 60,
  min_notice_hours: 2,
  booking_horizon_days: 30,
  limit_appointments_per_slot: true,
  max_appointments_per_slot: 1,
};

export function normalizeTimeInput(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "09:00:00";
  return `${match[1].padStart(2, "0")}:${match[2]}:00`;
}

export function mergeAvailabilityRows(
  rows: AvailabilityDraft[]
): AvailabilityDraft[] {
  return DEFAULT_AVAILABILITY.map((defaultRow) => {
    const match = rows.find((row) => row.day_of_week === defaultRow.day_of_week);
    if (!match) return defaultRow;

    return {
      day_of_week: defaultRow.day_of_week,
      start_time: normalizeTimeInput(match.start_time),
      end_time: normalizeTimeInput(match.end_time),
      is_enabled: Boolean(match.is_enabled),
    };
  });
}
