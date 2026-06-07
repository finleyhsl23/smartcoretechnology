import { jsonResponse, handleOptions, supabaseRequest } from '../_utils.js';

const REGION_MAP = {
  'england-and-wales': 'england-and-wales',
  england: 'england-and-wales',
  wales: 'england-and-wales',
  scotland: 'scotland',
  'northern-ireland': 'northern-ireland',
  northern_ireland: 'northern-ireland'
};

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedRegion = body.region || 'england-and-wales';
    const region = REGION_MAP[requestedRegion] || requestedRegion;

    const response = await fetch('https://www.gov.uk/bank-holidays.json', {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) throw new Error('Could not fetch GOV.UK bank holidays.');

    const gov = await response.json();
    const division = gov[region];
    if (!division?.events?.length) return jsonResponse({ error: `No GOV.UK holidays found for region ${region}.` }, 404);

    const rows = division.events.map((event) => ({
      region,
      holiday_date: event.date,
      name: event.title
    }));

    await supabaseRequest(env, 'holidaymanagement.bank_holidays', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(rows)
    });

    return jsonResponse({ ok: true, region, imported: rows.length });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to import bank holidays.', details: error.details || null }, 500);
  }
}
