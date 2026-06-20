import { DEFAULT_AVAILABILITY } from "@/lib/calendar/defaults";
import { createAdminClient } from "@/lib/supabase/admin";

export async function seedDefaultCalendar(orgId: string): Promise<void> {
  const admin = createAdminClient();

  const { error: settingsError } = await admin
    .from("tenant_calendar_settings")
    .upsert({ org_id: orgId }, { onConflict: "org_id" });

  if (settingsError) {
    throw new Error(settingsError.message);
  }

  const rows = DEFAULT_AVAILABILITY.map((row) => ({
    org_id: orgId,
    ...row,
  }));

  const { error: availabilityError } = await admin
    .from("tenant_availability")
    .upsert(rows, { onConflict: "org_id,day_of_week" });

  if (availabilityError) {
    throw new Error(availabilityError.message);
  }
}
