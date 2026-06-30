// POST /api/nova/tts
// Body: { text: string }
// Returns: audio/mpeg from OpenAI TTS

const SUPABASE_URL  = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim();
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response('Unauthorized', { status: 401, headers: cors });

  let text = '';
  try { ({ text } = await request.json()); } catch {
    return new Response('Bad request', { status: 400, headers: cors });
  }

  text = (text || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 4096);
  if (!text) return new Response('No text', { status: 400, headers: cors });

  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const oaiRes = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1-hd',
      voice: 'onyx',
      input: text,
      speed: 0.95,
    }),
  });

  if (!oaiRes.ok) {
    const detail = await oaiRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'OpenAI TTS error', detail }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(oaiRes.body, {
    headers: {
      ...cors,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
