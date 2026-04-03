import { supabase } from './supabase.js';

export async function signInWithPassword(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentProfile() {
  const session = await getSession();

  if (!session?.user?.id) {
    return null;
  }

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, role, company_id')
    .eq('id', session.user.id)
    .single();

  if (error) throw error;

  return data;
}
