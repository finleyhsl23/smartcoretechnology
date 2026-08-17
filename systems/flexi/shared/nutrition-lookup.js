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

// Converts a quantity to grams for scaling. Weight units convert reliably
// without knowing the specific food (1oz is always 28.3495g, no matter
// what it's an ounce of). Volume units like ml/cup/tsp don't — a cup of
// rice and a cup of oil weigh completely different amounts, and food
// databases don't reliably expose that per-item, so those stay unsupported.
// "piece"/"slice" sit in between: there's no universal weight for "1
// piece", but a specific shop product (passed as `food`) often lists its
// own per-item weight (e.g. a tortilla wrap listing "1 wrap = 64g"), so
// use that when it's available. Returns null when the unit can't be
// converted for this food.
const WEIGHT_UNIT_TO_GRAMS = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
export function toGrams(qty, unit, food) {
  const factor = WEIGHT_UNIT_TO_GRAMS[unit];
  if (factor) return qty * factor;
  if ((unit === "piece" || unit === "slice") && food?.servingGrams) return qty * food.servingGrams;
  return null;
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
