// /app/shared/auth.js
import { supabaseClient } from "./supabase.js";

export async function requireAuth({ redirectTo = "/app/index.html" } = {}) {
  const sb = supabaseClient();
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  if (!data?.session) {
    window.location.href = redirectTo;
    throw new Error("No active session");
  }
  return data.session;
}

export async function getMyProfile() {
  const sb = supabaseClient();
  const session = await requireAuth();
  const userId = session.user.id;

  const { data, error } = await sb
    .from("user_profiles")
    .select("user_id, company_id, role, full_name, active")
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  if (!data?.active) throw new Error("Profile inactive / access disabled.");

  return data;
}

export async function logout({ redirectTo = "/app/index.html" } = {}) {
  const sb = supabaseClient();
  await sb.auth.signOut();
  window.location.href = redirectTo;
}

