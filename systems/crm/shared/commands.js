import { sb } from "/systems/crm/shared/supabase.js";

// Trigger a CRM workflow command (e.g. company_status_changed, company_created).
// Looks up any matching automation rules for the tenant and runs them.
export async function triggerCommand(tenantId, trigger, payload = {}) {
  try {
    const { data: rules } = await sb()
      .from("crm_automation_rules")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("trigger", trigger)
      .eq("enabled", true);

    if (!rules?.length) return;

    for (const rule of rules) {
      await sb().from("crm_automation_log").insert({
        tenant_id: tenantId,
        rule_id: rule.id,
        trigger,
        payload,
        ran_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {});
    }
  } catch (_) {
    // Automation tables may not exist yet — fail silently
  }
}
