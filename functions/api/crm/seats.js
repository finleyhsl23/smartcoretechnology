// POST /api/crm/seats
// Auth: Bearer <supabase access token>
// Actions: list, grant, revoke, check

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const TIER_LIMITS = { lite: 2, professional: 10, business: 25, enterprise: 50 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }});
}

export async function onRequestPost({ request, env }) {
  try {
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Unauthorized' }, 401);

    // Verify caller and get their profile
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return json({ error: 'Unauthorized' }, 401);
    const authUser = await userRes.json();
    if (!authUser?.id) return json({ error: 'Unauthorized' }, 401);

    const svcHdr = {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Get caller's employee profile
    const empRes = await fetch(
      `${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${authUser.id}&select=id,company_id,role&limit=1`,
      { headers: svcHdr }
    );
    const [caller] = await empRes.json();
    if (!caller) return json({ error: 'Employee profile not found' }, 403);

    // Get company's CRM module tier
    const modRes = await fetch(
      `${SUPABASE_URL}/rest/v1/company_modules?company_id=eq.${caller.company_id}&module_key=eq.smartcore-crm&select=tier&limit=1`,
      { headers: svcHdr }
    );
    const [mod] = await modRes.json();
    const tier = mod?.tier || 'lite';
    const seatLimit = TIER_LIMITS[tier] || 2;

    const body = await request.json();
    const { action } = body;

    // ── List seats ─────────────────────────────────────────────────────────
    if (action === 'list') {
      const seatsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_user_seats?company_id=eq.${caller.company_id}&select=id,employee_id,granted_at`,
        { headers: svcHdr }
      );
      const seats = await seatsRes.json();

      // Fetch all employees for this company
      const empsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/core_employees?company_id=eq.${caller.company_id}&select=id,full_name,work_email,role&order=full_name`,
        { headers: svcHdr }
      );
      const employees = await empsRes.json();

      const seatEmployeeIds = new Set((seats || []).map(s => s.employee_id));

      return json({
        tier,
        seat_limit: seatLimit,
        seats_used: seats?.length || 0,
        seats,
        employees: (employees || []).map(e => ({
          ...e,
          has_seat: seatEmployeeIds.has(e.id),
        })),
      });
    }

    // ── Grant seat ─────────────────────────────────────────────────────────
    if (action === 'grant') {
      if (caller.role !== 'owner' && caller.role !== 'admin') return json({ error: 'Only owners and admins can manage seats' }, 403);

      const { employee_id } = body;
      if (!employee_id) return json({ error: 'employee_id required' }, 400);

      // Verify employee belongs to same company
      const targetRes = await fetch(
        `${SUPABASE_URL}/rest/v1/core_employees?id=eq.${employee_id}&company_id=eq.${caller.company_id}&select=id,role&limit=1`,
        { headers: svcHdr }
      );
      const [target] = await targetRes.json();
      if (!target) return json({ error: 'Employee not found' }, 404);

      // Count current seats (owners always have access, don't count against limit)
      const countRes = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_user_seats?company_id=eq.${caller.company_id}&select=id`,
        { headers: svcHdr }
      );
      const currentSeats = await countRes.json();
      if ((currentSeats?.length || 0) >= seatLimit) {
        return json({ error: `Seat limit reached (${seatLimit} seats on ${tier} plan). Upgrade to add more users.` }, 400);
      }

      await fetch(`${SUPABASE_URL}/rest/v1/crm_user_seats`, {
        method: 'POST',
        headers: { ...svcHdr, Prefer: 'return=minimal,resolution=ignore-duplicates' },
        body: JSON.stringify({ company_id: caller.company_id, employee_id, granted_by: caller.id }),
      });

      return json({ success: true });
    }

    // ── Revoke seat ────────────────────────────────────────────────────────
    if (action === 'revoke') {
      if (caller.role !== 'owner' && caller.role !== 'admin') return json({ error: 'Only owners and admins can manage seats' }, 403);

      const { employee_id } = body;
      if (!employee_id) return json({ error: 'employee_id required' }, 400);

      // Can't revoke owner's seat
      const targetRes = await fetch(
        `${SUPABASE_URL}/rest/v1/core_employees?id=eq.${employee_id}&company_id=eq.${caller.company_id}&select=role&limit=1`,
        { headers: svcHdr }
      );
      const [target] = await targetRes.json();
      if (target?.role === 'owner') return json({ error: "Cannot revoke the owner's CRM access" }, 400);

      await fetch(
        `${SUPABASE_URL}/rest/v1/crm_user_seats?company_id=eq.${caller.company_id}&employee_id=eq.${employee_id}`,
        { method: 'DELETE', headers: svcHdr }
      );

      return json({ success: true });
    }

    // ── Check (used by auth.js) ────────────────────────────────────────────
    if (action === 'check') {
      const { employee_id } = body;
      const seatRes = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_user_seats?company_id=eq.${caller.company_id}&employee_id=eq.${employee_id}&select=id&limit=1`,
        { headers: svcHdr }
      );
      const [seat] = await seatRes.json();
      return json({ has_seat: !!seat, tier, seat_limit: seatLimit });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
