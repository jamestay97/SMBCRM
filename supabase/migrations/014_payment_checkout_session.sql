-- Link Stripe Checkout sessions to pending payment rows (cs_... vs pi_...).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_checkout_session_id
  ON public.payments (checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

COMMENT ON COLUMN public.payments.checkout_session_id IS
  'Stripe Checkout Session id (cs_...) for matching webhook/success redirects.';
