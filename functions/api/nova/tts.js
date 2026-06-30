// POST /api/nova/tts
// Body: { text: string }
// Returns: audio/mpeg stream from ElevenLabs

const SUPABASE_URL  = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

// Charlotte — British female, natural sounding
const VOICE_ID = 'XB0fDUnXU5powFXDhCwa';

export async function onRequestPost(ctx) {
  const { env, request } = ctx;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim();
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response('Unauthorized', { status: 401, headers: cors });

  let text = '';
  try {
    ({ text } = await request.json());
  } catch {
    return new Response('Bad request', { status: 400, headers: cors });
  }

  text = (text || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (!text) return new Response('No text', { status: 400, headers: cors });

  if (!env.ELEVENLABS_API_KEY) {
    return new Response(JSON.stringify({ error: 'ELEVENLABS_API_KEY not configured' }), {
      status: 503,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const elRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`, {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.80,
        style: 0.25,
        use_speaker_boost: true,
      },
    }),
  });

  if (!elRes.ok) {
    const detail = await elRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'ElevenLabs error', detail }), {
      status: 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  return new Response(elRes.body, {
    headers: {
      ...cors,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'Transfer-Encoding': 'chunked',
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
