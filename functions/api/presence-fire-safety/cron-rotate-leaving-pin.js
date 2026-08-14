// GET /api/presence-fire-safety/cron-rotate-leaving-pin
// Weekly leaving-PIN rotation, driven by the shared daily cron worker (see
// cron-worker/worker.js) — this endpoint itself decides whether a given
// company is actually due for rotation (7+ days since the last one, or
// never rotated), so it's safe to hit once a day without over-rotating.
// Only companies that have at least one leaving-PIN holder configured are
// touched at all — everyone else never had this feature turned on.
import { json, options, sb } from './_auth.js';
import { sendResendEmail, smartcoreEmailShell } from '../_utils.js';

export const onRequestOptions = () => options();

function cronAuth(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-cron-token');
  return !!env.CRON_SECRET && token === env.CRON_SECRET;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ROTATION_INTERVAL_DAYS = 7;

export async function onRequestGet({ request, env }) {
  if (!cronAuth(request, env)) return json({ error: 'Unauthorized' }, 401);

  try {
    // Companies actively using this feature — anyone with at least one
    // designated holder, regardless of whether a PIN has ever been set yet.
    const holderCompaniesRes = await sb(env, '/presence_fire_safety_leaving_pin_holders?select=company_id');
    const holderRows = await holderCompaniesRes.json();
    const companyIds = [...new Set((holderRows || []).map((r) => r.company_id))];
    if (!companyIds.length) return json({ rotated: 0, skipped: 0, reason: 'No companies have leaving PIN holders configured' });

    const results = [];
    for (const companyId of companyIds) {
      try {
        const result = await rotateForCompany(env, companyId);
        results.push({ companyId, ...result });
      } catch (e) {
        results.push({ companyId, ok: false, error: e.message });
      }
    }

    return json({
      rotated: results.filter((r) => r.ok && r.rotated).length,
      skipped: results.filter((r) => r.ok && !r.rotated).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    console.error('cron-rotate-leaving-pin:', e.message);
    return json({ error: e.message || 'Unexpected error' }, 500);
  }
}

async function rotateForCompany(env, companyId) {
  const settingsRes = await sb(env, `/presence_fire_safety_settings?company_id=eq.${companyId}&select=leaving_pin_rotated_at`);
  const [settingsRow] = await settingsRes.json();
  const lastRotated = settingsRow?.leaving_pin_rotated_at;
  const dueForRotation = !lastRotated || (Date.now() - new Date(lastRotated).getTime()) >= ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  if (!dueForRotation) return { ok: true, rotated: false };

  const rpcRes = await sb(env, '/rpc/presence_fire_safety_rotate_leaving_pin', 'POST', { p_company_id: companyId });
  if (!rpcRes.ok) throw new Error((await rpcRes.text()) || 'Rotation RPC failed');
  const newPin = await rpcRes.json();

  const holdersRes = await sb(env, `/presence_fire_safety_leaving_pin_holders?company_id=eq.${companyId}` +
    `&select=core_employees(full_name,work_email)`);
  const holders = (await holdersRes.json()) || [];
  const emails = holders.map((h) => h.core_employees).filter((e) => e?.work_email);

  if (emails.length) {
    const html = smartcoreEmailShell({
      title: 'Your new Leaving PIN',
      intro: `The Leaving PIN has rotated for this week — the old one no longer works.`,
      bodyHtml: `
        <div style="margin:20px 0;padding:20px;border-radius:12px;background:#f0f9ff;border:1px solid #bae6fd;text-align:center">
          <div style="font-size:11px;color:#0369a1;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">This week's Leaving PIN</div>
          <div style="font-size:32px;font-weight:800;letter-spacing:.1em;color:#0c4a6e">${esc(newPin)}</div>
        </div>
        <p style="font-size:13px;color:#6b7280">If you're the last person leaving the building, use this PIN to check who the register still shows as signed in and flag anyone who forgot to sign out.</p>
      `,
    });
    await Promise.allSettled(emails.map((e) => sendResendEmail(env, {
      to: e.work_email, subject: 'Your new Leaving PIN this week', html,
    })));
  }

  return { ok: true, rotated: true, notified: emails.length };
}
