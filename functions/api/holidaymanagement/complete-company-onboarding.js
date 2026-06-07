import { jsonResponse, handleOptions, supabaseRpc } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json();
    if (!payload.token) return jsonResponse({ error: 'Onboarding token is required.' }, 400);

    const result = await supabaseRpc(env, 'holidaymanagement.complete_company_onboarding', { payload });
    return jsonResponse({ ok: true, result });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to complete company onboarding.', details: error.details || null }, 500);
  }
}
