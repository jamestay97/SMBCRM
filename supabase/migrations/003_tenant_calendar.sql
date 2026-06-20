-- Per-tenant scheduling: availability windows, calendar settings, and appointments.

CREATE TYPE public.appointment_status AS ENUM (
  'pending_payment',
  'confirmed',
  'cancelled'
);

CREATE TABLE public.tenant_calendar_settings (
  org_id                 UUID        PRIMARY KEY REFERENCES public.organizations (id) ON DELETE CASCADE,
  slot_duration_minutes  INTEGER     NOT NULL DEFAULT 60
    CHECK (slot_duration_minutes >= 15 AND slot_duration_minutes <= 480),
  min_notice_hours       INTEGER     NOT NULL DEFAULT 2
    CHECK (min_notice_hours >= 0),
  booking_horizon_days   INTEGER     NOT NULL DEFAULT 30
    CHECK (booking_horizon_days >= 1 AND booking_horizon_days <= 90),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.tenant_calendar_settings IS 'Per-tenant booking rules (slot length, notice, horizon).';

CREATE TABLE public.tenant_availability (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  day_of_week  SMALLINT    NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time   TIME        NOT NULL,
  end_time     TIME        NOT NULL,
  is_enabled   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_availability_time_order CHECK (end_time > start_time),
  UNIQUE (org_id, day_of_week)
);

COMMENT ON TABLE public.tenant_availability IS 'Weekly hours per tenant. day_of_week: 0=Sunday … 6=Saturday, times in org timezone.';
COMMENT ON COLUMN public.tenant_availability.start_time IS 'Local business hours start (interpreted in organizations.timezone).';

CREATE TABLE public.appointments (
  id         UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID                      NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  lead_id    UUID                      NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  payment_id UUID                      REFERENCES public.payments (id) ON DELETE SET NULL,
  starts_at  TIMESTAMPTZ               NOT NULL,
  ends_at    TIMESTAMPTZ               NOT NULL,
  status     public.appointment_status NOT NULL DEFAULT 'pending_payment',
  title      TEXT                      NOT NULL DEFAULT 'Appointment',
  created_at TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  CONSTRAINT appointments_time_order CHECK (ends_at > starts_at)
);

CREATE INDEX idx_tenant_availability_org ON public.tenant_availability (org_id);
CREATE INDEX idx_appointments_org_starts ON public.appointments (org_id, starts_at);
CREATE INDEX idx_appointments_org_status ON public.appointments (org_id, status);
CREATE INDEX idx_appointments_lead       ON public.appointments (lead_id);

CREATE TRIGGER tenant_calendar_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_calendar_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tenant_availability_set_updated_at
  BEFORE UPDATE ON public.tenant_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER appointments_set_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Default Mon–Fri 9am–5pm for every existing org.
INSERT INTO public.tenant_calendar_settings (org_id)
SELECT id FROM public.organizations
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO public.tenant_availability (org_id, day_of_week, start_time, end_time, is_enabled)
SELECT o.id, d.day_of_week, d.start_time::time, d.end_time::time, d.is_enabled
FROM public.organizations o
CROSS JOIN (
  VALUES
    (0, '09:00', '17:00', FALSE),
    (1, '09:00', '17:00', TRUE),
    (2, '09:00', '17:00', TRUE),
    (3, '09:00', '17:00', TRUE),
    (4, '09:00', '17:00', TRUE),
    (5, '09:00', '17:00', TRUE),
    (6, '09:00', '17:00', FALSE)
) AS d(day_of_week, start_time, end_time, is_enabled)
ON CONFLICT (org_id, day_of_week) DO NOTHING;

-- RLS
ALTER TABLE public.tenant_calendar_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_availability      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments             ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_calendar_settings_select_member"
  ON public.tenant_calendar_settings FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "tenant_calendar_settings_admin_write"
  ON public.tenant_calendar_settings FOR ALL
  TO authenticated
  USING (public.current_user_is_org_admin(org_id))
  WITH CHECK (public.current_user_is_org_admin(org_id));

CREATE POLICY "tenant_availability_select_member"
  ON public.tenant_availability FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "tenant_availability_admin_write"
  ON public.tenant_availability FOR ALL
  TO authenticated
  USING (public.current_user_is_org_admin(org_id))
  WITH CHECK (public.current_user_is_org_admin(org_id));

CREATE POLICY "appointments_select_member"
  ON public.appointments FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "appointments_update_member"
  ON public.appointments FOR UPDATE
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "appointments_delete_admin"
  ON public.appointments FOR DELETE
  TO authenticated
  USING (public.current_user_is_org_admin(org_id));

-- Confirm pending appointments when deposit payment succeeds.
CREATE OR REPLACE FUNCTION public.handle_payment_succeeded(
  p_stripe_intent_id TEXT,
  p_amount_paid      INTEGER
)
RETURNS TABLE (
  payment_id UUID,
  lead_id    UUID,
  org_id     UUID,
  lead_name  TEXT,
  business_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_lead    public.leads%ROWTYPE;
  v_org     public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE stripe_intent_id = p_stripe_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found for stripe_intent_id=%', p_stripe_intent_id;
  END IF;

  IF v_payment.status = 'succeeded' THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = v_payment.lead_id;
    SELECT * INTO v_org  FROM public.organizations WHERE id = v_payment.org_id;
    RETURN QUERY
      SELECT v_payment.id, v_payment.lead_id, v_payment.org_id, v_lead.name, v_org.business_name;
    RETURN;
  END IF;

  UPDATE public.payments
  SET status = 'succeeded', amount_paid = p_amount_paid
  WHERE id = v_payment.id;

  UPDATE public.leads
  SET status = 'locked_in'
  WHERE id = v_payment.lead_id
    AND org_id = v_payment.org_id;

  UPDATE public.appointments
  SET
    status = 'confirmed',
    payment_id = v_payment.id
  WHERE lead_id = v_payment.lead_id
    AND org_id = v_payment.org_id
    AND status = 'pending_payment';

  SELECT * INTO v_lead FROM public.leads WHERE id = v_payment.lead_id;
  SELECT * INTO v_org  FROM public.organizations WHERE id = v_payment.org_id;

  RETURN QUERY
    SELECT v_payment.id, v_payment.lead_id, v_payment.org_id, v_lead.name, v_org.business_name;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_payment_succeeded(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_payment_succeeded(TEXT, INTEGER) TO service_role;
