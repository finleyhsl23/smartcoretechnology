-- ============================================================================
-- Hassalls — vehicle sighting upsert RPC
--
-- The ingestion Worker authenticates with the anon key only (no service-role
-- key), so it cannot be granted table-level SELECT on hassalls.vehicles —
-- even though RLS would still hide the rows from anon, PostgREST needs
-- SELECT to satisfy `Prefer: return=representation`, and there is no
-- legitimate reason for the anon role to ever read the vehicle registry back.
-- Comparing "is this read more confident than what's stored" therefore can't
-- happen as a plain read-then-write from the Worker. Instead the Worker
-- calls this single SECURITY DEFINER RPC, which does the compare-and-merge
-- server-side and returns nothing. Direct anon INSERT/UPDATE on the table
-- (granted in the foundation migration) is revoked below now that this
-- exists — it was the wrong shape for "refine only if higher confidence".
-- ============================================================================

CREATE OR REPLACE FUNCTION hassalls.ingest_vehicle_sighting(
  p_plate       text,
  p_make_model  text DEFAULT NULL,
  p_colour      text DEFAULT NULL,
  p_confidence  text DEFAULT 'low',
  p_seen_at     timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hassalls, pg_temp
AS $$
DECLARE
  v_rank_new int := CASE p_confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END;
BEGIN
  IF NOT (hassalls.current_ingestion_site_id() IS NOT NULL OR hassalls.is_allowed_user()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_plate IS NULL OR btrim(p_plate) = '' THEN
    RAISE EXCEPTION 'plate required';
  END IF;

  IF p_confidence NOT IN ('low', 'medium', 'high') THEN
    RAISE EXCEPTION 'invalid confidence';
  END IF;

  INSERT INTO hassalls.vehicles (plate, make_model, colour, confidence, first_seen, last_seen, times_seen)
  VALUES (p_plate, p_make_model, p_colour, p_confidence, p_seen_at, p_seen_at, 1)
  ON CONFLICT (plate_norm) DO UPDATE SET
    last_seen  = GREATEST(hassalls.vehicles.last_seen, EXCLUDED.last_seen),
    times_seen = hassalls.vehicles.times_seen + 1,
    make_model = CASE
                   WHEN EXCLUDED.make_model IS NOT NULL
                    AND v_rank_new >= (CASE hassalls.vehicles.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
                   THEN EXCLUDED.make_model
                   ELSE hassalls.vehicles.make_model
                 END,
    colour     = CASE
                   WHEN EXCLUDED.colour IS NOT NULL
                    AND v_rank_new >= (CASE hassalls.vehicles.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
                   THEN EXCLUDED.colour
                   ELSE hassalls.vehicles.colour
                 END,
    confidence = CASE
                   WHEN v_rank_new > (CASE hassalls.vehicles.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END)
                   THEN p_confidence
                   ELSE hassalls.vehicles.confidence
                 END;
END;
$$;

REVOKE INSERT, UPDATE ON hassalls.vehicles FROM anon;
