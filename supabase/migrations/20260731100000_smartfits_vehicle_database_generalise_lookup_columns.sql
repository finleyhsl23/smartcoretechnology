-- ============================================================================
-- Smartfits Vehicle Database — generalise registration-lookup columns
-- Originally named for the DVLA Vehicle Enquiry Service, but DVLA VES
-- registration turned out to be unavailable. The lookup source switched to
-- the DVSA MOT History API instead (which also returns model, unlike DVLA
-- VES) — renaming these columns so they read as "whichever registration
-- lookup response was last saved" rather than naming a specific provider.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.vdb_vehicles RENAME COLUMN dvla_raw TO lookup_raw;
ALTER TABLE smartfitsinstallationsltd.vdb_vehicles RENAME COLUMN dvla_looked_up_at TO lookup_looked_up_at;
