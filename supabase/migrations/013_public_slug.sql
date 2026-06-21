-- Public customer-facing page slug (e.g. /b/acme-plumbing)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_public_slug
  ON public.organizations (public_slug)
  WHERE public_slug IS NOT NULL;
