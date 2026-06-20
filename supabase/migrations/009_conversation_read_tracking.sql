-- Track when dashboard staff last viewed a conversation (for unread alerts).

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS staff_read_at TIMESTAMPTZ;

COMMENT ON COLUMN public.ai_conversations.staff_read_at IS
  'When org staff last opened this lead conversation in the dashboard.';
