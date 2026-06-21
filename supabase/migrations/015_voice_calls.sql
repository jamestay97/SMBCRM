-- Vapi inbound call history synced from webhooks
CREATE TABLE IF NOT EXISTS public.voice_calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  lead_id          UUID REFERENCES public.leads (id) ON DELETE SET NULL,
  vapi_call_id     TEXT NOT NULL,
  customer_phone   TEXT NOT NULL,
  business_phone   TEXT,
  status           TEXT NOT NULL DEFAULT 'in_progress',
  direction        TEXT NOT NULL DEFAULT 'inbound',
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  transcript       TEXT,
  summary          TEXT,
  recording_url    TEXT,
  ended_reason     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT voice_calls_vapi_call_id_unique UNIQUE (vapi_call_id),
  CONSTRAINT voice_calls_status_check
    CHECK (status IN ('in_progress', 'completed', 'failed', 'no_answer', 'busy')),
  CONSTRAINT voice_calls_direction_check
    CHECK (direction IN ('inbound', 'outbound'))
);

CREATE INDEX IF NOT EXISTS idx_voice_calls_org_id
  ON public.voice_calls (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_calls_lead_id
  ON public.voice_calls (lead_id, created_at DESC);

CREATE TRIGGER voice_calls_set_updated_at
  BEFORE UPDATE ON public.voice_calls
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.voice_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voice_calls_member_select" ON public.voice_calls;
CREATE POLICY "voice_calls_member_select"
  ON public.voice_calls FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS "voice_calls_platform_admin" ON public.voice_calls;
CREATE POLICY "voice_calls_platform_admin"
  ON public.voice_calls FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());
