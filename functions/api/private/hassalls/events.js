// POST /api/private/hassalls/events
//
// Ingestion endpoint for the Raspberry Pi watcher script
// (smartcore_camera_watch.py). Called once an event has already been
// through Claude's vision review on the Pi — this endpoint just validates
// shape, authenticates the per-site API key, and persists.
//
// Auth: `x-ingestion-key: <raw key>` header, checked against
// hassalls.ingestion_keys via Postgres RLS (see
// hassalls.current_ingestion_site_id() in the foundation migration). There
// is no service-role key anywhere in this file — every Supabase call uses
// the anon key, same as the rest of SmartCore's client-side pattern.
import { json, options, hassallsRest, hassallsRpc } from './_shared.js';

export const onRequestOptions = () => options();

const EVENT_TYPES = ['motion', 'beam', 'manual'];
const THREAT_LEVELS = ['none', 'low', 'medium', 'high'];
const CONFIDENCE_METHODS = ['direct_read', 'inferred_match', 'none'];

// A plate read tagged confidence_method='direct_read' (OCR straight off a
// clear frame) is trusted more than one Claude only inferred from a partial/
// obscured read against known vehicles — reuse that same signal as the
// vehicle registry's confidence tier rather than asking the Pi to send a
// second, redundant confidence value.
const PLATE_CONFIDENCE_FROM_METHOD = {
  direct_read: 'high',
  inferred_match: 'medium',
  none: 'low',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const ingestionKey = (request.headers.get('x-ingestion-key') || '').trim();
    if (!ingestionKey) return json({ error: 'Missing x-ingestion-key header' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const {
      site_id,
      camera_id,
      timestamp,
      event_type,
      objects_detected,
      vehicle_plate,
      vehicle_description,
      threat_level,
      description,
      confidence_method,
      frame_urls,
      raw_ai_response,
    } = body;

    if (!site_id) return json({ error: 'site_id is required' }, 400);
    if (!EVENT_TYPES.includes(event_type)) {
      return json({ error: `event_type must be one of ${EVENT_TYPES.join(', ')}` }, 400);
    }
    const level = threat_level || 'none';
    if (!THREAT_LEVELS.includes(level)) {
      return json({ error: `threat_level must be one of ${THREAT_LEVELS.join(', ')}` }, 400);
    }
    const method = confidence_method || 'none';
    if (!CONFIDENCE_METHODS.includes(method)) {
      return json({ error: `confidence_method must be one of ${CONFIDENCE_METHODS.join(', ')}` }, 400);
    }
    if (objects_detected !== undefined && !Array.isArray(objects_detected)) {
      return json({ error: 'objects_detected must be an array' }, 400);
    }
    if (frame_urls !== undefined && !Array.isArray(frame_urls)) {
      return json({ error: 'frame_urls must be an array' }, 400);
    }

    const eventId = crypto.randomUUID();
    const eventTime = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();

    const insertRes = await hassallsRest(env, '/events', ingestionKey, 'POST', {
      id: eventId,
      camera_id: camera_id || null,
      site_id,
      event_time: eventTime,
      event_type,
      objects_detected: objects_detected || [],
      vehicle_plate: vehicle_plate || null,
      vehicle_description: vehicle_description || null,
      threat_level: level,
      description: description || null,
      confidence_method: method,
      frame_urls: frame_urls || [],
      raw_ai_response: raw_ai_response ?? null,
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      const isAuthFailure = insertRes.status === 401 || insertRes.status === 403 || /row-level security|permission denied/i.test(errText);
      console.error('hassalls events insert failed:', insertRes.status, errText);
      return json({ error: isAuthFailure ? 'Invalid or revoked ingestion key' : 'Could not store event' }, isAuthFailure ? 401 : 502);
    }

    // Refresh the reporting camera's heartbeat. Best-effort — a failure here
    // shouldn't fail the whole ingest, the event is already safely stored.
    if (camera_id) {
      hassallsRest(env, `/cameras?id=eq.${encodeURIComponent(camera_id)}`, ingestionKey, 'PATCH', {
        status: 'online',
        last_seen: eventTime,
      }).catch((e) => console.error('hassalls camera heartbeat failed:', e));
    }

    // Upsert the vehicle registry via the compare-and-merge RPC (see
    // hassalls.ingest_vehicle_sighting) — never a direct table write, so a
    // lower-confidence later read can't clobber a better one already stored.
    if (vehicle_plate) {
      const rpcRes = await hassallsRpc(env, 'ingest_vehicle_sighting', ingestionKey, {
        p_plate: vehicle_plate,
        p_make_model: vehicle_description || null,
        p_colour: null,
        p_confidence: PLATE_CONFIDENCE_FROM_METHOD[method] || 'low',
        p_seen_at: eventTime,
      });
      if (!rpcRes.ok) {
        console.error('hassalls vehicle upsert failed:', rpcRes.status, await rpcRes.text());
      }
    }

    // Medium/high threat events raise an alert row and an email.
    if (level === 'medium' || level === 'high') {
      const message = description || `${level.toUpperCase()} threat event detected`;
      const alertRes = await hassallsRest(env, '/alerts', ingestionKey, 'POST', {
        id: crypto.randomUUID(),
        event_id: eventId,
        severity: level,
        message,
      });
      if (!alertRes.ok) {
        console.error('hassalls alert insert failed:', alertRes.status, await alertRes.text());
      }

      const to = env.HASSALLS_ALERT_EMAIL || 'finleyh123456@gmail.com';
      if (env.RESEND_API_KEY) {
        try {
          await sendAlertEmail(env, to, { level, message, eventTime, vehicle_plate, description });
        } catch (e) {
          console.error('hassalls alert email failed:', e);
        }
      }
    }

    return json({ success: true, id: eventId }, 201);
  } catch (e) {
    console.error('hassalls events ingest error:', e);
    return json({ error: e.message || 'Internal error' }, 500);
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendAlertEmail(env, to, { level, message, eventTime, vehicle_plate, description }) {
  const colour = level === 'high' ? '#ef4444' : '#f59e0b';
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hassalls Security Alert</title></head>
<body style="margin:0;padding:0;background:#020617;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#eaf0ff">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.1)">
  <tr><td style="background:#06153a;padding:24px 32px;border-bottom:1px solid rgba(255,255,255,.08)">
    <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${colour}">⚠ ${esc(level)} threat</div>
    <div style="font-size:19px;font-weight:800;margin-top:6px">Hassalls Security Alert</div>
  </td></tr>
  <tr><td style="background:#040e28;padding:28px 32px">
    <p style="font-size:14px;line-height:1.7;color:#eaf0ff;margin:0 0 16px">${esc(message)}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;font-size:13px;color:rgba(234,240,255,.65)">
      <tr><td style="padding:4px 0">Time</td><td style="padding:4px 0;text-align:right;color:#eaf0ff">${esc(new Date(eventTime).toLocaleString('en-GB'))}</td></tr>
      ${vehicle_plate ? `<tr><td style="padding:4px 0">Vehicle</td><td style="padding:4px 0;text-align:right;color:#eaf0ff">${esc(vehicle_plate)}</td></tr>` : ''}
      ${description ? `<tr><td style="padding:4px 0;vertical-align:top">Description</td><td style="padding:4px 0;text-align:right;color:#eaf0ff">${esc(description)}</td></tr>` : ''}
    </table>
    <a href="https://smartcoretechnology.co.uk/private/hassalls/" style="display:inline-block;margin-top:24px;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px">Open dashboard →</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SmartCore <noreply@smartcoretechnology.co.uk>',
      to: [to],
      subject: `[Hassalls] ${level.toUpperCase()} threat alert`,
      html,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
}
