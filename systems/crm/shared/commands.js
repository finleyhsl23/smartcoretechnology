import { sb } from './supabase.js';

// Fire matching commands for a CRM event. Fire-and-forget — never throws.
export async function triggerCommand(tenantId, triggerType, { triggerValue = null, triggerField = null, ctx = {} } = {}) {
  try {
    const { data: { session } } = await sb().auth.getSession();
    if (!session?.access_token) { console.warn('[commands] No session token'); return; }
    const res = await fetch('/api/crm/commands-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ tenant_id: tenantId, trigger_type: triggerType, trigger_value: triggerValue, trigger_field: triggerField, ctx }),
    });
    const json = await res.json().catch(() => ({}));
    console.log('[commands] result:', res.status, json);
  } catch (e) { console.warn('[commands] error:', e.message); }
}
