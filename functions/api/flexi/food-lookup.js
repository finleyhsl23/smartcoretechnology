// Free food-nutrition lookup, proxied server-side so the API key never
// reaches the browser. Backed by USDA FoodData Central (api.nal.usda.gov) —
// a US government database, free, no cost per call. Public endpoint: this
// is generic nutrition reference data with no client/company scoping, so
// there's nothing here to authorize against a session.
//
// Set USDA_FDC_API_KEY as a Cloudflare Pages environment variable for
// production use (free instant signup: https://fdc.nal.usda.gov/api-key-signup).
// Falls back to USDA's shared "DEMO_KEY", which works but is rate-limited
// (~30 requests/hour/IP) — fine for trying this out, not for real traffic.

import { json, handleOptions } from './_utils.js';

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// USDA nutrient IDs for the values Flexi tracks.
const NUTRIENT_IDS = {
  calories: 1008,
  protein_g: 1003,
  fat_g: 1004,
  carbs_g: 1005,
  fiber_g: 1079,
  sugar_g: 2000,
  sat_fat_g: 1258,
  sodium_mg: 1093,
};

function extractPer100g(food) {
  const byId = {};
  for (const n of food.foodNutrients || []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const value = n.value ?? n.amount;
    if (id != null && typeof value === 'number') byId[id] = value;
  }
  const per100g = {};
  for (const [key, id] of Object.entries(NUTRIENT_IDS)) {
    const v = byId[id];
    per100g[key] = typeof v === 'number' ? Math.round(v * 100) / 100 : null;
  }
  return per100g;
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const query = (body.query || '').trim();
  if (!query) return json({ error: 'Search query required.' }, 400);

  const apiKey = env.USDA_FDC_API_KEY || 'DEMO_KEY';
  // dataType is a repeated param, not a comma-joined one — USDA's API was
  // silently ignoring a single "Foundation,SR Legacy" value and searching
  // every data type (Branded/restaurant items included), which is how a
  // plain "grilled chicken" search surfaced a fast-food sandwich instead of
  // the generic ingredient. Foundation + SR Legacy are the two generic,
  // unbranded USDA datasets (a plain chicken breast, not a menu item).
  const params = new URLSearchParams();
  params.set('api_key', apiKey);
  params.set('query', query);
  params.set('pageSize', '10');
  params.append('dataType', 'Foundation');
  params.append('dataType', 'SR Legacy');
  const url = `${USDA_SEARCH_URL}?${params.toString()}`;

  let res;
  try {
    res = await fetch(url);
  } catch {
    return json({ error: 'Food database is unreachable right now — try again in a moment.' }, 502);
  }
  if (res.status === 429) {
    return json({ error: 'Food database rate limit reached — try again shortly, or add your own USDA_FDC_API_KEY for higher limits.' }, 429);
  }
  if (!res.ok) {
    return json({ error: `Food database error (${res.status}).` }, 502);
  }
  const data = await res.json().catch(() => ({}));

  const foods = (data.foods || [])
    .map(f => ({
      id: String(f.fdcId),
      name: f.description,
      brand: f.brandOwner || f.brandName || null,
      per100g: extractPer100g(f),
    }))
    .filter(f => f.per100g.calories != null);

  return json({ foods });
}
