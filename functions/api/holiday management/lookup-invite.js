import { jsonResponse, handleOptions, supabaseRpc } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return jsonResponse({ error: 'token is required.' }, 400);

    const result = await supabaseRpc(env, 'holidaymanagement.get_invite_by_token', { p_token: token });
    return jsonResponse({ ok: true, invite: Array.isArray(result) ? result[0] || null : result });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to look up invite.', details: error.details || null }, 500);
  }
}
