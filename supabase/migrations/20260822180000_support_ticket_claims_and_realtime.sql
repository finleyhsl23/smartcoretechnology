-- Staff can take a ticket over from the AI agent; once claimed, the AI
-- stops replying and only the claiming (or any) staff member's manual
-- replies go out, until it's handed back.
alter table public.support_tickets
  add column if not exists claimed_by uuid references public.smartcore_staff(id),
  add column if not exists claimed_by_name text,
  add column if not exists claimed_at timestamptz;

-- Live updates in the support console and on /issues without polling.
alter publication supabase_realtime add table public.support_messages;
alter publication supabase_realtime add table public.support_tickets;
