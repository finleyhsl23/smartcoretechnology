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
// Results are ranked, not just concatenated: name-relevance to the search
// dominates the score, calorie density is a secondary "healthier first"
// tiebreaker, and a long branded name gets a "composite dish" penalty —
// see rankScore() below for why "flame grilled chicken" outranks
// "McDonald's Bacon Ranch Salad with Grilled Chicken" for a "grilled
// chicken" search even though both technically match.

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

function words(str) {
  return (str || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

// How much of the food's name matches the search, 0–1.15: full coverage of
// the query's words, plus a small bonus for actually starting with it (so
// "Chicken breast" beats "Breaded chicken breast" for a "chicken breast"
// search, not just tie with it).
function relevanceScore(name, query) {
  const queryWords = words(query);
  if (!queryWords.length) return 0;
  const nameWords = new Set(words(name));
  const matched = queryWords.filter(w => nameWords.has(w)).length;
  const coverage = matched / queryWords.length;
  const startsWithBonus = name.toLowerCase().startsWith(query.toLowerCase()) ? 0.15 : 0;
  return coverage + startsWithBonus;
}

// Calories/100g as a simple, explainable "healthier first" proxy — not a
// clinical score, just a reasonable inverse weighting so a leaner option
// edges out a fattier one among otherwise similar matches.
function healthScore(per100g) {
  const cal = per100g.calories ?? 250;
  return 1 - Math.min(1, cal / 600);
}

// How many words in the name aren't part of the query match — i.e. how
// much *else* is going on in this result besides what was searched for.
// Only weighted heavily for branded/restaurant items: a long name there
// usually means several foods bundled into one product or menu item (a
// salad with bacon, ranch dressing *and* chicken). USDA's own generic
// entries are always written in a verbose, qualifier-heavy style even for
// a single plain food (e.g. "Chicken, broilers or fryers, breast, meat
// only, cooked, grilled"), so the same penalty barely touches those.
function compositeDishPenalty(name, query, source) {
  const nameWords = words(name);
  const queryWords = new Set(words(query));
  const matched = nameWords.filter(w => queryWords.has(w)).length;
  const extraWords = Math.max(0, nameWords.length - matched);
  return extraWords * (source === 'branded' ? 0.06 : 0.01);
}

function rankScore(food, query) {
  const relevance = relevanceScore(food.name, query);
  const health = healthScore(food.per100g);
  const penalty = compositeDishPenalty(food.name, query, food.source);
  // USDA's generic entries are, by construction, always a single plain
  // food — never a multi-item product or menu combo — so a small flat
  // edge for them is a more reliable "prefer the simple option" signal
  // than word-counting alone (a short branded name like "Grilled Chicken
  // Caesar Wrap" can otherwise still out-rank the correct plain result).
  const genericBonus = food.source === 'generic' ? 0.1 : 0;
  return relevance * 0.65 + health * 0.2 - penalty + genericBonus;
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

  const foods = [...generic, ...branded]
    .sort((a, b) => rankScore(b, query) - rankScore(a, query))
    .slice(0, 16);

  return json({ foods });
}
