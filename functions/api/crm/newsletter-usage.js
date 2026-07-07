const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const MONTHLY_LIMITS = { professional: 50, business: 250, enterprise: 500 };

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });
  const { id: authUserId } = await userRes.json();

  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${authUserId}&select=company_id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [emp] = await empRes.json();
  if (!emp) return new Response(JSON.stringify({ error: 'Employee not found' }), { status: 403, headers: CORS });
  const tenantId = emp.company_id;

  const modRes = await fetch(`${SUPABASE_URL}/rest/v1/company_modules?company_id=eq.${encodeURIComponent(tenantId)}&module_key=eq.smartcore-crm&select=tier&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [mod] = await modRes.json();
  const tier = mod?.tier || 'lite';
  const limit = MONTHLY_LIMITS[tier] ?? 0;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const usageRes = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_newsletter_usage?tenant_id=eq.${encodeURIComponent(tenantId)}&month=eq.${currentMonth}&select=sent_count&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const [usageRow] = await usageRes.json();
  const used = usageRow?.sent_count || 0;

  return new Response(JSON.stringify({ limit, used, remaining: Math.max(0, limit - used), tier, month: currentMonth }), { status: 200, headers: CORS });
}
