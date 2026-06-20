-- =============================================================================
-- AI Autonomous Sales Rep — Multi-Tenant Database Schema
-- Run against a fresh Supabase Postgres instance (SQL Editor or migration).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enum types
-- -----------------------------------------------------------------------------

CREATE TYPE public.lead_status AS ENUM (
  'new',
  'engaged',
  'payment_pending',
  'locked_in'
);

CREATE TYPE public.payment_status AS ENUM (
  'pending',
  'succeeded',
  'failed',
  'canceled'
);

CREATE TYPE public.org_member_role AS ENUM (
  'owner',
  'admin',
  'member'
);

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

CREATE TABLE public.organizations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name       TEXT        NOT NULL,
  stripe_account_id   TEXT,
  ai_system_prompt    TEXT        NOT NULL,
  deposit_amount_cents INTEGER    NOT NULL CHECK (deposit_amount_cents > 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.organizations IS 'Tenant root. Each business is one organization.';
COMMENT ON COLUMN public.organizations.stripe_account_id IS 'Stripe Connect account ID when using Connect; NULL for platform-only billing.';
COMMENT ON COLUMN public.organizations.ai_system_prompt IS 'System prompt injected when initializing Ollama conversations for this org.';

-- Links Supabase Auth users to organizations (required for RLS).
CREATE TABLE public.organization_members (
  id         UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID               NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id    UUID               NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role       public.org_member_role NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE public.leads (
  id         UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID              NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name       TEXT              NOT NULL,
  phone      TEXT,
  email      TEXT,
  status     public.lead_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT leads_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE public.ai_conversations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           UUID        NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  org_id            UUID        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  openai_thread_id  TEXT        NOT NULL,
  transcript_json   JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_conversations_org_matches_lead
    CHECK (org_id IS NOT NULL)
);

COMMENT ON COLUMN public.ai_conversations.openai_thread_id IS 'Legacy column name — stores local Ollama session id (ollama-uuid).';

CREATE TABLE public.payments (
  id               UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID                 NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  lead_id          UUID                 NOT NULL REFERENCES public.leads (id) ON DELETE CASCADE,
  stripe_intent_id TEXT                 NOT NULL,
  amount_paid      INTEGER              NOT NULL CHECK (amount_paid > 0),
  status           public.payment_status NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  CONSTRAINT payments_stripe_intent_unique UNIQUE (stripe_intent_id)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

CREATE INDEX idx_organization_members_user_id ON public.organization_members (user_id);
CREATE INDEX idx_organization_members_org_id  ON public.organization_members (org_id);

CREATE INDEX idx_leads_org_id        ON public.leads (org_id);
CREATE INDEX idx_leads_org_id_status ON public.leads (org_id, status);
CREATE INDEX idx_leads_phone         ON public.leads (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_leads_email         ON public.leads (email) WHERE email IS NOT NULL;

CREATE INDEX idx_ai_conversations_org_id  ON public.ai_conversations (org_id);
CREATE INDEX idx_ai_conversations_lead_id ON public.ai_conversations (lead_id);
CREATE INDEX idx_ai_conversations_thread  ON public.ai_conversations (openai_thread_id);

CREATE INDEX idx_payments_org_id           ON public.payments (org_id);
CREATE INDEX idx_payments_lead_id          ON public.payments (lead_id);
CREATE INDEX idx_payments_org_id_status      ON public.payments (org_id, status);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER ai_conversations_set_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER payments_set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enforce ai_conversations.org_id matches the lead's org_id.
CREATE OR REPLACE FUNCTION public.enforce_ai_conversation_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lead_org_id UUID;
BEGIN
  SELECT org_id INTO lead_org_id FROM public.leads WHERE id = NEW.lead_id;
  IF lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead % does not exist', NEW.lead_id;
  END IF;
  NEW.org_id := lead_org_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_conversations_enforce_org_id
  BEFORE INSERT OR UPDATE OF lead_id, org_id ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_conversation_org_id();

-- Enforce payments.org_id matches the lead's org_id.
CREATE OR REPLACE FUNCTION public.enforce_payment_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lead_org_id UUID;
BEGIN
  SELECT org_id INTO lead_org_id FROM public.leads WHERE id = NEW.lead_id;
  IF lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead % does not exist', NEW.lead_id;
  END IF;
  NEW.org_id := lead_org_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payments_enforce_org_id
  BEFORE INSERT OR UPDATE OF lead_id, org_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_org_id();

-- -----------------------------------------------------------------------------
-- RLS helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id
  FROM public.organization_members
  WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_is_org_admin(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE user_id = auth.uid()
      AND org_id = p_org_id
      AND role IN ('owner', 'admin')
  );
$$;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments              ENABLE ROW LEVEL SECURITY;

-- organizations
CREATE POLICY "organizations_select_member"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "organizations_update_admin"
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (public.current_user_is_org_admin(id))
  WITH CHECK (public.current_user_is_org_admin(id));

CREATE POLICY "organizations_insert_authenticated"
  ON public.organizations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- organization_members
CREATE POLICY "organization_members_select_same_org"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "organization_members_insert_self_on_create"
  ON public.organization_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "organization_members_admin_manage"
  ON public.organization_members FOR ALL
  TO authenticated
  USING (public.current_user_is_org_admin(org_id))
  WITH CHECK (public.current_user_is_org_admin(org_id));

-- leads
CREATE POLICY "leads_select_member"
  ON public.leads FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "leads_insert_member"
  ON public.leads FOR INSERT
  TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "leads_update_member"
  ON public.leads FOR UPDATE
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "leads_delete_admin"
  ON public.leads FOR DELETE
  TO authenticated
  USING (public.current_user_is_org_admin(org_id));

-- ai_conversations
CREATE POLICY "ai_conversations_select_member"
  ON public.ai_conversations FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "ai_conversations_insert_member"
  ON public.ai_conversations FOR INSERT
  TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "ai_conversations_update_member"
  ON public.ai_conversations FOR UPDATE
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "ai_conversations_delete_admin"
  ON public.ai_conversations FOR DELETE
  TO authenticated
  USING (public.current_user_is_org_admin(org_id));

-- payments
CREATE POLICY "payments_select_member"
  ON public.payments FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "payments_insert_member"
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "payments_update_member"
  ON public.payments FOR UPDATE
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_org_ids()));

CREATE POLICY "payments_delete_admin"
  ON public.payments FOR DELETE
  TO authenticated
  USING (public.current_user_is_org_admin(org_id));

-- -----------------------------------------------------------------------------
-- Atomic payment-success handler (called by Stripe webhook via service role)
-- -----------------------------------------------------------------------------

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
