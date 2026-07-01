// POST /api/nova/send-email
// Body: { to, subject, items: string[] }
// Sends via Resend (RESEND_API_KEY env var)

const SUPABASE_URL  = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestPost(ctx) {
  const { env, request } = ctx;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim();
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response('Unauthorized', { status: 401, headers: cors });

  if (!env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
      status: 503, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const { to, subject, items } = await request.json().catch(() => ({}));
  if (!to || !items?.length) {
    return new Response(JSON.stringify({ error: 'Missing to or items' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const itemsHtml = items.map(i => `
    <li style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:15px;color:#1f2937;">${i}</li>`
  ).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;padding:32px 0;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#0a0f1e,#1a2744);padding:28px 32px;">
      <div style="color:#06b6d4;font-size:13px;font-weight:600;letter-spacing:0.1em;margin-bottom:6px;">NOVA · SMARTCORE AI</div>
      <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">🛒 ${subject || 'Shopping List'}</h1>
    </div>
    <div style="padding:24px 32px;">
      <ul style="margin:0;padding:0;list-style:none;">${itemsHtml}</ul>
    </div>
    <div style="padding:16px 32px 24px;color:#9ca3af;font-size:12px;border-top:1px solid #f3f4f6;">
      Sent by Nova, your SmartCore AI assistant.
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Nova <nova@smartcoretechnology.co.uk>',
      to: [to],
      subject: subject || 'Your Shopping List from Nova',
      html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'Email send failed', detail }), {
      status: 502, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
  });
}
