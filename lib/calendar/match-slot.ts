import type { AvailableSlot } from "@/lib/calendar/slots";
import { addDaysToYmd, getDatePartsInTimeZone } from "@/lib/calendar/timezone";

const WEEKDAY_HINTS: Record<string, string> = {
  monday: "mon",
  tuesday: "tue",
  wednesday: "wed",
  thursday: "thu",
  friday: "fri",
  saturday: "sat",
  sunday: "sun",
};

const SPOKEN_HOUR_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/** Convert voice phrases like "nine AM" / "at nine" into "9 AM" for slot matching. */
export function normalizeSpokenClockText(text: string): string {
  let result = text;
  for (const [word, hour] of Object.entries(SPOKEN_HOUR_WORDS)) {
    result = result.replace(
      new RegExp(`\\b${word}\\s+(a\\.?m\\.?|p\\.?m\\.?)\\b`, "gi"),
      `${hour} $1`
    );
    result = result.replace(
      new RegExp(`\\bat\\s+${word}\\b`, "gi"),
      `at ${hour}`
    );
  }
  return result;
}

export function parseClockTime(
  text: string,
  context: string
): { hour24: number; minute: number } | null {
  const normalizedText = normalizeSpokenClockText(text);
  const normalizedContext = normalizeSpokenClockText(context);
  const combined = `${normalizedText} ${normalizedContext}`;

  const explicit = combined.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i
  );
  if (explicit) {
    let hour = parseInt(explicit[1], 10);
    const minute = explicit[2] ? parseInt(explicit[2], 10) : 0;
    const ampm = explicit[3]?.toLowerCase().replace(/\./g, "");
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return { hour24: hour, minute };
  }

  const loose = normalizedText.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
  if (!loose) return null;

  let hour = parseInt(loose[1], 10);
  const minute = loose[2] ? parseInt(loose[2], 10) : 0;
  const lower = combined.toLowerCase();
  if (/\b\d{1,2}(:\d{2})?\s*p\.?m\.?\b/.test(lower) || /\bpm\b/.test(lower)) {
    if (hour < 12) hour += 12;
  } else if (
    /\b\d{1,2}(:\d{2})?\s*a\.?m\.?\b/.test(lower) ||
    (/\bam\b/.test(lower) && hour <= 12)
  ) {
    if (hour === 12) hour = 0;
  } else if (hour >= 1 && hour <= 7) {
    hour += 12;
  }

  return { hour24: hour, minute };
}

export function filterSlotsByDayHints(
  slots: AvailableSlot[],
  hints: string[],
  timeZone: string
): AvailableSlot[] {
  if (hints.length === 0) return slots;
  return slots.filter((slot) => slotMatchesDayHint(slot, hints, timeZone));
}

export function collectDayHints(...texts: string[]): string[] {
  const hints: string[] = [];
  const combined = texts.join(" ").toLowerCase();

  if (combined.includes("tomorrow")) hints.push("tomorrow");
  if (combined.includes("today")) hints.push("today");

  for (const [day, hint] of Object.entries(WEEKDAY_HINTS)) {
    if (combined.includes(day)) hints.push(hint);
  }

  return hints;
}

function slotMatchesDayHint(
  slot: AvailableSlot,
  hints: string[],
  timeZone: string
): boolean {
  if (hints.length === 0) return true;

  const parts = getDatePartsInTimeZone(new Date(slot.starts_at), timeZone);
  const label = slot.label.toLowerCase();
  const now = getDatePartsInTimeZone(new Date(), timeZone);

  for (const hint of hints) {
    if (hint === "tomorrow") {
      const tomorrow = addDaysToYmd(now.year, now.month, now.day, 1);
      if (
        parts.year === tomorrow.year &&
        parts.month === tomorrow.month &&
        parts.day === tomorrow.day
      ) {
        return true;
      }
    }

    if (label.includes(hint)) {
      return true;
    }
  }

  return false;
}

function minutesFromParts(hour: number, minute: number): number {
  return hour * 60 + minute;
}

function findClosestSlot(params: {
  slots: AvailableSlot[];
  dayHints: string[];
  hour24: number;
  minute: number;
  timeZone: string;
  maxDiffMinutes?: number;
}): AvailableSlot | null {
  const maxDiff = params.maxDiffMinutes ?? 120;
  let best: AvailableSlot | null = null;
  let bestDiff = Infinity;
  const target = minutesFromParts(params.hour24, params.minute);

  for (const slot of params.slots) {
    if (!slotMatchesDayHint(slot, params.dayHints, params.timeZone)) {
      continue;
    }

    const parts = getDatePartsInTimeZone(new Date(slot.starts_at), params.timeZone);
    const diff = Math.abs(minutesFromParts(parts.hour, parts.minute) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = slot;
    }
  }

  return bestDiff <= maxDiff ? best : null;
}

export function findMatchingAvailableSlot(params: {
  requestedStartsAt?: string;
  userMessage: string;
  assistantContext: string;
  slots: AvailableSlot[];
  timeZone: string;
  /** When true, only exact label / starts_at matches — no fuzzy clock guessing. */
  strict?: boolean;
}): AvailableSlot | null {
  if (params.slots.length === 0) return null;

  const context = normalizeSpokenClockText(
    `${params.userMessage} ${params.assistantContext}`.trim()
  );
  const scheduleText =
    normalizeSpokenClockText(
      params.userMessage.trim() || params.assistantContext.trim() || context
    );

  if (params.requestedStartsAt) {
    const exact = params.slots.find(
      (slot) => slot.starts_at === params.requestedStartsAt
    );
    if (exact) return exact;

    const requested = new Date(params.requestedStartsAt);
    if (!Number.isNaN(requested.getTime())) {
      const near = params.slots.find((slot) => {
        const diff = Math.abs(
          new Date(slot.starts_at).getTime() - requested.getTime()
        );
        return diff < 60 * 1000;
      });
      if (near) return near;
    }
  }

  const contextLower = context.toLowerCase();
  for (const slot of params.slots) {
    if (contextLower.includes(slot.label.toLowerCase())) {
      return slot;
    }
  }

  if (params.strict) {
    return null;
  }

  const clock = parseClockTime(scheduleText, context);
  if (!clock) return null;

  const dayHints = collectDayHints(scheduleText, context);
  if (dayHints.length === 0) {
    return null;
  }

  const dayFiltered = filterSlotsByDayHints(
    params.slots,
    dayHints,
    params.timeZone
  );
  const pool = dayFiltered.length > 0 ? dayFiltered : params.slots;

  const exactMatches = pool.filter((slot) => {
    const parts = getDatePartsInTimeZone(new Date(slot.starts_at), params.timeZone);
    if (parts.hour !== clock.hour24 || parts.minute !== clock.minute) {
      return false;
    }
    return slotMatchesDayHint(slot, dayHints, params.timeZone);
  });

  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return exactMatches[0];

  return findClosestSlot({
    slots: pool,
    dayHints,
    hour24: clock.hour24,
    minute: clock.minute,
    timeZone: params.timeZone,
    maxDiffMinutes: 60,
  });
}

export function slotsMentionedInContext(
  context: string,
  slots: AvailableSlot[]
): AvailableSlot[] {
  const lower = context.toLowerCase();
  return slots.filter((slot) => lower.includes(slot.label.toLowerCase()));
}

export function formatSlotsForToolError(slots: AvailableSlot[]): string {
  return slots
    .slice(0, 8)
    .map((slot) => `${slot.label} → starts_at: ${slot.starts_at}`)
    .join("\n");
}
