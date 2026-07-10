import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const AUTH_OPTS = { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true };

// Plain client for auth operations — same pattern as /modules/
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: AUTH_OPTS });

// Schema-aware client for holidaymanagement table queries
export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: AUTH_OPTS,
  db: { schema: 'holidaymanagement' }
});

export const leaveSchema = 'holidaymanagement';
