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

// Single shared fill factory — avoids duplicate function declarations
function makeFill(ctx, escFn) {
  return function fill(str) {
    return (str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => escFn ? esc(ctx[k] ?? '') : String(ctx[k] ?? ''));
  };
}

function buildEmailHtml(config, ctx) {
  const fill = makeFill(ctx, true);
  const subject = fill(config.email_subject || 'SmartCore Notification');
  const bodyText = fill(config.email_body || '');
  const preheader = fill(config.email_preheader || subject);

  const F = 'Arial,Helvetica,sans-serif';

  function detailRow(label, value) {
    if (!value) return '';
    return `<tr>
      <td width="130" style="padding:5px 0;font-size:13px;color:#52526e;font-family:${F};vertical-align:top;">${label}</td>
      <td style="padding:5px 0;font-size:13px;color:#c0c0d4;font-weight:600;font-family:${F};vertical-align:top;">${value}</td>
    </tr>`;
  }

  const detailRows = [
    detailRow('Quote Number', ctx.quote_number ? esc(ctx.quote_number) : ''),
    detailRow('Quote Title',  ctx.quote_title  ? esc(ctx.quote_title)  : ''),
    detailRow('Amount',       ctx.quote_amount ? esc(ctx.quote_amount) : ''),
    detailRow('Company',      ctx.company_name ? esc(ctx.company_name) : ''),
    detailRow('Accepted By',  ctx.contact_name ? esc(ctx.contact_name) : ''),
    detailRow('Contact Email',ctx.contact_email? esc(ctx.contact_email): ''),
    detailRow('Status / Value', (ctx.trigger_label || ctx.trigger_value) ? esc(ctx.trigger_label || ctx.trigger_value) : ''),
  ].join('');

  const hasDetails = !!(ctx.company_name || ctx.contact_name || ctx.quote_number || ctx.quote_title || ctx.quote_amount || ctx.trigger_value);

  const crmUrl = `${SITE}/systems/crm/`;

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<title>${esc(subject)}</title>
<style>
body,table,td{margin:0;padding:0;border:0}
body{background:#06060e;font-family:${F}}
img{border:0;display:block}
a{color:#5b8fff}
</style>
</head>
<body bgcolor="#06060e" style="margin:0;padding:0;background:#06060e;">
<div style="display:none;max-height:0;overflow:hidden;font-size:0;color:#06060e;">${esc(preheader)}&nbsp;</div>

<!-- Outer -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#06060e">
<tr><td align="center" style="padding:32px 16px;">

  <!-- Card -->
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border:1px solid #1e1e2e;">

    <!-- Header -->
    <tr>
      <td bgcolor="#0b0b18" style="padding:32px 40px;border-bottom:1px solid #1a1a2a;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding-right:12px;vertical-align:middle;">
              <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SC" width="42" height="42" style="border-radius:10px;display:block;"/>
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:17px;font-weight:800;color:#f5f5f7;font-family:${F};letter-spacing:-0.03em;">SmartCore</div>
              <div style="font-size:10px;color:#444460;letter-spacing:0.08em;text-transform:uppercase;font-family:${F};margin-top:2px;">CRM</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td bgcolor="#0e0e18" style="padding:40px;">

        <!-- Badge -->
        <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
          <tr>
            <td bgcolor="#0e0e18" style="padding:5px 14px;border:1px solid #2a3a6e;font-size:11px;font-weight:700;color:#5b8fff;letter-spacing:0.05em;text-transform:uppercase;font-family:${F};">
              &#9889; AUTOMATION
            </td>
          </tr>
        </table>

        <!-- Subject -->
        <p style="font-size:26px;font-weight:800;color:#f5f5f7;line-height:1.2;margin:0 0 20px;font-family:${F};">${esc(subject)}</p>

        <!-- Body text -->
        ${bodyText ? `<p style="font-size:15px;color:#a0a0b8;line-height:1.8;margin:0 0 24px;font-family:${F};">${bodyText.replace(/\n/g, '<br/>')}</p>` : ''}

        <!-- Details section -->
        ${hasDetails ? `
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border:1px solid #1e1e2e;background:#090914;">
          <tr><td style="padding:24px;">
            <p style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#52526e;margin:0 0 14px;font-family:${F};">DETAILS</p>
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              ${detailRows}
            </table>
          </td></tr>
        </table>` : ''}

        <!-- CTA Button — VML for Outlook, normal anchor for everyone else -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
          <tr><td align="center">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
              href="${crmUrl}" style="height:52px;v-text-anchor:middle;width:440px;" arcsize="26%"
              strokecolor="#1e5cff" fillcolor="#1e5cff">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:${F};font-size:15px;font-weight:700;">Open SmartCore CRM &#8594;</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${crmUrl}" style="display:inline-block;background:#1e5cff;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:16px 40px;border-radius:12px;font-family:${F};">Open SmartCore CRM &#8594;</a>
            <!--<![endif]-->
          </td></tr>
        </table>

        <!-- Divider -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr><td bgcolor="#1a1a2a" style="height:1px;font-size:0;line-height:0;"> </td></tr>
        </table>

        <!-- Small print -->
        <p style="font-size:12px;color:#52526e;line-height:1.7;margin:0;font-family:${F};">This email was sent automatically by a SmartCore CRM command. To manage automations, visit the Commands page in your CRM.</p>

      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td bgcolor="#09090f" style="padding:28px 40px;border-top:1px solid #1a1a2a;text-align:center;font-size:12px;color:#52526e;font-family:${F};line-height:2.2;">
        SmartCore Technology &bull; <a href="${SITE}" style="color:#5b8fff;text-decoration:none;">${SITE.replace('https://','')}</a><br/>
        <a href="mailto:support@smartcoretechnology.co.uk" style="color:#5b8fff;text-decoration:none;">support@smartcoretechnology.co.uk</a>
      </td>
    </tr>

  </table>
  <!-- /Card -->

</td></tr>
</table>
</body>
</html>`;
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
      // Check trigger value matches (if set on the command, it must equal the incoming value)
      if (cmd.trigger_value && cmd.trigger_value !== (trigger_value ?? '')) continue;
      if (cmd.trigger_field && cmd.trigger_field !== (trigger_field ?? '')) continue;

      // Check company filter (if set, skip when company_id is missing or not in the list)
      if (cmd.company_ids?.length) {
        if (!triggerCtx.company_id || !cmd.company_ids.includes(triggerCtx.company_id)) continue;
      }

      const cfg = cmd.action_config || {};
      let status = 'success', error = null;

      try {
        if (cmd.action_type === 'send_email' || cmd.action_type === 'notify_team') {
          const ctx = { ...triggerCtx, trigger_value };
          const fill = makeFill(ctx, true);

          // Collect all recipient addresses
          const toAddresses = new Set();

          // Specific custom addresses
          if (cfg.send_to_custom && cfg.email_to_custom) {
            cfg.email_to_custom.split(',').map(s => s.trim()).filter(Boolean).forEach(a => toAddresses.add(a));
          }

          // Customer email from context — try all likely fields
          if (cfg.send_to_customer) {
            const customerEmail = triggerCtx.contact_email || triggerCtx.company_email || triggerCtx.email;
            if (customerEmail) {
              toAddresses.add(customerEmail);
            } else {
              console.warn('send_to_customer: no email found in context for command', cmd.id);
            }
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
          } else {
            console.warn('send_email: no recipients resolved for command', cmd.id);
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
          const fill = makeFill(ctx, false);
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
            } else {
              console.warn('set_lead_status: no lead_id found for command', cmd.id, '— ctx:', JSON.stringify({ lead_id: triggerCtx.lead_id, quote_id: triggerCtx.quote_id }));
            }
          }
        } else if (cmd.action_type === 'add_note') {
          const ctx = { ...triggerCtx, trigger_value };
          const fill = makeFill(ctx, false);
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
