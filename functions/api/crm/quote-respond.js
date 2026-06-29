// POST /api/crm/quote-respond
// Body: { token, action: "accept"|"decline", reason? }
// Public endpoint — no auth required

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const { token, action, reason } = body;
  if (!token || !["accept", "decline"].includes(action)) {
    return Response.json({ ok: false, error: "Missing token or invalid action" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const update = action === "accept"
    ? { status: "accepted", accepted_at: now }
    : { status: "rejected", declined_at: now, decline_reason: reason || null };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?accept_token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(update),
  });

  if (!res.ok) {
    const err = await res.text();
    return Response.json({ ok: false, error: err }, { status: 500 });
  }

  return Response.json({ ok: true, action });
}
