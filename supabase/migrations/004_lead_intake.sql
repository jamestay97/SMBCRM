-- Lead intake fields and tenant services scope for AI qualification.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS services_scope TEXT;

COMMENT ON COLUMN public.organizations.services_scope IS
  'What this business supports. The AI uses this to confirm appointments are in scope.';

UPDATE public.organizations
SET services_scope = COALESCE(
  services_scope,
  'General service appointments. Configure your exact services in Dashboard → Settings.'
)
WHERE services_scope IS NULL;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS appointment_reason TEXT,
  ADD COLUMN IF NOT EXISTS scope_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.leads.appointment_reason IS
  'Customer issue or reason for the appointment.';
COMMENT ON COLUMN public.leads.scope_confirmed IS
  'True after AI verifies the request fits the tenant services_scope.';

-- Backfill first/last from existing name where possible.
UPDATE public.leads
SET
  first_name = COALESCE(first_name, split_part(name, ' ', 1)),
  last_name = COALESCE(
    last_name,
    NULLIF(trim(substring(name from position(' ' in name) + 1)), '')
  ),
  appointment_reason = COALESCE(appointment_reason, intent)
WHERE first_name IS NULL OR appointment_reason IS NULL;
