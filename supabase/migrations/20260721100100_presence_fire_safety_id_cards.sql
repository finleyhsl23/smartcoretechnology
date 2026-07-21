-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 15: ID Card templates
-- The old "Badges" settings panel becomes "ID Cards": a company-wide,
-- fully customisable ID card template (orientation, background/accent
-- shapes, border, photo shape, which fields show, and the back-of-card
-- design), plus a company logo. One template per company, so it lives on
-- the existing 1-row-per-company settings table rather than a new table.
-- The QR badge issue/revoke feature (presence_fire_safety_badges) is
-- unchanged — its token now also renders on the back of the printed card.
-- ============================================================================

ALTER TABLE public.presence_fire_safety_settings
  ADD COLUMN IF NOT EXISTS id_card_template jsonb NOT NULL DEFAULT '{
    "orientation": "landscape",
    "background": { "color": "#101828" },
    "shapes": [
      { "type": "circle", "color": "#1e5cff", "corner": "top-right", "size": "lg", "opacity": 0.25 },
      { "type": "rect",   "color": "#5b8dff", "corner": "bottom-left", "size": "md", "opacity": 0.18 }
    ],
    "border": { "enabled": true, "color": "#1e5cff", "width": 3 },
    "cornerRadius": 16,
    "photo": { "shape": "circle", "size": "md", "position": "left", "borderColor": "#ffffff", "borderWidth": 3 },
    "logo": { "position": "top-left", "size": "sm" },
    "fields": {
      "name":         { "show": true, "fontSize": 16, "color": "#ffffff", "bold": true },
      "jobTitle":     { "show": true, "fontSize": 12, "color": "#c7d2e0" },
      "employeeCode": { "show": true, "fontSize": 11, "color": "#8fa0bd" }
    },
    "back": {
      "background": { "color": "#ffffff" },
      "qr": { "show": true, "size": "md" },
      "text": "If found, please return to reception."
    }
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS id_card_logo_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'presence-fire-safety-logos',
  'presence-fire-safety-logos',
  true,
  2097152,
  ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS pfs_logos_insert ON storage.objects;
DROP POLICY IF EXISTS pfs_logos_update ON storage.objects;
DROP POLICY IF EXISTS pfs_logos_delete ON storage.objects;

CREATE POLICY pfs_logos_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'presence-fire-safety-logos'
    AND public.presence_fire_safety_has_permission((split_part(name, '/', 1))::uuid, 'presence.manage_badges')
  );

CREATE POLICY pfs_logos_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'presence-fire-safety-logos'
    AND public.presence_fire_safety_has_permission((split_part(name, '/', 1))::uuid, 'presence.manage_badges')
  );

CREATE POLICY pfs_logos_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'presence-fire-safety-logos'
    AND public.presence_fire_safety_has_permission((split_part(name, '/', 1))::uuid, 'presence.manage_badges')
  );
