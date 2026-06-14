const SCHEMA = 'holidaymanagement';
const BANK_HOLIDAY_API = 'https://www.gov.uk/bank-holidays.json';

function db(supabaseUrl, serviceKey) {
  const base = `${supabaseUrl}/rest/v1`;
  const h = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Accept-Profile': SCHEMA,
    'Content-Profile': SCHEMA,
    'Prefer': 'return=representation'
  };

  return {
    async select(table, query = '') {
      const res = await fetch(`${base}/${table}?${query}`, { headers: h });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return JSON.parse(text);
    },
    async insert(table, data) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST', headers: h,
        body: JSON.stringify(Array.isArray(data) ? data : [data])
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return text ? JSON.parse(text) : [];
    }
  };
}

export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return new Response('Missing environment variables', { status: 500 });

  let body;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { company_id, region = 'england-and-wales' } = body;
  if (!company_id) return new Response('company_id required', { status: 400 });

  const bhRes = await fetch(BANK_HOLIDAY_API);
  if (!bhRes.ok) return new Response('Failed to fetch bank holidays', { status: 502 });

  const bhData = await bhRes.json();
  const regionData = bhData[region];
  if (!regionData) return new Response(`Unknown region: ${region}`, { status: 400 });

  const client = db(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const existing = await client.select(
    'company_holidays',
    `company_id=eq.${company_id}&source=eq.bank&select=date`
  );
  const existingDates = new Set((existing || []).map(h => h.date));

  const toInsert = (regionData.events || [])
    .filter(e => !existingDates.has(e.date))
    .map(e => ({ company_id, date: e.date, name: e.title, source: 'bank', region }));

  if (!toInsert.length) {
    return Response.json({ success: true, added: 0, message: 'Already up to date' });
  }

  await client.insert('company_holidays', toInsert);
  return Response.json({ success: true, added: toInsert.length });
}
