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
