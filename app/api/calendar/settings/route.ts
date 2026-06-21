import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_CALENDAR_SETTINGS } from "@/lib/calendar/defaults";
import {
  calendarSetupErrorResponse,
  ensureTenantCalendar,
} from "@/lib/calendar/ensure-tenant-calendar";
import {
  getAuthorizedTenantContext,
  getTenantAdminClient,
} from "@/lib/calendar/tenant-calendar-api";
import { unauthorized } from "@/lib/auth/tenant-api";

const updateSettingsSchema = z.object({
  slot_duration_minutes: z.coerce.number().int().min(15).max(480).optional(),
  min_notice_hours: z.coerce.number().int().min(0).max(168).optional(),
  booking_horizon_days: z.coerce.number().int().min(1).max(90).optional(),
  limit_appointments_per_slot: z.boolean().optional(),
  max_appointments_per_slot: z.coerce.number().int().min(1).max(50).optional(),
  timezone: z.string().min(3).max(64).optional(),
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
  const { data: settings, error: settingsError } = await admin
    .from("tenant_calendar_settings")
    .select("*")
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (settingsError) {
    return NextResponse.json(
      { error: calendarSetupErrorResponse(settingsError.message) },
      { status: 500 }
    );
  }

  const { data: org } = await admin
    .from("organizations")
    .select("timezone")
    .eq("id", ctx.orgId)
    .single();

  return NextResponse.json({
    settings: settings ?? {
      org_id: ctx.orgId,
      ...DEFAULT_CALENDAR_SETTINGS,
    },
    timezone: org?.timezone ?? "America/New_York",
  });
}

export async function PATCH(request: NextRequest) {
  const ctx = await getAuthorizedTenantContext();
  if (!ctx) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  try {
    await ensureTenantCalendar(ctx.orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const admin = getTenantAdminClient();
  const { timezone, ...settingsPatch } = parsed.data;

  if (timezone) {
    const { error: tzError } = await admin
      .from("organizations")
      .update({ timezone })
      .eq("id", ctx.orgId);

    if (tzError) {
      return NextResponse.json(
        { error: calendarSetupErrorResponse(tzError.message) },
        { status: 500 }
      );
    }
  }

  const { data, error } = await admin
    .from("tenant_calendar_settings")
    .upsert({ org_id: ctx.orgId, ...settingsPatch })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: calendarSetupErrorResponse(error.message) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    settings: data,
    timezone: timezone ?? undefined,
  });
}
