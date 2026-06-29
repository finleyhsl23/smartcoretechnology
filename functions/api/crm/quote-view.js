// GET /api/crm/quote-view?token=X
// Public endpoint — no auth required

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return Response.json({ ok: false, error: "Missing token" }, { status: 400 });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?accept_token=eq.${encodeURIComponent(token)}&select=*,crm_companies(name,email,phone,address_line1,city,postcode)&limit=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();
  if (!res.ok || !data.length) {
    return Response.json({ ok: false, error: "Quote not found" }, { status: 404 });
  }

  return Response.json({ ok: true, quote: data[0] });
}
