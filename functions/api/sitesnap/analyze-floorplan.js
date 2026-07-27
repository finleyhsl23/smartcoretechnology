// POST /api/sitesnap/analyze-floorplan { companyId, imageBase64, mimeType }
// Reads a hand-drawn/sketched floor plan image with Claude's vision and
// returns walls/doors/windows/rooms as coordinates normalized 0-1 against
// the image itself — the client maps those into the exact canvas rect the
// image is displayed at. This is a best-effort AI read of a sketch, not
// precise CAD extraction, and the client-side copy says so.
import { json, options, getCallerProfile } from './_auth.js';

const ADMIN_ROLES = ['owner', 'admin', 'administrator'];

const PROMPT = `You are reading a hand-drawn or sketched architectural floor plan image and converting it into structured data.

Return ONLY a JSON array — no markdown fences, no prose, nothing before or after it. Each element in the array is one of these shapes:

{"type":"wall","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"door","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"window","x1":0.0,"y1":0.0,"x2":0.0,"y2":0.0}
{"type":"room","x":0.0,"y":0.0,"width":0.0,"height":0.0,"label":"Bedroom"}

All coordinates are normalized to the image itself: (0,0) is the top-left corner of the image, (1,1) is the bottom-right corner, regardless of the image's actual pixel size.

Identify every wall segment you can see (both exterior and interior walls) as line elements. Identify door openings (gaps in a wall, often with a swing arc) and window openings (breaks in a wall, often with parallel lines) as short line elements at their location on the wall. Identify every enclosed room as a rectangle — use the closest bounding rectangle if the room isn't a perfect rectangle — and use whatever label/name is written on the sketch for that room (e.g. "Kitchen", "Bedroom 1"); if no label is visible, invent a short sensible one based on typical room layout (e.g. "Room 1", "Hallway").

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

  let aiRes;
  try {
    aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
  } catch (e) {
    return json({ error: 'Could not reach the AI service.' }, 502);
  }

  if (!aiRes.ok) {
    console.error('Anthropic error:', await aiRes.text().catch(() => ''));
    return json({ error: 'Could not analyze the image.' }, 502);
  }

  const data = await aiRes.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  let elements;
  try {
    const match = text.match(/\[[\s\S]*\]/);
    elements = JSON.parse(match ? match[0] : text);
  } catch {
    return json({ error: 'Could not understand the AI response. Try a clearer image.' }, 502);
  }
  if (!Array.isArray(elements)) return json({ error: 'Unexpected AI response format.' }, 502);

  const VALID_TYPES = ['wall', 'door', 'window', 'room'];
  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  const cleaned = elements
    .filter(el => el && VALID_TYPES.includes(el.type))
    .map(el => el.type === 'room'
      ? { type: 'room', x: clamp01(el.x), y: clamp01(el.y), width: clamp01(el.width), height: clamp01(el.height), label: String(el.label || 'Room').slice(0, 80) }
      : { type: el.type, x1: clamp01(el.x1), y1: clamp01(el.y1), x2: clamp01(el.x2), y2: clamp01(el.y2) })
    .filter(el => el.type !== 'room' || (el.width > 0.005 && el.height > 0.005));

  return json({ elements: cleaned });
}
