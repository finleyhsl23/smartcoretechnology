import { sb } from "./supabase.js";

// Best-effort audit trail — failures are swallowed so a logging hiccup never
// blocks the underlying action. Only Enterprise-tier businesses read this
// back (audit-log.html), but every tier writes to it.
export async function logAudit(companyId, actorEmployeeId, action, entityType, entityId, meta) {
  try {
    await sb().from("smartcore_flexi_audit_logs").insert({
      company_id: companyId,
      actor_employee_id: actorEmployeeId,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      meta: meta || null,
    });
  } catch (_) { /* non-fatal */ }
}
