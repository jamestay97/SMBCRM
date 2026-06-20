-- Prevent duplicate email addresses within the same organization.

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_org_email_unique
  ON public.leads (org_id, lower(trim(email)))
  WHERE email IS NOT NULL;
