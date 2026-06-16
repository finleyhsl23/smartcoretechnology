const SCHEMA = 'holidaymanagement';
const NAGER_API = 'https://date.nager.at/api/v3/PublicHolidays';

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

  const { company_id, country_codes = ['GB'] } = body;
  if (!company_id) return new Response('company_id required', { status: 400 });

  const client = db(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const existing = await client.select(
    'company_holidays',
    `company_id=eq.${company_id}&type=eq.bank&select=holiday_date`
  );
  const existingDates = new Set((existing || []).map(h => h.holiday_date));

  const toInsert = [];
  const year = new Date().getFullYear();
  const years = [year, year + 1];
  const multiCountry = country_codes.length > 1;

  for (const countryCode of country_codes) {
    for (const y of years) {
      try {
        const res = await fetch(`${NAGER_API}/${y}/${countryCode}`);
        if (!res.ok) continue;
        const holidays = await res.json();
        for (const holiday of (holidays || [])) {
          const key = `${holiday.date}|${countryCode}`;
          if (!existingDates.has(holiday.date)) {
            toInsert.push({
              company_id,
              holiday_date: holiday.date,
              name: multiCountry
                ? `${holiday.localName || holiday.name} (${countryCode})`
                : (holiday.localName || holiday.name),
              type: 'bank'
            });
            existingDates.add(holiday.date);
          }
        }
      } catch { /* skip failed country/year */ }
    }
  }

  if (!toInsert.length) {
    return Response.json({ success: true, added: 0, message: 'Already up to date' });
  }

  await client.insert('company_holidays', toInsert);
  return Response.json({ success: true, added: toInsert.length });
}
