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

  // Build shareable list link — encode items as base64 JSON in URL
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(items))));
  const listUrl = `https://smartcoretechnology.co.uk/systems/nova/list?items=${encoded}`;

  const itemsHtml = items.map((item, i) => `
    <tr>
      <td style="padding:13px 0;border-bottom:1px solid rgba(255,255,255,0.06);vertical-align:middle;">
        <table cellpadding="0" cellspacing="0" style="width:100%;">
          <tr>
            <td style="width:28px;vertical-align:middle;">
              <div style="width:20px;height:20px;border:2px solid #06b6d4;border-radius:5px;"></div>
            </td>
            <td style="vertical-align:middle;padding-left:10px;color:#e2e8f0;font-size:15px;">${item}</td>
            <td style="width:24px;text-align:right;color:#4b5563;font-size:12px;">${i + 1}</td>
          </tr>
        </table>
      </td>
    </tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject || 'Shopping List'} · Nova</title>
</head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0f1e;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0d1426 0%,#0f2044 50%,#091535 100%);border-radius:20px 20px 0 0;padding:36px 40px 32px;border:1px solid rgba(6,182,212,0.15);border-bottom:none;">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td>
                  <div style="display:inline-block;background:rgba(6,182,212,0.12);border:1px solid rgba(6,182,212,0.3);border-radius:8px;padding:5px 12px;margin-bottom:16px;">
                    <span style="color:#06b6d4;font-size:11px;font-weight:700;letter-spacing:0.12em;">NOVA · SMARTCORE AI</span>
                  </div>
                  <div style="color:#fff;font-size:26px;font-weight:700;margin:0;line-height:1.2;">🛒 ${subject || 'Shopping List'}</div>
                  <div style="color:rgba(255,255,255,0.4);font-size:13px;margin-top:8px;">${items.length} item${items.length !== 1 ? 's' : ''} · Sent by Nova</div>
                </td>
                <td style="text-align:right;vertical-align:top;">
                  <div style="width:52px;height:52px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.25);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:24px;">✦</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Items -->
        <tr>
          <td style="background:#0d1426;padding:8px 40px 24px;border-left:1px solid rgba(6,182,212,0.15);border-right:1px solid rgba(6,182,212,0.15);">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${itemsHtml}
            </table>
          </td>
        </tr>

        <!-- Interactive link button -->
        <tr>
          <td style="background:#0d1426;padding:0 40px 32px;border-left:1px solid rgba(6,182,212,0.15);border-right:1px solid rgba(6,182,212,0.15);">
            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td align="center" style="padding-top:8px;">
                  <a href="${listUrl}" style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:12px;letter-spacing:0.01em;">
                    ✓ Open Interactive List
                  </a>
                  <div style="color:rgba(255,255,255,0.3);font-size:11px;margin-top:10px;">Tick off items as you shop</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#080d1a;border-radius:0 0 20px 20px;padding:20px 40px;border:1px solid rgba(6,182,212,0.15);border-top:1px solid rgba(255,255,255,0.05);">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="color:rgba(255,255,255,0.25);font-size:12px;">
                  Sent by <span style="color:#06b6d4;">Nova</span> · SmartCore Technology
                </td>
                <td style="text-align:right;">
                  <a href="https://smartcoretechnology.co.uk/systems/nova" style="color:#06b6d4;font-size:12px;text-decoration:none;">Open Nova →</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
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
