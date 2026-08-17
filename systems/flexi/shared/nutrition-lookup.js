// Free food-nutrition auto-calculation, backed by USDA FoodData Central via
// a server-side proxy (functions/api/flexi/food-lookup.js) — keeps the API
// key server-side and gives us one place to swap/add a food-data provider
// later without touching every page that calculates nutrition.

export async function searchFood(query) {
  const res = await fetch("/api/flexi/food-lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Food lookup failed.");
  return data.foods || [];
}

// Converts a quantity to grams for scaling. Only weight units convert
// reliably without knowing the specific food (1oz is always 28.3495g,
// no matter what it's an ounce of) — volume units like ml/cup/tsp and
// count units like "piece"/"slice" don't, since a cup of rice and a cup
// of oil weigh completely different amounts, and food databases don't
// reliably expose that per-item. Returns null for units we can't convert.
const WEIGHT_UNIT_TO_GRAMS = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
export function toGrams(qty, unit) {
  const factor = WEIGHT_UNIT_TO_GRAMS[unit];
  return factor ? qty * factor : null;
}

// Scales a food's per-100g nutrition to a gram quantity.
export function scaleNutrition(per100g, grams) {
  const factor = (grams || 0) / 100;
  const round = v => (v == null ? null : Math.round(v * factor));
  return {
    calories: round(per100g.calories),
    protein_g: round(per100g.protein_g),
    carbs_g: round(per100g.carbs_g),
    fat_g: round(per100g.fat_g),
  };
}
