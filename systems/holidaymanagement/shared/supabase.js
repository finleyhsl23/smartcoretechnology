
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from './config.js';
export const leaveSchema = CONFIG.schema;
export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true} });
