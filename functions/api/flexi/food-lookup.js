// Free food-nutrition lookup, proxied server-side so no API key reaches the
// browser. Combines two free, no-cost sources so results cover both plain
// ingredients and real supermarket/branded products:
//
//  - USDA FoodData Central (api.nal.usda.gov), Foundation + SR Legacy data
//    only — generic, unbranded foods ("chicken breast", not a menu item).
//    Set USDA_FDC_API_KEY as a Cloudflare Pages env var for production use
//    (free instant signup: https://fdc.nal.usda.gov/api-key-signup). Falls
//    back to USDA's shared "DEMO_KEY", which works but is rate-limited
//    (~30 requests/hour/IP) — fine for trying this out, not for real traffic.
//  - Open Food Facts (world.openfoodfacts.org) — a free, crowdsourced,
//    global product database with strong UK/EU shop-product coverage
//    (USDA's own "Branded" data type is almost entirely US brands and
//    doesn't help UK users). No API key needed. Used live, per search,
//    never stored/merged into our own database — Open Food Facts' ODbL
//    licence requires attribution for its data, which the client-side UI
//    shows against each branded result.
//
// Generic results are returned first, branded/shop ones after, so plain
// ingredients still win a search like "chicken breast" while something
// like "Warburtons toastie" still turns up a real product.

import { json, handleOptions } from './_utils.js';

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

// USDA nutrient IDs for the values Flexi tracks.
const USDA_NUTRIENT_IDS = {
  calories: 1008,
  protein_g: 1003,
  fat_g: 1004,
  carbs_g: 1005,
  fiber_g: 1079,
  sugar_g: 2000,
  sat_fat_g: 1258,
  sodium_mg: 1093,
};

function round2(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? Math.round(v * 100) / 100 : null;
}

function extractUsdaPer100g(food) {
  const byId = {};
  for (const n of food.foodNutrients || []) {
    const id = n.nutrientId ?? n.nutrient?.id;
    const value = n.value ?? n.amount;
    if (id != null && typeof value === 'number') byId[id] = value;
  }
  const per100g = {};
  for (const [key, id] of Object.entries(USDA_NUTRIENT_IDS)) per100g[key] = round2(byId[id]);
  return per100g;
}

async function searchUsda(env, query) {
  const apiKey = env.USDA_FDC_API_KEY || 'DEMO_KEY';
  // dataType is a repeated param, not a comma-joined one — a single
  // "Foundation,SR Legacy" value gets silently ignored by USDA's API,
  // which then searches every data type (Branded/restaurant items
  // included) instead of just these two generic, unbranded datasets.
  const params = new URLSearchParams();
  params.set('api_key', apiKey);
  params.set('query', query);
  params.set('pageSize', '8');
  params.append('dataType', 'Foundation');
  params.append('dataType', 'SR Legacy');

  const res = await fetch(`${USDA_SEARCH_URL}?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.foods || [])
    .map(f => ({
      id: `usda:${f.fdcId}`,
      name: f.description,
      brand: null,
      source: 'generic',
      per100g: extractUsdaPer100g(f),
    }))
    .filter(f => f.per100g.calories != null);
}

async function searchOpenFoodFacts(query) {
  const params = new URLSearchParams({
    search_terms: query, search_simple: '1', action: 'process', json: '1', page_size: '8',
  });
  const res = await fetch(`${OFF_SEARCH_URL}?${params.toString()}`, {
    headers: { 'User-Agent': 'SmartCoreFlexi/1.0 (support@smartcoretechnology.co.uk)' },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return (data.products || [])
    .filter(p => p.product_name && p.nutriments)
    .map(p => ({
      id: `off:${p.code || p._id || p.product_name}`,
      name: p.product_name,
      brand: p.brands ? p.brands.split(',')[0].trim() : null,
      source: 'branded',
      per100g: {
        calories: round2(p.nutriments['energy-kcal_100g']),
        protein_g: round2(p.nutriments['proteins_100g']),
        fat_g: round2(p.nutriments['fat_100g']),
        carbs_g: round2(p.nutriments['carbohydrates_100g']),
        fiber_g: round2(p.nutriments['fiber_100g']),
        sugar_g: round2(p.nutriments['sugars_100g']),
        sat_fat_g: round2(p.nutriments['saturated-fat_100g']),
        sodium_mg: p.nutriments['sodium_100g'] != null ? round2(p.nutriments['sodium_100g'] * 1000) : null,
      },
    }))
    .filter(f => f.per100g.calories != null);
}

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const query = (body.query || '').trim();
  if (!query) return json({ error: 'Search query required.' }, 400);

  const [generic, branded] = await Promise.all([
    searchUsda(env, query).catch(() => []),
    searchOpenFoodFacts(query).catch(() => []),
  ]);

  return json({ foods: [...generic, ...branded].slice(0, 16) });
}
