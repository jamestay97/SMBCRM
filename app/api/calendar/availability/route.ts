import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  calendarSetupErrorResponse,
  ensureTenantCalendar,
} from "@/lib/calendar/ensure-tenant-calendar";
import { mergeAvailabilityRows, normalizeTimeInput } from "@/lib/calendar/defaults";
import {
  getAuthorizedTenantContext,
  getTenantAdminClient,
} from "@/lib/calendar/tenant-calendar-api";
import { unauthorized } from "@/lib/auth/tenant-api";

const availabilityRowSchema = z.object({
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: z.string().min(4),
  end_time: z.string().min(4),
  is_enabled: z.coerce.boolean(),
});

const updateAvailabilitySchema = z.object({
  availability: z.array(availabilityRowSchema).min(1).max(7),
});

export async function GET() {
  const ctx = await getAuthorizedTenantContext();
  if (!ctx) return unauthorized();

  try {
    await ensureTenantCalendar(ctx.orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const admin = getTenantAdminClient();
  const { data, error } = await admin
    .from("tenant_availability")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("day_of_week");

  if (error) {
    return NextResponse.json(
      { error: calendarSetupErrorResponse(error.message) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    availability:
      data && data.length > 0 ? data : mergeAvailabilityRows([]),
  });
}

export async function PUT(request: NextRequest) {
  const ctx = await getAuthorizedTenantContext();
  if (!ctx) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateAvailabilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  const merged = mergeAvailabilityRows(parsed.data.availability);

  for (const row of merged) {
    if (!row.is_enabled) continue;

    const startMinutes = parseTime(row.start_time);
    const endMinutes = parseTime(row.end_time);
    if (endMinutes <= startMinutes) {
      return NextResponse.json(
        {
          error: `End time must be after start time for ${dayLabel(row.day_of_week)}`,
        },
        { status: 400 }
      );
    }
  }

  try {
    await ensureTenantCalendar(ctx.orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const rows = merged.map((row) => ({
    org_id: ctx.orgId,
    day_of_week: row.day_of_week,
    start_time: normalizeTimeInput(row.start_time),
    end_time: normalizeTimeInput(row.end_time),
    is_enabled: row.is_enabled,
  }));

  const admin = getTenantAdminClient();
  const { data, error } = await admin
    .from("tenant_availability")
    .upsert(rows, { onConflict: "org_id,day_of_week" })
    .select("*")
    .order("day_of_week");

  if (error) {
    return NextResponse.json(
      { error: calendarSetupErrorResponse(error.message) },
      { status: 500 }
    );
  }

  return NextResponse.json({ availability: data });
}

function parseTime(value: string): number {
  const normalized = normalizeTimeInput(value);
  const [hour, minute] = normalized.split(":");
  return parseInt(hour, 10) * 60 + parseInt(minute, 10);
}

function dayLabel(dayOfWeek: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    dayOfWeek
  ];
}
