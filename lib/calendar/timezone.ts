const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
};

export function getDatePartsInTimeZone(
  date: Date,
  timeZone: string
): ZonedDateParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const hourRaw = parseInt(get("hour"), 10);
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    hour: hourRaw === 24 ? 0 : hourRaw,
    minute: parseInt(get("minute"), 10),
    dayOfWeek: WEEKDAY_TO_INDEX[get("weekday")] ?? 0,
  };
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  for (let attempt = 0; attempt < 6; attempt++) {
    const parts = getDatePartsInTimeZone(new Date(utcMs), timeZone);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      return new Date(utcMs);
    }

    const desiredMinutes =
      Date.UTC(year, month - 1, day, hour, minute, 0) / 60_000;
    const actualMinutes =
      Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        0
      ) / 60_000;
    utcMs += (desiredMinutes - actualMinutes) * 60_000;
  }

  return new Date(utcMs);
}

export function parseTimeToMinutes(time: string): number {
  const [hourPart, minutePart] = time.split(":");
  return parseInt(hourPart, 10) * 60 + parseInt(minutePart, 10);
}

export function formatSlotLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function addDaysToYmd(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}
