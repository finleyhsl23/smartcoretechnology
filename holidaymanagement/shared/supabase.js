import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export const leaveSchema = 'smartfitsinstallationsltd';
