// /app/shared/guard.js
import { supabaseClient } from "./supabase.js";
import { getMyProfile } from "./auth.js";

export async function requireModuleAccess(moduleKey) {
  const sb = supabaseClient();
  const profile = await getMyProfile();

  const { data, error } = await sb
    .from("company_modules")
    .select("enabled")
    .eq("company_id", profile.company_id)
    .eq("module_key", moduleKey)
    .single();

  if (error) throw error;
  if (!data?.enabled) throw new Error("MODULE_NOT_ENABLED");

  return profile;
}

export function isEvacRole(role) {
  return ["fire_marshal", "hr_admin", "company_admin"].includes(role);
}

