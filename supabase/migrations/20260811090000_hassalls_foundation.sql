-- ============================================================================
-- Hassalls — Private Surveillance module
-- Private, unlisted tenant schema for personal/family use (house + storage
-- unit security cameras, ANPR-style vehicle logging, threat alerts). Tables
-- live in their own `hassalls` schema, same tenant-schema convention as
-- smartfitsinstallationsltd (a Postgres schema per tenant, rather than
-- prefixed tables in `public`) — chosen here because this module is fully
-- isolated and has no shared tables with any other tenant.
--
-- Access model is intentionally stricter than a normal purchased module:
--   - `hassalls.allowed_users` is an explicit per-person allow-list. Being an
--     employee of the Hassalls company record is NOT sufficient on its own —
--     every dashboard-facing policy also requires hassalls.is_allowed_user().
--   - The Raspberry Pi ingestion path never authenticates as a person. It
--     presents a per-site API key (hashed at rest in hassalls.ingestion_keys)
--     as a custom `x-ingestion-key` request header, which PostgREST exposes
--     to Postgres via the `request.headers` GUC. hassalls.current_ingestion_site_id()
--     reads that header and resolves it to a site — this is what lets the
--     ingestion Worker use the anon key with no service-role key anywhere.
--
-- Tables are created first (functions in LANGUAGE sql are validated against
-- the catalog at CREATE FUNCTION time, so they must come after the tables
-- they query); RLS policies are added in a separate pass once every helper
-- function exists.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS hassalls;

GRANT USAGE ON SCHEMA hassalls TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- allowed_users — explicit access allow-list for the dashboard. Not gated by
-- company_modules at all; this is the sole gate for reading/writing any
-- Hassalls data as a person (as opposed to the Pi's ingestion key).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.allowed_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  auth_user_id  uuid UNIQUE,
  label         text,
  added_at      timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- ingestion_keys — one API key per site for the Raspberry Pi watcher script.
-- Only the sha256 hash is stored; the raw key is shown once at creation time
-- and never persisted. site_id FK added once hassalls.sites exists below.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.ingestion_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL,
  label       text,
  key_prefix  text NOT NULL,
  key_hash    text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

CREATE INDEX IF NOT EXISTS ingestion_keys_site_idx ON hassalls.ingestion_keys(site_id);

-- ----------------------------------------------------------------------------
-- sites
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  address     text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ingestion_keys_site_fk' AND table_schema = 'hassalls'
  ) THEN
    ALTER TABLE hassalls.ingestion_keys
      ADD CONSTRAINT ingestion_keys_site_fk FOREIGN KEY (site_id) REFERENCES hassalls.sites(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- cameras
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.cameras (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES hassalls.sites(id) ON DELETE CASCADE,
  name        text NOT NULL,
  nvr_ip      text,
  channel     integer,
  status      text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  last_seen   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cameras_site_idx ON hassalls.cameras(site_id);

-- ----------------------------------------------------------------------------
-- vehicles — running registry of every plate ever read, upserted by the
-- ingestion Worker and hand-labelled from the dashboard via known_vehicles.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.vehicles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate       text NOT NULL UNIQUE,
  make_model  text,
  colour      text,
  confidence  text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  times_seen  integer NOT NULL DEFAULT 1,
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hassalls.vehicles
  ADD COLUMN IF NOT EXISTS plate_norm text
  GENERATED ALWAYS AS (upper(regexp_replace(plate, '\s+', '', 'g'))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_plate_norm_idx ON hassalls.vehicles(plate_norm);
CREATE INDEX IF NOT EXISTS vehicles_last_seen_idx ON hassalls.vehicles(last_seen DESC);

-- ----------------------------------------------------------------------------
-- known_vehicles — hand-labelled subset of vehicles ("Dad's truck" etc).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.known_vehicles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate       text NOT NULL REFERENCES hassalls.vehicles(plate) ON DELETE CASCADE ON UPDATE CASCADE,
  label       text NOT NULL,
  owner_note  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS known_vehicles_plate_idx ON hassalls.known_vehicles(plate);

-- ----------------------------------------------------------------------------
-- events — one row per motion/beam/manual trigger, after Claude's vision
-- review on the Pi. `timestamp` is a reserved-ish type name, so the column is
-- `event_time`; the ingestion Worker maps the incoming JSON `timestamp`
-- field onto it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  camera_id           uuid REFERENCES hassalls.cameras(id) ON DELETE SET NULL,
  site_id             uuid NOT NULL REFERENCES hassalls.sites(id) ON DELETE CASCADE,
  event_time          timestamptz NOT NULL DEFAULT now(),
  event_type          text NOT NULL CHECK (event_type IN ('motion', 'beam', 'manual')),
  objects_detected    jsonb NOT NULL DEFAULT '[]'::jsonb,
  vehicle_plate       text,
  vehicle_description text,
  threat_level        text NOT NULL DEFAULT 'none' CHECK (threat_level IN ('none', 'low', 'medium', 'high')),
  description         text,
  confidence_method   text NOT NULL DEFAULT 'none' CHECK (confidence_method IN ('direct_read', 'inferred_match', 'none')),
  frame_urls          jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_ai_response     jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_site_time_idx ON hassalls.events(site_id, event_time DESC);
CREATE INDEX IF NOT EXISTS events_camera_idx ON hassalls.events(camera_id);
CREATE INDEX IF NOT EXISTS events_threat_idx ON hassalls.events(threat_level);
CREATE INDEX IF NOT EXISTS events_plate_idx ON hassalls.events(vehicle_plate) WHERE vehicle_plate IS NOT NULL;

-- ----------------------------------------------------------------------------
-- alerts — raised for medium/high threat events.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hassalls.alerts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES hassalls.events(id) ON DELETE CASCADE,
  severity      text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  message       text NOT NULL,
  acknowledged  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_ack_idx ON hassalls.alerts(acknowledged, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_event_idx ON hassalls.alerts(event_id);

-- ============================================================================
-- Helper functions (all referenced tables now exist)
-- ============================================================================

CREATE OR REPLACE FUNCTION hassalls.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Explicit per-user allow-list check — matches either a linked auth_user_id
-- or (before first login, when we only know the email) the JWT's email
-- claim. This is deliberately independent of smartcore_core_purchased_modules
-- / company_modules: those only say Hassalls owns the module, not who at
-- Hassalls may open it.
CREATE OR REPLACE FUNCTION hassalls.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hassalls, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM hassalls.allowed_users a
    WHERE a.auth_user_id = auth.uid()
       OR (a.auth_user_id IS NULL AND lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

-- Resolves the calling request's ingestion API key (sent as the
-- `x-ingestion-key` header) to the site it belongs to, or NULL if missing/
-- unrecognised/revoked. SECURITY DEFINER so anon can call it without being
-- granted SELECT on ingestion_keys directly — the raw key hash never leaves
-- this function.
CREATE OR REPLACE FUNCTION hassalls.current_ingestion_site_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = hassalls, extensions, pg_temp
AS $$
  SELECT k.site_id
  FROM hassalls.ingestion_keys k
  WHERE k.key_hash = encode(digest(
          coalesce(current_setting('request.headers', true)::json ->> 'x-ingestion-key', ''),
          'sha256'
        ), 'hex')
    AND k.revoked_at IS NULL
  LIMIT 1;
$$;

-- ============================================================================
-- Triggers
-- ============================================================================

DROP TRIGGER IF EXISTS sites_set_updated_at ON hassalls.sites;
CREATE TRIGGER sites_set_updated_at BEFORE UPDATE ON hassalls.sites
  FOR EACH ROW EXECUTE FUNCTION hassalls.set_updated_at();

DROP TRIGGER IF EXISTS cameras_set_updated_at ON hassalls.cameras;
CREATE TRIGGER cameras_set_updated_at BEFORE UPDATE ON hassalls.cameras
  FOR EACH ROW EXECUTE FUNCTION hassalls.set_updated_at();

DROP TRIGGER IF EXISTS vehicles_set_updated_at ON hassalls.vehicles;
CREATE TRIGGER vehicles_set_updated_at BEFORE UPDATE ON hassalls.vehicles
  FOR EACH ROW EXECUTE FUNCTION hassalls.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

ALTER TABLE hassalls.allowed_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE hassalls.ingestion_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE hassalls.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE hassalls.cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE hassalls.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hassalls.known_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hassalls.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hassalls.alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowed_users_select ON hassalls.allowed_users;
CREATE POLICY allowed_users_select ON hassalls.allowed_users
  FOR SELECT USING (hassalls.is_allowed_user());

DROP POLICY IF EXISTS allowed_users_write ON hassalls.allowed_users;
CREATE POLICY allowed_users_write ON hassalls.allowed_users
  FOR ALL USING (hassalls.is_allowed_user())
  WITH CHECK (hassalls.is_allowed_user());

DROP POLICY IF EXISTS ingestion_keys_all ON hassalls.ingestion_keys;
CREATE POLICY ingestion_keys_all ON hassalls.ingestion_keys
  FOR ALL USING (hassalls.is_allowed_user())
  WITH CHECK (hassalls.is_allowed_user());

DROP POLICY IF EXISTS sites_all ON hassalls.sites;
CREATE POLICY sites_all ON hassalls.sites
  FOR ALL USING (hassalls.is_allowed_user())
  WITH CHECK (hassalls.is_allowed_user());

DROP POLICY IF EXISTS cameras_select ON hassalls.cameras;
CREATE POLICY cameras_select ON hassalls.cameras
  FOR SELECT USING (hassalls.is_allowed_user());

DROP POLICY IF EXISTS cameras_write_dashboard ON hassalls.cameras;
CREATE POLICY cameras_write_dashboard ON hassalls.cameras
  FOR INSERT WITH CHECK (hassalls.is_allowed_user());

DROP POLICY IF EXISTS cameras_delete_dashboard ON hassalls.cameras;
CREATE POLICY cameras_delete_dashboard ON hassalls.cameras
  FOR DELETE USING (hassalls.is_allowed_user());

-- Status/last_seen heartbeat may also be updated by the owning site's
-- ingestion key (the Worker refreshes this on every accepted event), in
-- addition to normal dashboard editing.
DROP POLICY IF EXISTS cameras_update ON hassalls.cameras;
CREATE POLICY cameras_update ON hassalls.cameras
  FOR UPDATE USING (hassalls.is_allowed_user() OR site_id = hassalls.current_ingestion_site_id())
  WITH CHECK (hassalls.is_allowed_user() OR site_id = hassalls.current_ingestion_site_id());

DROP POLICY IF EXISTS vehicles_select ON hassalls.vehicles;
CREATE POLICY vehicles_select ON hassalls.vehicles
  FOR SELECT USING (hassalls.is_allowed_user());

-- Ingestion may create/refine a vehicle record for any valid site key —
-- vehicles aren't scoped to one site (the same car can be seen at House and
-- Storage Unit), so any recognised key is enough, not just a specific site.
DROP POLICY IF EXISTS vehicles_insert ON hassalls.vehicles;
CREATE POLICY vehicles_insert ON hassalls.vehicles
  FOR INSERT WITH CHECK (hassalls.is_allowed_user() OR hassalls.current_ingestion_site_id() IS NOT NULL);

DROP POLICY IF EXISTS vehicles_update ON hassalls.vehicles;
CREATE POLICY vehicles_update ON hassalls.vehicles
  FOR UPDATE USING (hassalls.is_allowed_user() OR hassalls.current_ingestion_site_id() IS NOT NULL)
  WITH CHECK (hassalls.is_allowed_user() OR hassalls.current_ingestion_site_id() IS NOT NULL);

DROP POLICY IF EXISTS vehicles_delete ON hassalls.vehicles;
CREATE POLICY vehicles_delete ON hassalls.vehicles
  FOR DELETE USING (hassalls.is_allowed_user());

DROP POLICY IF EXISTS known_vehicles_all ON hassalls.known_vehicles;
CREATE POLICY known_vehicles_all ON hassalls.known_vehicles
  FOR ALL USING (hassalls.is_allowed_user())
  WITH CHECK (hassalls.is_allowed_user());

DROP POLICY IF EXISTS events_select ON hassalls.events;
CREATE POLICY events_select ON hassalls.events
  FOR SELECT USING (hassalls.is_allowed_user());

-- Ingestion may only insert an event into the site its key belongs to.
-- Dashboard users may also log a manual event for any site they can see.
DROP POLICY IF EXISTS events_insert ON hassalls.events;
CREATE POLICY events_insert ON hassalls.events
  FOR INSERT WITH CHECK (
    hassalls.is_allowed_user()
    OR site_id = hassalls.current_ingestion_site_id()
  );

DROP POLICY IF EXISTS events_update ON hassalls.events;
CREATE POLICY events_update ON hassalls.events
  FOR UPDATE USING (hassalls.is_allowed_user())
  WITH CHECK (hassalls.is_allowed_user());

DROP POLICY IF EXISTS events_delete ON hassalls.events;
CREATE POLICY events_delete ON hassalls.events
  FOR DELETE USING (hassalls.is_allowed_user());

DROP POLICY IF EXISTS alerts_select ON hassalls.alerts;
CREATE POLICY alerts_select ON hassalls.alerts
  FOR SELECT USING (hassalls.is_allowed_user());

-- Ingestion inserts an alert only alongside an event it was itself allowed
-- to insert into (same site-key check, re-derived from the event row so the
-- Worker doesn't have to send site_id twice).
DROP POLICY IF EXISTS alerts_insert ON hassalls.alerts;
CREATE POLICY alerts_insert ON hassalls.alerts
  FOR INSERT WITH CHECK (
    hassalls.is_allowed_user()
    OR EXISTS (
      SELECT 1 FROM hassalls.events e
      WHERE e.id = alerts.event_id
        AND e.site_id = hassalls.current_ingestion_site_id()
    )
  );

-- Acknowledging an alert is a dashboard-only action.
DROP POLICY IF EXISTS alerts_update ON hassalls.alerts;
CREATE POLICY alerts_update ON hassalls.alerts
  FOR UPDATE USING (hassalls.is_allowed_user())
  WITH CHECK (hassalls.is_allowed_user());

DROP POLICY IF EXISTS alerts_delete ON hassalls.alerts;
CREATE POLICY alerts_delete ON hassalls.alerts
  FOR DELETE USING (hassalls.is_allowed_user());

-- ============================================================================
-- Grants — table-level privileges PostgREST needs before RLS gets a say.
-- `authenticated` gets full CRUD on everything (RLS narrows it to allowed
-- users); `anon` only gets the specific operations the ingestion Worker
-- performs, on the specific tables it touches.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.allowed_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.ingestion_keys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.sites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.cameras TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.known_vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON hassalls.alerts TO authenticated;

GRANT UPDATE ON hassalls.cameras TO anon;
GRANT INSERT, UPDATE ON hassalls.vehicles TO anon;
GRANT INSERT ON hassalls.events TO anon;
GRANT INSERT ON hassalls.alerts TO anon;

-- ----------------------------------------------------------------------------
-- Expose the schema to PostgREST. Supabase reads the accepted schema list
-- from the `authenticator` role's pgrst.db_schemas setting; smartrv and
-- smartfitsinstallationsltd are already there for the same reason.
-- ----------------------------------------------------------------------------
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, smartrv, smartfitsinstallationsltd, hassalls';

NOTIFY pgrst, 'reload config';
