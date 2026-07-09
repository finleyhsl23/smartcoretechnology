import { sb } from "/systems/crm/shared/supabase.js";
import { getProfile } from "/systems/crm/shared/auth.js";

export async function triggerCommand(tenantId, triggerType, { triggerValue, triggerField, ctx } = {}) {
  try {
    const { data: { session } } = await sb().auth.getSession();
    if (!session?.access_token) return;
    await fetch('/api/crm/commands-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        tenant_id: tenantId,
        trigger_type: triggerType,
        trigger_value: triggerValue,
        trigger_field: triggerField,
        ctx: ctx || {},
      }),
    });
  } catch (_) {}
}
