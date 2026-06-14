import { createClient } from '@supabase/supabase-js';

const SCHEMA = 'holidaymanagement';
const BANK_HOLIDAY_API = 'https://www.gov.uk/bank-holidays.json';

export async function onRequestPost({ request, env }) {
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response('Missing environment variables', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { company_id, region = 'england-and-wales' } = body;
  if (!company_id) return new Response('company_id required', { status: 400 });

  // Fetch UK bank holidays
  const bhRes = await fetch(BANK_HOLIDAY_API);
  if (!bhRes.ok) return new Response('Failed to fetch bank holidays', { status: 502 });

  const bhData = await bhRes.json();
  const regionData = bhData[region];
  if (!regionData) return new Response(`Unknown region: ${region}`, { status: 400 });

  const events = regionData.events || [];

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const db = supabase.schema(SCHEMA);

  // Get existing bank holidays for this company
  const { data: existing } = await db
    .from('company_holidays')
    .select('date')
    .eq('company_id', company_id)
    .eq('source', 'bank');

  const existingDates = new Set((existing || []).map(h => h.date));

  // Only insert ones we don't have
  const toInsert = events
    .filter(e => !existingDates.has(e.date))
    .map(e => ({
      company_id,
      date: e.date,
      name: e.title,
      source: 'bank',
      region
    }));

  if (toInsert.length === 0) {
    return Response.json({ success: true, added: 0, message: 'Already up to date' });
  }

  const { error } = await db.from('company_holidays').insert(toInsert);
  if (error) return new Response(error.message, { status: 500 });

  return Response.json({ success: true, added: toInsert.length });
}
