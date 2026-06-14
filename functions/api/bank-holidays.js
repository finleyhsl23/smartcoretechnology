/**
 * POST /api/bank-holidays
 *
 * Fetches UK bank holidays from the UK Government API and imports them
 * into the company_holidays table for the specified year.
 *
 * Body: { company_id, region, year }
 * Regions: "england-and-wales" | "scotland" | "northern-ireland"
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY in env
 */

const SCHEMA       = 'holidaymanagement';
const GOV_BH_URL   = 'https://www.gov.uk/bank-holidays.json';
const VALID_REGIONS = ['england-and-wales', 'scotland', 'northern-ireland'];

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };

  try {
    // Auth
    const authHeader = request.headers.get('Authorization') || '';
    const token      = authHeader.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Unauthorised' }, 401, corsHeaders);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey:        env.SUPABASE_SERVICE_KEY,
      },
    });
    if (!userRes.ok) return json({ error: 'Unauthorised' }, 401, corsHeaders);
    const caller = await userRes.json();

    const body = await request.json();
    const { company_id, region, year } = body;

    if (!company_id) return json({ error: 'company_id is required' }, 400, corsHeaders);

    const regionKey = (region || 'england-and-wales').toLowerCase();
    if (!VALID_REGIONS.includes(regionKey)) {
      return json({ error: `Invalid region. Must be one of: ${VALID_REGIONS.join(', ')}` }, 400, corsHeaders);
    }

    const targetYear = parseInt(year) || new Date().getFullYear();

    // Verify caller is admin/owner of this company
    const membership = await supabaseGet(env,
      `/${SCHEMA}/company_users?user_id=eq.${caller.id}&company_id=eq.${company_id}&select=role&limit=1`
    );
    if (!membership?.length || !['admin','owner'].includes(membership[0].role)) {
      return json({ error: 'Forbidden — admin or owner access required' }, 403, corsHeaders);
    }

    // Fetch bank holidays from UK Gov API
    const govRes = await fetch(GOV_BH_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!govRes.ok) {
      return json({ error: 'Failed to fetch UK Government bank holiday data' }, 502, corsHeaders);
    }
    const govData = await govRes.json();

    const regionData = govData[regionKey];
    if (!regionData?.events) {
      return json({ error: `No events found for region: ${regionKey}` }, 404, corsHeaders);
    }

    // Filter to the requested year
    const eventsForYear = regionData.events.filter(e => {
      const eventYear = new Date(e.date).getFullYear();
      return eventYear === targetYear;
    });

    if (!eventsForYear.length) {
      return json({ imported: 0, skipped: 0, message: `No bank holidays found for ${regionKey} in ${targetYear}` }, 200, corsHeaders);
    }

    // Get existing company holidays for this year to avoid duplicates
    const startDate = `${targetYear}-01-01`;
    const endDate   = `${targetYear}-12-31`;
    const existing  = await supabaseGet(env,
      `/${SCHEMA}/company_holidays?company_id=eq.${company_id}&holiday_date=gte.${startDate}&holiday_date=lte.${endDate}&type=eq.bank&select=holiday_date`
    );
    const existingDates = new Set((existing || []).map(r => r.holiday_date));

    // Build rows to insert (skip duplicates)
    const toInsert = eventsForYear
      .filter(e => !existingDates.has(e.date))
      .map(e => ({
        company_id,
        holiday_date: e.date,
        name:         e.title,
        type:         'bank',
        source:       'gov_uk',
        region:       regionKey,
        created_at:   new Date().toISOString(),
      }));

    const skipped = eventsForYear.length - toInsert.length;

    if (toInsert.length > 0) {
      await supabasePost(env, `/${SCHEMA}/company_holidays`, toInsert);
    }

    return json({
      imported: toInsert.length,
      skipped,
      total:    eventsForYear.length,
      year:     targetYear,
      region:   regionKey,
    }, 200, corsHeaders);

  } catch (err) {
    console.error('bank-holidays error:', err);
    return json({ error: err.message || 'Internal error' }, 500, corsHeaders);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function supabaseGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey:           env.SUPABASE_SERVICE_KEY,
      Authorization:    `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Accept-Profile': SCHEMA,
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB error: ${t}`); }
  return res.json();
}

async function supabasePost(env, path, body) {
  const payload = Array.isArray(body) ? body : [body];
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method:  'POST',
    headers: {
      apikey:           env.SUPABASE_SERVICE_KEY,
      Authorization:    `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Profile': SCHEMA,
      'Content-Type':   'application/json',
      Prefer:           'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB insert error: ${t}`); }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
