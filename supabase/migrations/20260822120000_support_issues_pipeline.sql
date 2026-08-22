-- =============================================================
-- SmartCore /issues  — AI support → fix → review → deploy pipeline
-- =============================================================

-- ---------- 1. Support agent roster (the "staff" users see) ----------
create table if not exists public.support_agents (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  title         text not null default 'SmartCore Technical Support',
  specialism    text,                      -- module slug this agent is the "specialist" for
  initials      text,
  is_active     boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- ---------- 2. Tickets ----------
create sequence if not exists public.support_ticket_seq start 4700;

create table if not exists public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  ticket_ref      text unique not null default ('SC-' || nextval('public.support_ticket_seq')::text),
  -- NOTE: user_id is deliberately NOT a foreign key to auth.users.
  -- Nothing in this system may ever cascade-delete an auth user.
  user_id         uuid,
  company_id      uuid,
  employee_id     uuid,
  contact_name    text,
  contact_email   text,
  module_slug     text,
  module_name     text,
  subject         text,
  status          text not null default 'triage',
  -- triage | diagnosing | queued_for_fix | fixing | in_review | fix_deployed
  -- | awaiting_user | resolved | escalated | rejected | not_a_bug
  severity        text default 'normal',   -- low | normal | high | critical
  agent_id        uuid references public.support_agents(id),
  agent_name      text,
  agent_title     text,
  error_message   text,
  console_log     text,
  steps_to_repro  text,
  browser_info    jsonb,
  diagnosis       text,
  is_bug          boolean,                 -- triage verdict: true bug vs feature request
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index if not exists support_tickets_user_idx    on public.support_tickets(user_id);
create index if not exists support_tickets_company_idx on public.support_tickets(company_id);
create index if not exists support_tickets_status_idx  on public.support_tickets(status);

-- ---------- 3. Chat transcript ----------
create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  role        text not null,               -- user | agent | system | internal
  author_name text,
  content     text not null,
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id, created_at);

-- ---------- 4. Fix attempts (with pre-change backups) ----------
create table if not exists public.support_fix_attempts (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        uuid not null references public.support_tickets(id) on delete cascade,
  attempt_no       int not null default 1,
  status           text not null default 'pending',
  -- pending | generating | awaiting_review | approved | rejected | deployed
  -- | failed | reverted
  summary          text,
  rationale        text,
  files_changed    jsonb,                  -- [{path, reason}]
  backups          jsonb,                  -- {path: original_full_content}  <- instant revert
  patch            jsonb,                  -- [{path, old_string, new_string, reason}]
  applied_hashes   jsonb,                  -- {path: sha256_after_fix} — revert drift check
  branch_name      text,
  base_sha         text,
  commit_sha       text,
  merge_sha        text,
  reviewer_verdict text,                   -- approved | rejected
  reviewer_reason  text,
  reviewer_checks  jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  deployed_at      timestamptz,
  reverted_at      timestamptz
);
create index if not exists support_fix_ticket_idx on public.support_fix_attempts(ticket_id);

-- ---------- 5. Event / audit trail ----------
create table if not exists public.support_events (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid references public.support_tickets(id) on delete cascade,
  kind       text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index if not exists support_events_ticket_idx on public.support_events(ticket_id, created_at);

-- ---------- 6. updated_at trigger ----------
create or replace function public.support_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch before update on public.support_tickets
for each row execute function public.support_touch_updated_at();

-- ---------- 7. Seed the agent roster ----------
insert into public.support_agents (name, title, specialism, initials, sort_order)
values
  ('Jane Walsh',    'SmartCore Technical Support',      null,                    'JW', 1),
  ('Tom Bridges',   'SmartCore CRM Specialist',         'crm',                   'TB', 2),
  ('Priya Raman',   'SmartCore Platform Engineer',      null,                    'PR', 3),
  ('Callum Reid',   'SmartCore Fire Safety Specialist', 'presence-fire-safety',  'CR', 4),
  ('Sophie Elliot', 'SmartCore Technical Support',      null,                    'SE', 5),
  ('Marcus Doyle',  'SmartCore SiteSnap Specialist',    'sitesnap',              'MD', 6),
  ('Hannah Croft',  'SmartCore Flexi Specialist',       'smartcore-flexi',       'HC', 7),
  ('Ryan Okafor',   'SmartCore Platform Engineer',      null,                    'RO', 8)
on conflict do nothing;

-- ---------- 8. RLS ----------
alter table public.support_agents       enable row level security;
alter table public.support_tickets      enable row level security;
alter table public.support_messages     enable row level security;
alter table public.support_fix_attempts enable row level security;
alter table public.support_events       enable row level security;

-- Agents: anyone signed in may read the roster (needed to render names)
drop policy if exists support_agents_read on public.support_agents;
create policy support_agents_read on public.support_agents
  for select to authenticated using (true);

-- Tickets: a user sees only their own; SmartCore staff see everything
drop policy if exists support_tickets_own on public.support_tickets;
create policy support_tickets_own on public.support_tickets
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.smartcore_staff s
               where s.user_id = auth.uid() and s.is_active is not false)
  );

drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists support_tickets_update on public.support_tickets;
create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.smartcore_staff s
               where s.user_id = auth.uid() and s.is_active is not false)
  );

-- Messages: visible if the parent ticket is visible; never expose 'internal'
drop policy if exists support_messages_read on public.support_messages;
create policy support_messages_read on public.support_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.support_tickets t
      where t.id = support_messages.ticket_id
        and (
          t.user_id = auth.uid()
          or exists (select 1 from public.smartcore_staff s
                     where s.user_id = auth.uid() and s.is_active is not false)
        )
    )
    and (
      role <> 'internal'
      or exists (select 1 from public.smartcore_staff s
                 where s.user_id = auth.uid() and s.is_active is not false)
    )
  );

drop policy if exists support_messages_insert on public.support_messages;
create policy support_messages_insert on public.support_messages
  for insert to authenticated
  with check (
    role = 'user'
    and exists (select 1 from public.support_tickets t
                where t.id = ticket_id and t.user_id = auth.uid())
  );

-- Fix attempts + events: SmartCore staff only (users never see the machinery)
drop policy if exists support_fix_staff on public.support_fix_attempts;
create policy support_fix_staff on public.support_fix_attempts
  for select to authenticated
  using (exists (select 1 from public.smartcore_staff s
                 where s.user_id = auth.uid() and s.is_active is not false));

drop policy if exists support_events_staff on public.support_events;
create policy support_events_staff on public.support_events
  for select to authenticated
  using (exists (select 1 from public.smartcore_staff s
                 where s.user_id = auth.uid() and s.is_active is not false));
