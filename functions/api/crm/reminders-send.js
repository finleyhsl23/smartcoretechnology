// POST /api/crm/reminders-send  (called by cron every hour)
// Also handles GET for the cron trigger with ?token=CRON_SECRET

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const FROM = 'SmartCore CRM <noreply@smartcoretechnology.co.uk>';
const SITE = 'https://smartcoretechnology.co.uk';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function sendEmail(key, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!r.ok) console.error('Resend error:', await r.text());
  return r.ok;
}

function reminderEmail(reminder) {
  const dateStr = fmtDate(reminder.remind_at);
  const name = esc(reminder.user_name || 'there');
  const subject = esc(reminder.subject);
  const notes = reminder.notes ? `
    <div class="section">
      <div class="section-label">Notes</div>
      <p class="small" style="color:#c0c0d4;line-height:1.75;white-space:pre-wrap">${esc(reminder.notes)}</p>
    </div>` : '';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reminder — ${subject}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:32px auto;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08);box-shadow:0 32px 80px rgba(0,0,0,.7)}
.hdr{background:linear-gradient(135deg,#0b0b18 0%,#0f1529 60%,#0c1220 100%);padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.07)}
.logo{display:inline-flex;align-items:center;gap:12px}
.logo-mark{width:42px;height:42px;border-radius:12px;display:block}
.logo-name{font-size:17px;font-weight:800;color:#f5f5f7;letter-spacing:-.03em}
.logo-tag{font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin-top:1px}
.body{background:#0e0e18;padding:40px}
.tag{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:20px;background:rgba(255,159,10,.12);color:#ff9f0a;border:1px solid rgba(255,159,10,.22)}
.bell{font-size:14px}
h1{font-size:28px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin-bottom:10px}
.intro{font-size:15px;color:#8a8a9e;line-height:1.75;margin-bottom:28px}
.highlight{color:#f5f5f7;font-weight:600}
.hero-card{background:linear-gradient(135deg,rgba(91,143,255,.1),rgba(30,92,255,.05));border:1px solid rgba(91,143,255,.2);border-radius:18px;padding:28px 32px;margin:0 0 24px}
.hero-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#5b8fff;margin-bottom:8px}
.hero-text{font-size:22px;font-weight:700;color:#f5f5f7;letter-spacing:-.02em}
.hero-date{font-size:13px;color:#7a7a96;margin-top:4px}
.section{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:24px;margin:0 0 20px}
.section-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#52526e;margin-bottom:12px}
.cta-btn{display:block;background:linear-gradient(135deg,#1e5cff,#1a7aff);color:#fff!important;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:17px 28px;border-radius:14px;letter-spacing:-.01em;margin:24px 0;box-shadow:0 8px 24px rgba(30,92,255,.3)}
.divider{height:1px;background:rgba(255,255,255,.06);margin:24px 0}
.small{font-size:13px;color:#7a7a96;line-height:1.7}
.small a{color:#5b8fff;text-decoration:none}
.ftr{padding:28px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2}
.ftr a{color:#5b8fff;text-decoration:none}
</style></head><body>
<div style="display:none;max-height:0;overflow:hidden;font-size:0">Reminder: ${subject} — set for ${dateStr}</div>
<div class="wrap">
  <div class="hdr">
    <div class="logo">
      <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" class="logo-mark" width="42" height="42" style="border-radius:12px;display:block"/>
      <div><div class="logo-name">SmartCore</div><div class="logo-tag">CRM</div></div>
    </div>
  </div>
  <div class="body">
    <div class="tag"><span class="bell">🔔</span> Reminder</div>
    <h1>You have a reminder</h1>
    <p class="intro">Hi ${name},<br><br>This is your personal reminder set for today, <span class="highlight">${dateStr}</span>.</p>
    <div class="hero-card">
      <div class="hero-label">Reminder Subject</div>
      <div class="hero-text">${subject}</div>
      <div class="hero-date">${dateStr}</div>
    </div>
    ${notes}
    <a href="${SITE}/systems/crm/reminders.html" class="cta-btn">Open SmartCore CRM →</a>
    <div class="divider"></div>
    <p class="small">This reminder was set by you in SmartCore CRM. If you no longer need this reminder, you can delete it from the <a href="${SITE}/systems/crm/reminders.html">Reminders</a> page.</p>
  </div>
  <div class="ftr">SmartCore Technology &bull; <a href="${SITE}">${SITE.replace('https://', '')}</a><br>
  <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a></div>
</div></body></html>`;
}

function cronAuth(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-cron-token');
  return !env.CRON_SECRET || token === env.CRON_SECRET;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!cronAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const svcHdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  // Fetch reminders due now (remind_at <= now, not yet sent)
  const now = new Date().toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_reminders?remind_at=lte.${encodeURIComponent(now)}&sent_at=is.null&select=*&limit=100`,
    { headers: { ...svcHdr, Prefer: 'return=representation' } }
  );
  const reminders = await res.json();
  if (!Array.isArray(reminders)) return new Response(JSON.stringify({ error: 'Bad DB response' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  let sent = 0, failed = 0;
  const key = env.RESEND_SMARTCORE_SHOP || env.RESEND_API_KEY;

  for (const r of reminders) {
    if (!r.user_email) continue;
    const ok = await sendEmail(key, r.user_email, `🔔 Reminder: ${r.subject}`, reminderEmail(r));
    if (ok) {
      await fetch(`${SUPABASE_URL}/rest/v1/crm_reminders?id=eq.${r.id}`, {
        method: 'PATCH', headers: svcHdr,
        body: JSON.stringify({ sent_at: now }),
      });
      sent++;
    } else { failed++; }
  }

  return new Response(JSON.stringify({ processed: reminders.length, sent, failed }), { headers: { 'Content-Type': 'application/json' } });
}
