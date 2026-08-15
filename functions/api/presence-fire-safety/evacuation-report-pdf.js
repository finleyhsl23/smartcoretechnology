// POST /api/presence-fire-safety/evacuation-report-pdf
// Returns the same photo evacuation report PDF that's emailed by
// notify-evacuation-completed.js, as a raw application/pdf response — used
// by the client to open the report itself right after completing an
// evacuation, and to re-download past reports from evacuation history.
import { json, options, getCallerProfile, hasPermission } from './_auth.js';
import { buildEvacuationReportPdf } from './_evacuation-report-pdf.js';

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  let profile;
  try {
    profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorized' }, 401);
  } catch (e) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.view_live_register');
    if (!allowed) return json({ error: 'Missing permission: presence.view_live_register' }, 403);

    const body = await request.json().catch(() => ({}));
    const sessionId = body.evacuation_session_id;
    if (!sessionId) return json({ error: 'evacuation_session_id is required' }, 400);

    const { bytes, filename } = await buildEvacuationReportPdf(env, profile.company_id, sessionId);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    console.error('evacuation-report-pdf:', e.message);
    return json({ error: e.message || 'Could not generate the evacuation report' }, 500);
  }
}
