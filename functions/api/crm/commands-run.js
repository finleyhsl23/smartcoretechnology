// POST /api/crm/commands-run
// Body: { tenant_id, trigger_type, trigger_value, trigger_field, context }
// Auth: Bearer <supabase access token>
// Called internally whenever a triggerable CRM event occurs

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';
const FROM = 'SmartCore CRM <noreply@smartcoretechnology.co.uk>';
const SITE = 'https://smartcoretechnology.co.uk';

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

async function sendEmail(key, to, subject, html, replyTo) {
  const body = { from: FROM, to: Array.isArray(to) ? to : [to], subject, html };
  if (replyTo) body.reply_to = replyTo;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error('Resend error:', await r.text());
  return r.ok;
}

function buildEmailHtml(config, ctx) {
  // Replace {{field}} tokens from context
  function fill(str) {
    return (str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => esc(ctx[k] ?? `{{${k}}}`));
  }
  const subject = fill(config.email_subject || 'SmartCore Notification');
  const bodyText = fill(config.email_body || '');
  const preheader = fill(config.email_preheader || subject);

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title>
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
.tag{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:20px;background:rgba(91,143,255,.12);color:#5b8fff;border:1px solid rgba(91,143,255,.22)}
h1{font-size:28px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin-bottom:16px}
.content{font-size:15px;color:#a0a0b8;line-height:1.8;white-space:pre-wrap}
.section{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:24px;margin:24px 0}
.section-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#52526e;margin-bottom:12px}
.row{display:flex;gap:8px;margin-bottom:8px;font-size:13px}
.row-label{color:#52526e;min-width:120px;flex-shrink:0}
.row-val{color:#c0c0d4;font-weight:500}
.cta-btn{display:block;background:linear-gradient(135deg,#1e5cff,#1a7aff);color:#fff!important;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:17px 28px;border-radius:14px;letter-spacing:-.01em;margin:24px 0;box-shadow:0 8px 24px rgba(30,92,255,.3)}
.divider{height:1px;background:rgba(255,255,255,.06);margin:24px 0}
.small{font-size:12px;color:#52526e;line-height:1.7}
.ftr{padding:28px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2}
.ftr a{color:#5b8fff;text-decoration:none}
</style></head><body>
<div style="display:none;max-height:0;overflow:hidden;font-size:0">${esc(preheader)}</div>
<div class="wrap">
  <div class="hdr">
    <div class="logo">
      <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" class="logo-mark" width="42" height="42" style="border-radius:12px;display:block"/>
      <div><div class="logo-name">SmartCore</div><div class="logo-tag">CRM</div></div>
    </div>
  </div>
  <div class="body">
    <div class="tag">⚡ Automation</div>
    <h1>${esc(subject)}</h1>
    ${bodyText ? `<p class="content">${bodyText}</p>` : ''}
    ${(ctx.company_name || ctx.contact_name || ctx.quote_number || ctx.quote_title || ctx.quote_amount || ctx.trigger_value) ? `
    <div class="section">
      <div class="section-label">Details</div>
      ${ctx.quote_number ? `<div class="row"><span class="row-label">Quote Number</span><span class="row-val">${esc(ctx.quote_number)}</span></div>` : ''}
      ${ctx.quote_title ? `<div class="row"><span class="row-label">Quote Title</span><span class="row-val">${esc(ctx.quote_title)}</span></div>` : ''}
      ${ctx.quote_amount ? `<div class="row"><span class="row-label">Amount</span><span class="row-val">${esc(ctx.quote_amount)}</span></div>` : ''}
      ${ctx.company_name ? `<div class="row"><span class="row-label">Company</span><span class="row-val">${esc(ctx.company_name)}</span></div>` : ''}
      ${ctx.contact_name ? `<div class="row"><span class="row-label">Accepted By</span><span class="row-val">${esc(ctx.contact_name)}</span></div>` : ''}
      ${ctx.contact_email ? `<div class="row"><span class="row-label">Contact Email</span><span class="row-val">${esc(ctx.contact_email)}</span></div>` : ''}
      ${(ctx.trigger_label || ctx.trigger_value) ? `<div class="row"><span class="row-label">Status / Value</span><span class="row-val">${esc(ctx.trigger_label || ctx.trigger_value)}</span></div>` : ''}
    </div>` : ''}
    <a href="${SITE}/systems/crm/" class="cta-btn">Open SmartCore CRM →</a>
    <div class="divider"></div>
    <p class="small">This email was sent automatically by a SmartCore CRM command. To manage automations, visit the Commands page in your CRM.</p>
  </div>
  <div class="ftr">SmartCore Technology &bull; <a href="${SITE}">${SITE.replace('https://','')}</a><br>
  <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a></div>
</div></body></html>`;
}

export async function onRequestPost(context) {
  try {
    const { env, request } = context;

    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'Unauthorized' }, 401);

    const body = await request.json();
    const { tenant_id, trigger_type, trigger_value, trigger_field, ctx: triggerCtx = {} } = body;
    if (!tenant_id || !trigger_type) return json({ ok: false, error: 'Missing fields' }, 400);

    const svcHdr = {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Verify caller — accept service key (server-to-server) or a valid user JWT
    const isServiceCall = token === env.SUPABASE_SERVICE_KEY;
    if (!isServiceCall) {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
      if (!userRes.ok) return json({ ok: false, error: 'Unauthorized' }, 401);
      const userData = await userRes.json();
      if (!userData?.id) return json({ ok: false, error: 'Unauthorized' }, 401);
    }

    // Fetch matching active commands
    const cmdUrl = `${SUPABASE_URL}/rest/v1/crm_commands`
      + `?tenant_id=eq.${tenant_id}`
      + `&trigger_type=eq.${encodeURIComponent(trigger_type)}`
      + `&is_active=eq.true`
      + `&select=*`;
    const cmdRes = await fetch(cmdUrl, { headers: svcHdr });
    const commands = await cmdRes.json();
    if (!Array.isArray(commands)) return json({ ok: false, error: 'DB error' }, 500);

    const resendKey = env.RESEND_SMARTCORE_SHOP || env.RESEND_API_KEY;
    let ran = 0;

    // ── Enrich trigger context ──────────────────────────────────
    // Resolve stage key → human name
    let stages = [];
    try {
      const stgRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${tenant_id}&select=pipeline_stages&limit=1`, { headers: svcHdr });
      const stgData = await stgRes.json().catch(() => []);
      stages = Array.isArray(stgData) && stgData[0]?.pipeline_stages ? stgData[0].pipeline_stages : [];
    } catch(_) {}
    function resolveStage(key) {
      if (!key) return key;
      const s = stages.find(s => s.key === key);
      return s?.name || key;
    }
    // Add readable label for the trigger value
    if (trigger_value) triggerCtx.trigger_label = resolveStage(trigger_value);

    // If a lead is linked but no quote details yet, look up the most recent linked quote
    if (triggerCtx.lead_id && !triggerCtx.quote_number) {
      try {
        const qRes = await fetch(
          `${SUPABASE_URL}/rest/v1/crm_quotes?crm_lead_id=eq.${triggerCtx.lead_id}&select=id,quote_number,title,total&order=created_at.desc&limit=1`,
          { headers: svcHdr }
        );
        const qData = await qRes.json().catch(() => []);
        if (Array.isArray(qData) && qData[0]) {
          const q = qData[0];
          triggerCtx.quote_id     = triggerCtx.quote_id     || q.id        || '';
          triggerCtx.quote_number = triggerCtx.quote_number || q.quote_number || '';
          triggerCtx.quote_title  = triggerCtx.quote_title  || q.title      || '';
          triggerCtx.quote_amount = triggerCtx.quote_amount || (q.total ? `£${Number(q.total).toFixed(2)}` : '');
        }
      } catch(_) {}
    }
    // ── End enrichment ──────────────────────────────────────────

    for (const cmd of commands) {
      // Check trigger value matches (if set)
      if (cmd.trigger_value && trigger_value && cmd.trigger_value !== trigger_value) continue;
      if (cmd.trigger_field && trigger_field && cmd.trigger_field !== trigger_field) continue;

      // Check company filter (if set)
      if (cmd.company_ids?.length && triggerCtx.company_id) {
        if (!cmd.company_ids.includes(triggerCtx.company_id)) continue;
      }

      const cfg = cmd.action_config || {};
      let status = 'success', error = null;

      try {
        if (cmd.action_type === 'send_email' || cmd.action_type === 'notify_team') {
          const ctx = { ...triggerCtx, trigger_value };
          function fill(s) { return (s||'').replace(/\{\{(\w+)\}\}/g, (_, k) => esc(ctx[k] ?? '')); }

          // Collect all recipient addresses
          const toAddresses = new Set();

          // Specific custom addresses
          if (cfg.send_to_custom && cfg.email_to_custom) {
            cfg.email_to_custom.split(',').map(s => s.trim()).filter(Boolean).forEach(a => toAddresses.add(a));
          }

          // Customer email from context
          if (cfg.send_to_customer) {
            const customerEmail = triggerCtx.company_email || triggerCtx.contact_email;
            if (customerEmail) toAddresses.add(customerEmail);
          }

          // Team emails — fetch from DB
          if (cfg.send_to_team) {
            const teamRes = await fetch(`${SUPABASE_URL}/rest/v1/core_employees?company_id=eq.${tenant_id}&select=work_email&limit=50`, { headers: svcHdr });
            const team = await teamRes.json().catch(() => []);
            if (Array.isArray(team)) team.forEach(t => { if (t.work_email) toAddresses.add(t.work_email); });
          }

          const recipients = [...toAddresses].filter(Boolean);
          if (recipients.length) {
            await sendEmail(resendKey, recipients, fill(cfg.email_subject || 'SmartCore Notification'), buildEmailHtml(cfg, ctx), cfg.email_reply_to);
          }
        } else if (cmd.action_type === 'webhook') {
          if (cfg.webhook_url) {
            await fetch(cfg.webhook_url, {
              method: cfg.webhook_method || 'POST',
              headers: { 'Content-Type': 'application/json', ...(cfg.webhook_headers || {}) },
              body: JSON.stringify({ trigger_type, trigger_value, trigger_field, context: triggerCtx }),
            });
          }
        } else if (cmd.action_type === 'create_task') {
          const ctx = { ...triggerCtx, trigger_value };
          function fill(s) { return (s||'').replace(/\{\{(\w+)\}\}/g, (_, k) => String(ctx[k] ?? '')); }
          const dueDate = cfg.task_due_days
            ? new Date(Date.now() + cfg.task_due_days * 86400000).toISOString().split('T')[0]
            : null;
          await fetch(`${SUPABASE_URL}/rest/v1/crm_tasks`, {
            method: 'POST',
            headers: { ...svcHdr, Prefer: 'return=minimal' },
            body: JSON.stringify({
              tenant_id,
              title: fill(cfg.task_title || 'Follow-up task'),
              notes: cfg.task_notes ? fill(cfg.task_notes) : null,
              due_date: dueDate,
              crm_company_id: triggerCtx.company_id || null,
              crm_lead_id: triggerCtx.lead_id || null,
              status: 'pending',
              priority: 'medium',
            }),
          });
        } else if (cmd.action_type === 'set_lead_status') {
          if (cfg.lead_status) {
            let leadId = triggerCtx.lead_id;
            // Fall back: look up lead_id from the linked quote if not in ctx
            if (!leadId && triggerCtx.quote_id) {
              const qr = await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${triggerCtx.quote_id}&select=crm_lead_id&limit=1`, { headers: svcHdr });
              const qd = await qr.json().catch(() => []);
              leadId = Array.isArray(qd) ? qd[0]?.crm_lead_id : null;
            }
            if (leadId) {
              await fetch(`${SUPABASE_URL}/rest/v1/crm_leads?id=eq.${leadId}`, {
                method: 'PATCH',
                headers: { ...svcHdr, Prefer: 'return=minimal' },
                body: JSON.stringify({ status: cfg.lead_status, pipeline_stage: cfg.lead_status }),
              });
            }
          }
        } else if (cmd.action_type === 'add_note') {
          const ctx = { ...triggerCtx, trigger_value };
          function fill(s) { return (s||'').replace(/\{\{(\w+)\}\}/g, (_, k) => String(ctx[k] ?? '')); }
          await fetch(`${SUPABASE_URL}/rest/v1/crm_activities`, {
            method: 'POST',
            headers: { ...svcHdr, Prefer: 'return=minimal' },
            body: JSON.stringify({
              tenant_id,
              type: 'note',
              title: fill(cfg.note_content || 'Automated note'),
              crm_company_id: triggerCtx.company_id || null,
              crm_lead_id: triggerCtx.lead_id || null,
            }),
          });
        }
      } catch(e) { status = 'error'; error = e.message; }

      // Log run + increment counter
      const now = new Date().toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/crm_command_runs`, {
        method: 'POST', headers: { ...svcHdr, Prefer: 'return=minimal' },
        body: JSON.stringify({ command_id: cmd.id, tenant_id, trigger_data: body, status, error }),
      });
      await fetch(`${SUPABASE_URL}/rest/v1/crm_commands?id=eq.${cmd.id}`, {
        method: 'PATCH', headers: { ...svcHdr, Prefer: 'return=minimal' },
        body: JSON.stringify({ run_count: (cmd.run_count || 0) + 1, last_run_at: now }),
      });
      ran++;
    }

    return json({ ok: true, ran });
  } catch(e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
