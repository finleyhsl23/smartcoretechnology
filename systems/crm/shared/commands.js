import { sb, SUPABASE_URL } from './supabase.js';

// Fire matching commands for a CRM event. Fire-and-forget — never throws.
export async function triggerCommand(tenantId, triggerType, { triggerValue = null, triggerField = null, ctx = {} } = {}) {
  try {
    const { data: { session } } = await sb().auth.getSession();
    if (!session?.access_token) return;
    fetch('/api/crm/commands-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ tenant_id: tenantId, trigger_type: triggerType, trigger_value: triggerValue, trigger_field: triggerField, ctx }),
    }).catch(() => {});
  } catch (_) {}
}
