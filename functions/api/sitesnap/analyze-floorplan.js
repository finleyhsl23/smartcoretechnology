// POST /api/sitesnap/analyze-floorplan { companyId, imageBase64, mimeType }
// Reads a hand-drawn/sketched floor plan image with Claude's vision and
// returns walls/doors/windows/rooms as coordinates normalized 0-1 against
// the image itself — the client maps those into the exact canvas rect the
// image is displayed at. This is a best-effort AI read of a sketch, not
// precise CAD extraction, and the client-side copy says so.
import { json, options, getCallerProfile } from './_auth.js';
import { callClaudeVisionWithRetry } from './_ai.js';

const ADMIN_ROLES = ['owner', 'admin', 'administrator'];

const PROMPT = `You are reading a hand-drawn or sketched architectural floor plan image and converting it into structured data.

Return ONLY a JSON array — no markdown fences, no prose, nothing before or after it. Each element in the array is one of these shapes:

{"type":"wall","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0,"real_length_m":0.0}
{"type":"door","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0,"real_length_m":0.0}
{"type":"window","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0,"real_length_m":0.0}
{"type":"room","x":0.0,"y":0.0,"width":0.0,"height":0.0,"label":"Bedroom","real_width_m":0.0,"real_height_m":0.0}

All coordinates are normalized to the image itself: (0,0) is the top-left corner of the image, (1,1) is the bottom-right corner, regardless of the image's actual pixel size.

Identify every wall segment you can see (both exterior and interior walls) as line elements. Identify door openings (gaps in a wall, often with a swing arc) and window openings (breaks in a wall, often with parallel lines) as short line elements at their location on the wall. Identify every enclosed room as a rectangle — use the closest bounding rectangle if the room isn't a perfect rectangle — and use whatever label/name is written on the sketch for that room (e.g. "Kitchen", "Bedroom 1"); if no label is visible, invent a short sensible one based on typical room layout (e.g. "Room 1", "Hallway").

The sketch may have handwritten measurements/dimensions on it (e.g. "4m", "3.2 x 2.5m", "12ft", numbers next to a wall or written inside a room). Where a measurement is clearly legible and clearly applies to a specific wall/door/window or room, include it as "real_length_m" (for walls/doors/windows) or "real_width_m"/"real_height_m" (for rooms), converting feet/inches to meters if needed. Omit these fields entirely (do not include the key) for any element where no measurement is legible on the sketch — never guess or invent a measurement.

Only include elements you can actually see evidence for in the sketch — do not invent walls or rooms that aren't there. If the image isn't a floor plan at all, or you can't make out any structure, return an empty array [].`;

export async function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { companyId, imageBase64, mimeType } = body || {};
  if (!companyId || !imageBase64 || !mimeType) return json({ error: 'companyId, imageBase64 and mimeType are required' }, 400);

  const caller = await getCallerProfile(request, env);
  if (!caller) return json({ error: 'Unauthorized' }, 401);
  if (caller.company_id !== companyId) return json({ error: 'Forbidden' }, 403);
  if (!ADMIN_ROLES.includes(caller.role)) return json({ error: 'Only Owners and Admins can auto-convert a sketch.' }, 403);

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'AI is not configured for this environment.' }, 500);

  let elements;
  try {
    elements = await callClaudeVisionWithRetry(apiKey, [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
      { type: 'text', text: PROMPT },
    ]);
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.startsWith('ai-http-')) return json({ error: 'Could not analyze the image.' }, 502);
    return json({ error: 'Could not understand the AI response. Try a clearer image.' }, 502);
  }
  if (!Array.isArray(elements)) return json({ error: 'Unexpected AI response format.' }, 502);

  const VALID_TYPES = ['wall', 'door', 'window', 'room'];
  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  const positiveMeters = (n) => {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 && v < 500 ? v : null;
  };
  const cleaned = elements
    .filter(el => el && VALID_TYPES.includes(el.type))
    .map(el => el.type === 'room'
      ? {
          type: 'room', x: clamp01(el.x), y: clamp01(el.y), width: clamp01(el.width), height: clamp01(el.height),
          label: String(el.label || 'Room').slice(0, 80),
          real_width_m: positiveMeters(el.real_width_m),
          real_height_m: positiveMeters(el.real_height_m),
        }
      : {
          type: el.type, x1: clamp01(el.x1), y1: clamp01(el.y1), x2: clamp01(el.x2), y2: clamp01(el.y2),
          real_length_m: positiveMeters(el.real_length_m),
        })
    .filter(el => el.type !== 'room' || (el.width > 0.005 && el.height > 0.005));

  return json({ elements: cleaned });
}
