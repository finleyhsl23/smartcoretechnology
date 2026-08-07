-- ============================================================================
-- Raise photo/logo upload size limits across the board.
-- Buckets already exist, so this updates their stored file_size_limit
-- directly rather than relying on "create if not exists" runtime code,
-- which is a no-op once a bucket is already present.
-- ============================================================================

-- Company logo (ID Cards designer): 2MB -> 15MB
UPDATE storage.buckets SET file_size_limit = 15728640 WHERE id = 'presence-fire-safety-logos';

-- Visitor/contractor sign-in photos (camera capture): 5MB -> 25MB
UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'presence-fire-safety-photos';

-- Employee profile photos (SmartCore Core avatars): 20MB -> 50MB
UPDATE storage.buckets SET file_size_limit = 52428800 WHERE id = 'employee-avatars';
