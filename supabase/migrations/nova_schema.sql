-- SmartCore Nova: AI Personal Assistant Schema
-- Run in Supabase SQL editor

-- ── Conversations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nova_conversations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL,
  title       TEXT NOT NULL DEFAULT 'New conversation',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nova_messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES nova_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Contacts ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nova_contacts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL,
  first_name  TEXT NOT NULL,
  last_name   TEXT,
  email       TEXT,
  phone       TEXT,
  birthday    DATE,
  address     TEXT,
  category    TEXT DEFAULT 'personal',
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── Calendar Events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nova_events (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT,
  location         TEXT,
  start_time       TIMESTAMPTZ NOT NULL,
  end_time         TIMESTAMPTZ,
  all_day          BOOLEAN DEFAULT false,
  reminder_minutes INTEGER DEFAULT 30,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Tasks ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nova_tasks (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  priority     TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status       TEXT DEFAULT 'todo'   CHECK (status IN ('todo','in_progress','completed')),
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ── Reminders ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nova_reminders (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL,
  title           TEXT NOT NULL,
  notes           TEXT,
  remind_at       TIMESTAMPTZ NOT NULL,
  repeat_interval TEXT DEFAULT 'none' CHECK (repeat_interval IN ('none','daily','weekly','monthly','yearly')),
  sent            BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Notes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nova_notes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  tags       TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_nova_conversations_user  ON nova_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_nova_conversations_time  ON nova_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nova_messages_conv       ON nova_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nova_contacts_user       ON nova_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_nova_events_user         ON nova_events(user_id);
CREATE INDEX IF NOT EXISTS idx_nova_events_start        ON nova_events(start_time);
CREATE INDEX IF NOT EXISTS idx_nova_tasks_user          ON nova_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_nova_tasks_due           ON nova_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_nova_reminders_user      ON nova_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_nova_reminders_due       ON nova_reminders(remind_at);
CREATE INDEX IF NOT EXISTS idx_nova_notes_user          ON nova_notes(user_id);

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE nova_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_reminders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_notes         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nova_conversations_owner" ON nova_conversations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "nova_messages_owner"      ON nova_messages      FOR ALL USING (
  conversation_id IN (SELECT id FROM nova_conversations WHERE user_id = auth.uid())
);
CREATE POLICY "nova_contacts_owner"      ON nova_contacts      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "nova_events_owner"        ON nova_events        FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "nova_tasks_owner"         ON nova_tasks         FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "nova_reminders_owner"     ON nova_reminders     FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "nova_notes_owner"         ON nova_notes         FOR ALL USING (auth.uid() = user_id);

-- ── Updated-at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION nova_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_nova_conversations_upd BEFORE UPDATE ON nova_conversations FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER trg_nova_contacts_upd      BEFORE UPDATE ON nova_contacts      FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER trg_nova_events_upd        BEFORE UPDATE ON nova_events        FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER trg_nova_tasks_upd         BEFORE UPDATE ON nova_tasks         FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
CREATE TRIGGER trg_nova_notes_upd         BEFORE UPDATE ON nova_notes         FOR EACH ROW EXECUTE FUNCTION nova_set_updated_at();
