// POST /api/sitesnap/verify-floorplan
//   { companyId, originalImageBase64, originalMimeType, renderedImageBase64, currentElements }
//
// Second pass on an already-auto-converted floor plan: shows Claude the
// original sketch alongside a plain rendering of what was actually placed
// (both in the same normalized 0-1 coordinate space), plus the current
// element list, and asks it to correct anything misplaced/missing/extra —
// including rotating room labels that don't read well horizontally. The
// client fully replaces the level's elements with whatever comes back.
import { json, options, getCallerProfile } from './_auth.js';
import { callClaudeVisionWithRetry } from './_ai.js';

const ADMIN_ROLES = ['owner', 'admin', 'administrator'];

const PROMPT = `You previously converted a hand-drawn floor plan sketch (the first image) into a structured floor plan made of walls, doors, windows and rooms. The second image is a plain rendering of the elements as currently placed, in the exact same normalized coordinate space as the sketch — a thin outlined rectangle in the second image marks the same area the sketch occupies in the first, so you can line the two up.

Compare the two images carefully alongside the current element list below (same normalized 0-1 coordinates used before) and correct anything wrong so the rendering matches the sketch as closely as possible:
- Fix any room, wall, door or window that is in the wrong place, wrong size, or missing from the rendering.
- Remove any element in the list that doesn't actually correspond to anything in the sketch.
- Every room's label text must be fully visible and readable within its own room in the rendering, not clipped, truncated more than necessary, or overlapping a neighbouring room. If a room is too narrow or long for its label to read well horizontally, set "label_angle" to a rotation in degrees (e.g. 90 for vertical text reading bottom-to-top) so it fits along the room's long axis instead. Leave "label_angle" out (or 0) for rooms where horizontal text already works fine.

Current elements (normalized 0-1 coordinates):
{{ELEMENTS_JSON}}

Return ONLY a corrected JSON array — no markdown fences, no prose, nothing before or after it — using this exact schema:

{"type":"wall","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"door","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"window","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"room","x":0.0,"y":0.0,"width":0.0,"height":0.0,"label":"Bedroom","label_angle":0}

If the current layout already matches the sketch well, return it back essentially unchanged (still using this exact schema). Return every element that should exist in the final result — this is a full replacement, not a diff.`;

export async function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { companyId, originalImageBase64, originalMimeType, renderedImageBase64, currentElements } = body || {};
  if (!companyId || !originalImageBase64 || !originalMimeType || !renderedImageBase64 || !Array.isArray(currentElements)) {
    return json({ error: 'companyId, originalImageBase64, originalMimeType, renderedImageBase64 and currentElements are required' }, 400);
  }

  const caller = await getCallerProfile(request, env);
  if (!caller) return json({ error: 'Unauthorized' }, 401);
  if (caller.company_id !== companyId) return json({ error: 'Forbidden' }, 403);
  if (!ADMIN_ROLES.includes(caller.role)) return json({ error: 'Only Owners and Admins can verify a floor plan.' }, 403);

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'AI is not configured for this environment.' }, 500);

  const VALID_TYPES = ['wall', 'door', 'window', 'room'];
  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  const elementsForPrompt = currentElements
    .filter(el => el && VALID_TYPES.includes(el.type))
    .map(el => el.type === 'room'
      ? { type: 'room', x: clamp01(el.x), y: clamp01(el.y), width: clamp01(el.width), height: clamp01(el.height), label: String(el.label || 'Room').slice(0, 80), label_angle: Number(el.label_angle) || 0 }
      : { type: el.type, x1: clamp01(el.x1), y1: clamp01(el.y1), x2: clamp01(el.x2), y2: clamp01(el.y2) });

  let elements;
  try {
    elements = await callClaudeVisionWithRetry(apiKey, [
      { type: 'image', source: { type: 'base64', media_type: originalMimeType, data: originalImageBase64 } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: renderedImageBase64 } },
      { type: 'text', text: PROMPT.replace('{{ELEMENTS_JSON}}', JSON.stringify(elementsForPrompt)) },
    ]);
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.startsWith('ai-http-')) return json({ error: 'Could not verify the layout.' }, 502);
    return json({ error: 'Could not understand the AI response. Try again.' }, 502);
  }
  if (!Array.isArray(elements)) return json({ error: 'Unexpected AI response format.' }, 502);

  const clampAngle = (n) => { const v = Number(n); return Number.isFinite(v) ? Math.max(-180, Math.min(180, v)) : 0; };
  const cleaned = elements
    .filter(el => el && VALID_TYPES.includes(el.type))
    .map(el => el.type === 'room'
      ? {
          type: 'room', x: clamp01(el.x), y: clamp01(el.y), width: clamp01(el.width), height: clamp01(el.height),
          label: String(el.label || 'Room').slice(0, 80),
          label_angle: clampAngle(el.label_angle),
        }
      : { type: el.type, x1: clamp01(el.x1), y1: clamp01(el.y1), x2: clamp01(el.x2), y2: clamp01(el.y2) })
    .filter(el => el.type !== 'room' || (el.width > 0.005 && el.height > 0.005));

  return json({ elements: cleaned });
}
