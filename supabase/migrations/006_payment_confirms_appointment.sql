-- Ensure payment success confirms pending calendar appointments (idempotent).
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
