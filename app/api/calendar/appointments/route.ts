import { NextRequest, NextResponse } from "next/server";
import {
  calendarSetupErrorResponse,
  ensureTenantCalendar,
  isMissingCalendarTableError,
} from "@/lib/calendar/ensure-tenant-calendar";
import {
  getAuthorizedTenantContext,
  getTenantAdminClient,
} from "@/lib/calendar/tenant-calendar-api";
import { unauthorized } from "@/lib/auth/tenant-api";

export async function GET(request: NextRequest) {
  const ctx = await getAuthorizedTenantContext();
  if (!ctx) return unauthorized();

  try {
    await ensureTenantCalendar(ctx.orgId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Calendar setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const rangeStart = from ? new Date(from) : new Date();
  const rangeEnd = to
    ? new Date(to)
    : new Date(rangeStart.getTime() + 42 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    return NextResponse.json({ error: "Invalid from/to dates" }, { status: 400 });
  }

  const admin = getTenantAdminClient();
  const { data: appointments, error } = await admin
    .from("appointments")
    .select(
      "id, org_id, lead_id, payment_id, starts_at, ends_at, status, title, created_at"
    )
    .eq("org_id", ctx.orgId)
    .gte("starts_at", rangeStart.toISOString())
    .lte("starts_at", rangeEnd.toISOString())
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true });

  if (error) {
    if (isMissingCalendarTableError(error.message)) {
      return NextResponse.json({ appointments: [] });
    }
    return NextResponse.json(
      { error: calendarSetupErrorResponse(error.message) },
      { status: 500 }
    );
  }

  const leadIds = Array.from(
    new Set((appointments ?? []).map((appointment) => appointment.lead_id))
  );

  let leadsById: Record<
    string,
    { name: string; phone: string | null; email: string | null; status: string }
  > = {};

  if (leadIds.length > 0) {
    const { data: leads, error: leadsError } = await admin
      .from("leads")
      .select("id, name, phone, email, status")
      .in("id", leadIds);

    if (leadsError) {
      return NextResponse.json({ error: leadsError.message }, { status: 500 });
    }

    leadsById = Object.fromEntries(
      (leads ?? []).map((lead) => [lead.id, lead])
    );
  }

  const enriched = (appointments ?? []).map((appointment) => ({
    ...appointment,
    leads: leadsById[appointment.lead_id] ?? null,
  }));

  return NextResponse.json({ appointments: enriched });
}
