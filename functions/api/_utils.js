export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json'
    }
  });
}

export function json(data, status = 200) {
  return jsonResponse(data, status);
}

export function bad(message = 'Bad request', status = 400, extra = {}) {
  return jsonResponse({ error: message, ...extra }, status);
}

export function requireEnv(env, name) {
  const value = env?.[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export function supaHeaders(env, useServiceRole = true) {
  const key = useServiceRole
    ? env.SUPABASE_SERVICE_ROLE
    : env.SUPABASE_ANON;

  if (!key) {
    throw new Error(
      useServiceRole
        ? 'Missing SUPABASE_SERVICE_ROLE'
        : 'Missing SUPABASE_ANON'
    );
  }

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}
