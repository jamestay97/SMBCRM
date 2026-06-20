-- =============================================================================
-- Migration 002: Platform multi-tenant (super-admin, subscriptions, async SLA)
-- Run in Supabase SQL Editor AFTER schema.sql on existing projects.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.platform_role AS ENUM ('super_admin', 'support');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_status AS ENUM (
    'trialing', 'active', 'past_due', 'canceled', 'suspended'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.inbound_job_status AS ENUM (
    'queued', 'processing', 'completed', 'failed', 'sla_breached'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- Platform admins
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role       public.platform_role NOT NULL DEFAULT 'super_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Extend organizations (tenant config)
-- -----------------------------------------------------------------------------

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_status_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'suspended', 'onboarding'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS llm_provider TEXT NOT NULL DEFAULT 'ollama';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_llm_provider_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_llm_provider_check
  CHECK (llm_provider IN ('ollama', 'openai', 'anthropic'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS llm_model TEXT;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS llm_api_key_encrypted TEXT;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS sla_target_seconds INTEGER NOT NULL DEFAULT 300;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

-- -----------------------------------------------------------------------------
-- Tenant subscriptions (your SaaS billing)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL UNIQUE REFERENCES public.organizations (id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan_id                TEXT NOT NULL DEFAULT 'starter',
  status                 public.subscription_status NOT NULL DEFAULT 'trialing',
  trial_ends_at          TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Per-tenant Twilio numbers
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tenant_phone_numbers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  twilio_sid   TEXT,
  phone_number TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'both',
  is_primary   BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_phone_numbers_channel_check
    CHECK (channel IN ('sms', 'voice', 'both')),
  CONSTRAINT tenant_phone_numbers_phone_unique UNIQUE (phone_number)
);

CREATE INDEX IF NOT EXISTS idx_tenant_phone_numbers_org_id
  ON public.tenant_phone_numbers (org_id);

-- -----------------------------------------------------------------------------
-- Extend leads (extraction + SLA)
-- -----------------------------------------------------------------------------

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS intent TEXT;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS extracted_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_source_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_source_check
  CHECK (source IS NULL OR source IN ('sms', 'voice', 'webchat', 'manual'));

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sla_met BOOLEAN;

-- -----------------------------------------------------------------------------
-- Extend conversations
-- -----------------------------------------------------------------------------

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT;

ALTER TABLE public.ai_conversations
  DROP CONSTRAINT IF EXISTS ai_conversations_channel_check;

ALTER TABLE public.ai_conversations
  ADD CONSTRAINT ai_conversations_channel_check
  CHECK (channel IS NULL OR channel IN ('sms', 'voice', 'webchat'));

-- -----------------------------------------------------------------------------
-- Async inbound job queue
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.inbound_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES public.leads (id) ON DELETE SET NULL,
  channel         TEXT NOT NULL,
  payload_json    JSONB NOT NULL,
  status          public.inbound_job_status NOT NULL DEFAULT 'queued',
  sla_deadline_at TIMESTAMPTZ NOT NULL,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  result_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inbound_jobs_channel_check
    CHECK (channel IN ('sms', 'voice', 'webchat'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_jobs_queued
  ON public.inbound_jobs (status, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_inbound_jobs_org_id
  ON public.inbound_jobs (org_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS tenant_subscriptions_set_updated_at ON public.tenant_subscriptions;

CREATE TRIGGER tenant_subscriptions_set_updated_at
  BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_jobs ENABLE ROW LEVEL SECURITY;

-- platform_admins
DROP POLICY IF EXISTS "platform_admins_self_select" ON public.platform_admins;
CREATE POLICY "platform_admins_self_select"
  ON public.platform_admins FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_admin());

DROP POLICY IF EXISTS "platform_admins_super_manage" ON public.platform_admins;
CREATE POLICY "platform_admins_super_manage"
  ON public.platform_admins FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- organizations: platform admin override
DROP POLICY IF EXISTS "organizations_platform_admin_all" ON public.organizations;
CREATE POLICY "organizations_platform_admin_all"
  ON public.organizations FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- organization_members: platform admin manage
DROP POLICY IF EXISTS "organization_members_platform_admin" ON public.organization_members;
CREATE POLICY "organization_members_platform_admin"
  ON public.organization_members FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- leads / conversations / payments: platform admin read
DROP POLICY IF EXISTS "leads_platform_admin_select" ON public.leads;
CREATE POLICY "leads_platform_admin_select"
  ON public.leads FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "ai_conversations_platform_admin_select" ON public.ai_conversations;
CREATE POLICY "ai_conversations_platform_admin_select"
  ON public.ai_conversations FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "payments_platform_admin_select" ON public.payments;
CREATE POLICY "payments_platform_admin_select"
  ON public.payments FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- tenant_subscriptions
DROP POLICY IF EXISTS "tenant_subscriptions_member_select" ON public.tenant_subscriptions;
CREATE POLICY "tenant_subscriptions_member_select"
  ON public.tenant_subscriptions FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "tenant_subscriptions_platform_admin" ON public.tenant_subscriptions;
CREATE POLICY "tenant_subscriptions_platform_admin"
  ON public.tenant_subscriptions FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- tenant_phone_numbers
DROP POLICY IF EXISTS "tenant_phone_numbers_member_select" ON public.tenant_phone_numbers;
CREATE POLICY "tenant_phone_numbers_member_select"
  ON public.tenant_phone_numbers FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "tenant_phone_numbers_platform_admin" ON public.tenant_phone_numbers;
CREATE POLICY "tenant_phone_numbers_platform_admin"
  ON public.tenant_phone_numbers FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- inbound_jobs
DROP POLICY IF EXISTS "inbound_jobs_member_select" ON public.inbound_jobs;
CREATE POLICY "inbound_jobs_member_select"
  ON public.inbound_jobs FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "inbound_jobs_platform_admin" ON public.inbound_jobs;
CREATE POLICY "inbound_jobs_platform_admin"
  ON public.inbound_jobs FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- -----------------------------------------------------------------------------
-- Bootstrap: grant yourself super-admin (replace email)
-- -----------------------------------------------------------------------------
-- INSERT INTO public.platform_admins (user_id, role)
-- SELECT id, 'super_admin' FROM auth.users WHERE email = 'you@example.com'
-- ON CONFLICT (user_id) DO NOTHING;
