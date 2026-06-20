const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const FROM = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const SITE = 'https://smartcoretechnology.co.uk';

function fmt(n) { return `£${(+(n || 0)).toFixed(2)}`; }
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(iso) {
  return new Date(iso || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
async function sendEmail(key, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!r.ok) { const t = await r.text(); console.error('Email error:', t); }
}

function emailShell(preheader, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartCore</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:32px auto;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08);box-shadow:0 32px 80px rgba(0,0,0,.7)}
.hdr{background:linear-gradient(135deg,#0b0b18 0%,#0f1529 60%,#0c1220 100%);padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.07)}
.logo{display:inline-flex;align-items:center;gap:12px;text-decoration:none}
.logo-mark{width:42px;height:42px;border-radius:12px;overflow:hidden;display:block}
.logo-name{font-size:17px;font-weight:800;color:#f5f5f7;letter-spacing:-.03em}
.logo-tag{font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin-top:1px}
.body{background:#0e0e18;padding:40px}
.tag{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:20px}
.tag-amber{background:rgba(255,159,10,.15);color:#ff9f0a;border:1px solid rgba(255,159,10,.25)}
.tag-blue{background:rgba(91,143,255,.15);color:#5b8fff;border:1px solid rgba(91,143,255,.25)}
h1{font-size:27px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin-bottom:10px}
.intro{font-size:15px;color:#8a8a9e;line-height:1.75;margin-bottom:28px}
.cta-btn{display:block;background:linear-gradient(135deg,#5b8fff 0%,#3060d0 100%);color:#fff!important;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:17px 28px;border-radius:14px;letter-spacing:-.01em;margin:20px 0;box-shadow:0 8px 24px rgba(91,143,255,.25)}
.cta-btn-ghost{display:block;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#f5f5f7!important;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:17px 28px;border-radius:14px;letter-spacing:-.01em;margin:20px 0}
.section{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:24px;margin:0 0 20px}
.section-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#52526e;margin-bottom:16px}
.divider{height:1px;background:rgba(255,255,255,.06);margin:24px 0}
.small{font-size:13px;color:#7a7a96;line-height:1.7}
.small a{color:#5b8fff;text-decoration:none}
.ftr{padding:28px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2}
.ftr a{color:#5b8fff;text-decoration:none}
</style></head><body>
<div style="display:none;max-height:0;overflow:hidden;font-size:0">${esc(preheader)}</div>
<div class="wrap">
  <div class="hdr">
    <div class="logo">
      <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" class="logo-mark" width="42" height="42" style="border-radius:12px;display:block" />
      <div><div class="logo-name">SmartCore</div><div class="logo-tag">Technology</div></div>
    </div>
  </div>
  <div class="body">${body}</div>
  <div class="ftr">
    SmartCore Technology &bull; <a href="${SITE}">${SITE.replace('https://', '')}</a><br>
    <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>
  </div>
</div></body></html>`;
}

export async function onRequest({ env }) {
  const supabaseHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };

  let processed = 0;
  let reminders_sent = 0;
  let renewal_reminders = 0;

  // --- Cancellation reminders ---
  const cancelRes = await fetch(
    `${SUPABASE_URL}/rest/v1/marketplace_subscriptions?cancel_status=eq.cancellation_scheduled&select=*`,
    { headers: supabaseHeaders }
  );
  const cancelSubs = await cancelRes.json();

  for (const sub of cancelSubs) {
    processed++;

    const days = Math.ceil((new Date(sub.cancel_effective_date) - new Date()) / 86400000);

    const needsReminder =
      (days === 7 && !sub.reminder_7d_sent) ||
      (days === 3 && !sub.reminder_3d_sent) ||
      (days === 1 && !sub.reminder_1d_sent);

    if (!needsReminder) continue;

    // Fetch order
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_orders?id=eq.${sub.order_id}&select=*&limit=1`,
      { headers: supabaseHeaders }
    );
    const orders = await orderRes.json();
    const order = orders[0] || {};

    // Fetch company
    const companyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/smartcore_core_companies?order_id=eq.${sub.order_id}&select=*&limit=1`,
      { headers: supabaseHeaders }
    );
    const companies = await companyRes.json();
    const company = companies[0] || {};

    const companyName = esc(company.name || order.company_name || 'your company');
    const cancelDate = fmtDate(sub.cancel_effective_date);
    const toEmail = order.email || company.email;

    if (!toEmail) continue;

    let subject, preheader, body;

    if (days === 7 && !sub.reminder_7d_sent) {
      subject = `Your SmartCore subscription cancels in 7 days — ${company.name || order.company_name || 'your company'}`;
      preheader = `Your subscription is scheduled to cancel on ${cancelDate}. Keep access by reactivating now.`;
      body = `
        <div class="tag tag-amber">Cancellation Notice</div>
        <h1>Your subscription cancels in 7 days</h1>
        <p class="intro">Hi ${companyName},<br><br>This is a reminder that your SmartCore subscription is scheduled to cancel on <strong style="color:#f5f5f7">${cancelDate}</strong>. You have 7 days remaining to keep your access.</p>
        <div class="section">
          <div class="section-label">Cancellation Details</div>
          <p class="small">Effective cancellation date: <strong style="color:#f5f5f7">${cancelDate}</strong></p>
        </div>
        <a href="${SITE}/cancel-subscriptions" class="cta-btn">Keep My Subscription &rarr;</a>
        <div class="divider"></div>
        <p class="small">If you did not request this cancellation or have changed your mind, click the button above to reactivate your subscription. If you have any questions, contact us at <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>.</p>
      `;

      await sendEmail(env.RESEND_SMARTCORE_SHOP, toEmail, subject, emailShell(preheader, body));
      await fetch(
        `${SUPABASE_URL}/rest/v1/marketplace_subscriptions?id=eq.${sub.id}`,
        {
          method: 'PATCH',
          headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ reminder_7d_sent: true }),
        }
      );
      reminders_sent++;

    } else if (days === 3 && !sub.reminder_3d_sent) {
      subject = `Your SmartCore subscription cancels in 3 days — ${company.name || order.company_name || 'your company'}`;
      preheader = `Your subscription is scheduled to cancel on ${cancelDate}. Act now to keep your access.`;
      body = `
        <div class="tag tag-amber">Cancellation Notice</div>
        <h1>Your subscription cancels in 3 days</h1>
        <p class="intro">Hi ${companyName},<br><br>Your SmartCore subscription is scheduled to cancel on <strong style="color:#f5f5f7">${cancelDate}</strong> — just 3 days away. Don't lose access to your services.</p>
        <div class="section">
          <div class="section-label">Cancellation Details</div>
          <p class="small">Effective cancellation date: <strong style="color:#f5f5f7">${cancelDate}</strong></p>
        </div>
        <a href="${SITE}/cancel-subscriptions" class="cta-btn">Keep My Subscription &rarr;</a>
        <div class="divider"></div>
        <p class="small">If you did not request this cancellation or have changed your mind, click the button above to reactivate your subscription. If you have any questions, contact us at <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>.</p>
      `;

      await sendEmail(env.RESEND_SMARTCORE_SHOP, toEmail, subject, emailShell(preheader, body));
      await fetch(
        `${SUPABASE_URL}/rest/v1/marketplace_subscriptions?id=eq.${sub.id}`,
        {
          method: 'PATCH',
          headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ reminder_3d_sent: true }),
        }
      );
      reminders_sent++;

    } else if (days === 1 && !sub.reminder_1d_sent) {
      subject = `Your SmartCore subscription cancels tomorrow — ${company.name || order.company_name || 'your company'}`;
      preheader = `Your subscription cancels tomorrow on ${cancelDate}. This is your last chance to keep access.`;
      body = `
        <div class="tag tag-amber">Final Notice</div>
        <h1>Your subscription cancels tomorrow</h1>
        <p class="intro">Hi ${companyName},<br><br>This is your final reminder — your SmartCore subscription cancels tomorrow on <strong style="color:#f5f5f7">${cancelDate}</strong>. After this date you will lose access to all associated services.</p>
        <div class="section">
          <div class="section-label">Cancellation Details</div>
          <p class="small">Effective cancellation date: <strong style="color:#f5f5f7">${cancelDate}</strong></p>
        </div>
        <a href="${SITE}/cancel-subscriptions" class="cta-btn">Keep My Subscription &rarr;</a>
        <div class="divider"></div>
        <p class="small">If you did not request this cancellation or have changed your mind, click the button above to reactivate your subscription before it's too late. If you have any questions, contact us at <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>.</p>
      `;

      await sendEmail(env.RESEND_SMARTCORE_SHOP, toEmail, subject, emailShell(preheader, body));
      await fetch(
        `${SUPABASE_URL}/rest/v1/marketplace_subscriptions?id=eq.${sub.id}`,
        {
          method: 'PATCH',
          headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ reminder_1d_sent: true }),
        }
      );
      reminders_sent++;
    }
  }

  // --- Renewal reminders ---
  const activeRes = await fetch(
    `${SUPABASE_URL}/rest/v1/marketplace_subscriptions?cancel_status=eq.active&select=*`,
    { headers: supabaseHeaders }
  );
  const activeSubs = await activeRes.json();

  for (const sub of activeSubs) {
    processed++;

    const daysUntilRenewal = Math.ceil((new Date(sub.next_payment_due) - new Date()) / 86400000);
    if (daysUntilRenewal !== 3 || sub.reminder_3d_sent) continue;

    // Fetch order
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_orders?id=eq.${sub.order_id}&select=*&limit=1`,
      { headers: supabaseHeaders }
    );
    const orders = await orderRes.json();
    const order = orders[0] || {};

    // Fetch company
    const companyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/smartcore_core_companies?order_id=eq.${sub.order_id}&select=*&limit=1`,
      { headers: supabaseHeaders }
    );
    const companies = await companyRes.json();
    const company = companies[0] || {};

    const companyName = esc(company.name || order.company_name || 'your company');
    const renewDate = fmtDate(sub.next_payment_due);
    const toEmail = order.email || company.email;

    if (!toEmail) continue;

    const subject = `Your SmartCore subscription renews in 3 days — ${company.name || order.company_name || 'your company'}`;
    const preheader = `Your subscription is set to renew on ${renewDate}.`;
    const body = `
      <div class="tag tag-blue">Renewal Reminder</div>
      <h1>Your subscription renews in 3 days</h1>
      <p class="intro">Hi ${companyName},<br><br>Just a heads-up — your SmartCore subscription is due to renew on <strong style="color:#f5f5f7">${renewDate}</strong>. No action is needed if you'd like to continue your services.</p>
      <div class="section">
        <div class="section-label">Renewal Details</div>
        <p class="small">Renewal date: <strong style="color:#f5f5f7">${renewDate}</strong></p>
      </div>
      <div class="divider"></div>
      <p class="small">If you have any questions about your subscription or wish to make changes, please contact us at <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>.</p>
    `;

    await sendEmail(env.RESEND_SMARTCORE_SHOP, toEmail, subject, emailShell(preheader, body));
    await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_subscriptions?id=eq.${sub.id}`,
      {
        method: 'PATCH',
        headers: { ...supabaseHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ reminder_3d_sent: true }),
      }
    );
    renewal_reminders++;
  }

  return new Response(
    JSON.stringify({ processed, reminders_sent, renewal_reminders }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
