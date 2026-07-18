ALTER TABLE smartfitsinstallationsltd.audit_settings
  ADD COLUMN IF NOT EXISTS leaderboard_enabled boolean NOT NULL DEFAULT true;
