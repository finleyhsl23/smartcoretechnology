ALTER TABLE public.smartcore_flexi_settings ADD COLUMN IF NOT EXISTS background_tracks jsonb NOT NULL DEFAULT '[]';

UPDATE public.smartcore_flexi_settings
SET background_tracks = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'name', 'Track 1',
    'url', background_media_url,
    'type', COALESCE(background_media_type, 'audio')
  )
)
WHERE background_media_url IS NOT NULL AND background_tracks = '[]';

ALTER TABLE public.smartcore_flexi_settings DROP COLUMN IF EXISTS background_media_url;
ALTER TABLE public.smartcore_flexi_settings DROP COLUMN IF EXISTS background_media_type;
