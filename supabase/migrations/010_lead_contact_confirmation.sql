-- Service address and explicit contact confirmation before booking.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS service_address TEXT,
  ADD COLUMN IF NOT EXISTS contact_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.leads.service_address IS
  'Street address where the appointment service will take place.';
COMMENT ON COLUMN public.leads.contact_confirmed IS
  'True after the customer confirms name, phone, email, and service address.';
