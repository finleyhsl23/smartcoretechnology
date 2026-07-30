// GET /api/convoy/cron-compliance-reminders
// Called daily by the SmartCore cron worker (see /cron-worker/worker.js).
// For every company with Convoy enabled: finds vehicles whose MOT/tax/
// insurance/service is due within that company's reminder window, and
// driver licences expiring within the same window, and emails a summary to
// the vehicle's assigned driver plus the company's owners/admins.
import { sb, sbGet, cronAuth } from './_auth.js';
import { sendResendEmail, smartcoreEmailShell } from '../_utils.js';

const SITE = 'https://smartcoretechnology.co.uk';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export async function onRequestGet({ request, env }) {
  if (!cronAuth(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let companiesNotified = 0;
  let emailsSent = 0;

  try {
    const enabledModules = await sbGet(env, `/company_modules?module_key=eq.convoy&enabled=eq.true&select=company_id`);
    for (const { company_id } of enabledModules) {
      const sent = await processCompany(env, company_id);
      emailsSent += sent;
      if (sent > 0) companiesNotified++;
    }
    return json({ ok: true, companiesNotified, emailsSent });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function processCompany(env, companyId) {
  const [settingsRows, vehicles, licences, admins] = await Promise.all([
    sbGet(env, `/convoy_settings?company_id=eq.${companyId}&select=compliance_reminder_days`),
    sbGet(env, `/convoy_vehicles?company_id=eq.${companyId}&status=neq.retired&select=*,driver:assigned_driver_id(id,full_name,work_email)`),
    sbGet(env, `/convoy_driver_licences?company_id=eq.${companyId}&select=*,employee:employee_id(id,full_name,work_email)`),
    sbGet(env, `/core_employees?company_id=eq.${companyId}&role=in.(owner,admin,administrator)&select=id,full_name,work_email`),
  ]);
  const windowDays = settingsRows?.[0]?.compliance_reminder_days ?? 14;
  const cutoff = new Date(Date.now() + windowDays * 86400000);
  const today = new Date(new Date().toDateString());

  const dueItems = [];
  for (const v of vehicles) {
    for (const [field, label] of [['mot_due', 'MOT'], ['tax_due', 'Tax'], ['insurance_due', 'Insurance'], ['service_due', 'Service']]) {
      const d = v[field];
      if (!d) continue;
      const date = new Date(d);
      if (date <= cutoff) dueItems.push({ registration: v.registration, label, date: d, overdue: date < today, driverEmail: v.driver?.work_email, driverName: v.driver?.full_name });
    }
  }
  for (const l of licences) {
    if (!l.expiry_date) continue;
    const date = new Date(l.expiry_date);
    if (date <= cutoff) dueItems.push({ registration: null, label: `${l.employee?.full_name || 'Driver'}'s licence`, date: l.expiry_date, overdue: date < today, driverEmail: l.employee?.work_email, driverName: l.employee?.full_name });
  }

  if (!dueItems.length) return 0;

  const recipients = new Map();
  for (const a of admins) if (a.work_email) recipients.set(a.work_email, a.full_name);
  for (const item of dueItems) if (item.driverEmail) recipients.set(item.driverEmail, item.driverName);

  let sent = 0;
  for (const [email, name] of recipients) {
    const rows = dueItems
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(i => `<tr><td style="padding:6px 0">${esc(i.registration || i.label)}</td><td style="padding:6px 0">${esc(i.registration ? i.label : '')}</td><td style="padding:6px 0;color:${i.overdue ? '#dc2626' : '#374151'}">${i.overdue ? 'Overdue — ' : 'Due '}${esc(fmtDate(i.date))}</td></tr>`)
      .join('');
    const html = smartcoreEmailShell({
      title: 'Convoy compliance reminder',
      intro: `Hi ${esc((name || '').split(' ')[0] || 'there')}, the following items need attention:`,
      bodyHtml: `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>`,
      buttonText: 'Open Convoy',
      buttonUrl: `${SITE}/systems/convoy/vehicles.html`,
    });
    try {
      await sendResendEmail(env, { to: email, subject: 'Convoy: upcoming compliance deadlines', html });
      sent++;
    } catch (e) {
      console.error('Convoy reminder email failed:', e.message);
    }
  }
  return sent;
}
