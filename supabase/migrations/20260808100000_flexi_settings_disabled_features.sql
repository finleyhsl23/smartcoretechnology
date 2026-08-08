ALTER TABLE smartcore_flexi_settings ADD COLUMN IF NOT EXISTS disabled_features text[] NOT NULL DEFAULT '{}';
