-- Per-slot appointment capacity (e.g. max 1 customer per time slot).

ALTER TABLE public.tenant_calendar_settings
  ADD COLUMN IF NOT EXISTS limit_appointments_per_slot BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS max_appointments_per_slot INTEGER NOT NULL DEFAULT 1
    CHECK (max_appointments_per_slot >= 1 AND max_appointments_per_slot <= 50);

COMMENT ON COLUMN public.tenant_calendar_settings.limit_appointments_per_slot IS
  'When true, enforce max_appointments_per_slot for overlapping bookings.';
COMMENT ON COLUMN public.tenant_calendar_settings.max_appointments_per_slot IS
  'Maximum concurrent appointments allowed in the same time window.';
