-- Payment deposit reminders: 30 min, 2 hr, 24 hr while lead is payment_pending.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS checkout_url TEXT;

COMMENT ON COLUMN public.payments.checkout_url IS
  'Stripe Checkout URL sent to the customer for this deposit.';

CREATE TYPE public.payment_followup_status AS ENUM (
  'pending',
  'sent',
  'skipped',
  'cancelled'
);

CREATE TABLE public.lead_payment_followups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  lead_id       UUID NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  followup_step SMALLINT NOT NULL CHECK (followup_step BETWEEN 1 AND 3),
  scheduled_at  TIMESTAMPTZ NOT NULL,
  sent_at       TIMESTAMPTZ,
  status        public.payment_followup_status NOT NULL DEFAULT 'pending',
  message_body  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lead_payment_followups_lead_step_unique UNIQUE (lead_id, followup_step)
);

CREATE INDEX idx_lead_payment_followups_due
  ON public.lead_payment_followups (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX idx_lead_payment_followups_lead_id
  ON public.lead_payment_followups (lead_id, followup_step);

ALTER TABLE public.lead_payment_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_payment_followups_member_select"
  ON public.lead_payment_followups FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));
