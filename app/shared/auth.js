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
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    throw new Error(
      "No user profile found. This user must have a row in public.user_profiles with company_id and role."
    );
  }

  if (data.active !== true) {
    throw new Error("Profile inactive / access disabled.");
  }

  return data;
}

export async function logout({ redirectTo = "/app/index.html" } = {}) {
  const sb = supabaseClient();
  await sb.auth.signOut();
  window.location.href = redirectTo;
}
