-- Track whether scope was explained to the customer and each contact field was collected in chat.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS scope_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intake_name_collected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intake_phone_collected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intake_email_collected BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS intake_address_collected BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.leads.scope_acknowledged IS
  'True after the customer was told whether their request is in scope.';
COMMENT ON COLUMN public.leads.intake_name_collected IS
  'True after the customer provided their name in the conversation.';
COMMENT ON COLUMN public.leads.intake_phone_collected IS
  'True after the customer provided their phone number in the conversation.';
COMMENT ON COLUMN public.leads.intake_email_collected IS
  'True after the customer provided their email in the conversation.';
COMMENT ON COLUMN public.leads.intake_address_collected IS
  'True after the customer provided the service address in the conversation.';
