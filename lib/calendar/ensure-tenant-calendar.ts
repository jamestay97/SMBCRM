import { createAdminClient } from "@/lib/supabase/admin";
import { seedDefaultCalendar } from "@/lib/calendar/seed-defaults";

const MISSING_TABLE_HINT =
  "Calendar tables are missing. Run supabase/migrations/003_tenant_calendar.sql in the Supabase SQL Editor.";

export function isMissingCalendarTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("could not find the table") ||
    lower.includes("schema cache")
  );
}

export function calendarSetupErrorResponse(message: string) {
  if (isMissingCalendarTableError(message)) {
    return MISSING_TABLE_HINT;
  }
  return message;
}

export async function ensureTenantCalendar(orgId: string): Promise<void> {
  const admin = createAdminClient();

  const { count: settingsCount, error: settingsCountError } = await admin
    .from("tenant_calendar_settings")
    .select("org_id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (settingsCountError) {
    throw new Error(calendarSetupErrorResponse(settingsCountError.message));
  }

  const { count: availabilityCount, error: availabilityCountError } = await admin
    .from("tenant_availability")
    .select("org_id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if (availabilityCountError) {
    throw new Error(calendarSetupErrorResponse(availabilityCountError.message));
  }

  if ((settingsCount ?? 0) === 0 || (availabilityCount ?? 0) < 7) {
    await seedDefaultCalendar(orgId);
  }
}
