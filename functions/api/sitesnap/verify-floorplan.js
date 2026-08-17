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

const PROMPT = `You previously converted a hand-drawn floor plan sketch (the first image) into a structured floor plan made of walls, doors, windows and rooms. The second image is a plain rendering of the elements as currently placed, in the exact same normalized coordinate space as the sketch — a thin outlined rectangle in the second image marks the same area the sketch occupies in the first, so you can line the two up. In the rendering: filled grey rectangles with a label are rooms, thick white lines are walls, short dashed lines are doors or windows.

Your job is to be a strict, critical reviewer — do not assume the current placement is correct just because something is already there. Compare the two images pixel-region by pixel-region and actively look for these specific problems, which are common in a first-pass conversion:
- A room's rectangle in the rendering doesn't line up with where that room's walls actually are in the sketch (wrong position, wrong size, or an edge that should sit on a wall but doesn't).
- A door or window line is NOT collinear with (lying directly on top of) the wall it's supposed to interrupt — e.g. it's floating diagonally in the middle of a room instead of sitting on a wall. This is the most common error: check every single door/window against the sketch and snap it onto its wall if it's off.
- A room, wall, door or window from the sketch is missing entirely from the rendering, or an element in the rendering doesn't correspond to anything actually drawn in the sketch.
- A room's label text is clipped, overlaps a neighbouring room, or is hard to read — if the room is too narrow or long for horizontal text, set "label_angle" (degrees, e.g. 90) to rotate it along the room's long axis instead.

Fix every problem you find by changing that element's coordinates (and label_angle where relevant) so the rendering would actually match the sketch. Do not leave something unchanged just because it's "close enough" — if it's visibly off, correct it.

Current elements (normalized 0-1 coordinates):
{{ELEMENTS_JSON}}

Return ONLY a corrected JSON array — no markdown fences, no prose, nothing before or after it — using this exact schema:

{"type":"wall","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"door","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"window","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"room","x":0.0,"y":0.0,"width":0.0,"height":0.0,"label":"Bedroom","label_angle":0}

Return every element that should exist in the final, corrected result — this is a full replacement, not a diff, so include unchanged elements too, not just the ones you fixed.`;

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
