UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg','image/png','image/webp','image/heic','image/gif',
  'video/mp4','video/quicktime','video/webm','video/x-msvideo','video/x-matroska','video/mpeg','video/3gpp',
  'audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave','audio/ogg','audio/vorbis',
  'audio/aac','audio/mp4','audio/x-m4a','audio/flac','audio/x-flac','audio/webm'
]
WHERE id = 'flexi-media';
