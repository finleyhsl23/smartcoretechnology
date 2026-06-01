export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const year = Number(body.year || new Date().getFullYear());
    const region = body.region || 'england-and-wales';
    const allowed = new Set(['england-and-wales', 'scotland', 'northern-ireland']);
    if (!allowed.has(region)) return json({ error: 'Invalid bank holiday region.' }, 400);
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return json({ error: 'Missing Supabase service configuration.' }, 500);

    const gov = await fetch('https://www.gov.uk/bank-holidays.json');
    if (!gov.ok) return json({ error: 'Could not fetch GOV.UK bank holidays.' }, 502);
    const data = await gov.json();
    const events = (data[region]?.events || [])
      .filter(e => String(e.date || '').startsWith(String(year)))
      .map(e => ({ region, holiday_date: e.date, name: e.title }));

    if (!events.length) return json({ imported: 0 });

    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/bank_holidays?on_conflict=region,holiday_date,name`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
        'Content-Profile': 'holidaymanagement'
      },
      body: JSON.stringify(events)
    });
    if (!response.ok) return json({ error: await response.text() }, 500);
    return json({ imported: events.length });
  } catch (error) {
    return json({ error: error.message || 'Import failed.' }, 500);
  }
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
