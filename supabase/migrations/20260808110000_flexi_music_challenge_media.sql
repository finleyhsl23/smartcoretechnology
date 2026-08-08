-- Background music/video (per-company, played across trainer + client portal)
ALTER TABLE public.smartcore_flexi_settings ADD COLUMN IF NOT EXISTS background_media_url text;
ALTER TABLE public.smartcore_flexi_settings ADD COLUMN IF NOT EXISTS background_media_type text;

-- Challenges: optional required photo/video proof on each submission
ALTER TABLE public.smartcore_flexi_challenges ADD COLUMN IF NOT EXISTS requires_media boolean NOT NULL DEFAULT false;
ALTER TABLE public.smartcore_flexi_challenge_entries ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE public.smartcore_flexi_challenge_entries ADD COLUMN IF NOT EXISTS media_type text;
