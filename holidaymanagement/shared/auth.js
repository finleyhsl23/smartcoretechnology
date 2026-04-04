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
    .from('user_profiles')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('active', true)
    .single();

  if (error) throw error;

  return {
    ...data,
    id: data.user_id,
    full_name:
      data.full_name ||
      session.user.user_metadata?.full_name ||
      session.user.user_metadata?.name ||
      session.user.email,
    email: session.user.email
  };
}
