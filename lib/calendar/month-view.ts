import { zonedDateTimeToUtc } from "@/lib/calendar/timezone";

export function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const days: Date[] = [];

  for (let index = 0; index < 42; index++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    days.push(day);
  }

  return days;
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month, 1));
}

export function formatTimeInTimeZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function getMonthRange(
  year: number,
  month: number,
  timeZone = "America/New_York"
): { from: string; to: string } {
  const from = zonedDateTimeToUtc(year, month + 1, 1, 0, 0, timeZone);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const endOfMonth = zonedDateTimeToUtc(
    year,
    month + 1,
    lastDay,
    23,
    59,
    timeZone
  );
  return {
    from: from.toISOString(),
    to: new Date(endOfMonth.getTime() + 59_999).toISOString(),
  };
}
