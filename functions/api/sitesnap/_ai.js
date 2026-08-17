// Shared Claude vision plumbing for the floor-plan AI features (initial
// sketch-to-floorplan conversion + the verify/refine pass). Both need the
// same "send image(s) + a prompt, parse a JSON array back out, retry a
// couple of times if the response doesn't parse" behaviour.

export function extractJsonArray(text) {
  if (!text) throw new Error('empty response');
  let cleaned = text.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) cleaned = fenced[1].trim();
  try {
    const direct = JSON.parse(cleaned);
    if (Array.isArray(direct)) return direct;
  } catch {}
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('no JSON array found in response');
  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error('parsed value is not an array');
  return parsed;
}

export async function callClaudeVision(apiKey, contentBlocks, { maxTokens = 8192 } = {}) {
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
  });

  if (!aiRes.ok) {
    console.error('Anthropic error:', await aiRes.text().catch(() => ''));
    throw new Error('ai-http-' + aiRes.status);
  }

  const data = await aiRes.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  return extractJsonArray(text);
}

export async function callClaudeVisionWithRetry(apiKey, contentBlocks, opts = {}, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await callClaudeVision(apiKey, contentBlocks, opts);
    } catch (e) {
      lastError = e;
      console.error(`callClaudeVision attempt ${attempt} failed:`, e.message || e);
    }
  }
  throw lastError;
}
