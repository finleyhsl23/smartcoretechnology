// Server-side proxy to the DVLA Vehicle Enquiry Service (VES) API.
// Runs server-side (not callable directly from the browser) because the
// DVLA API requires a secret x-api-key and does not support CORS for
// browser-originated requests.
//
// Requires a Cloudflare Pages environment variable: DVLA_API_KEY
// Apply for one free via the DVLA API Developer Portal:
// https://developer-portal.driver-vehicle-licensing.api.gov.uk/apis/vehicle-enquiry-service/Register-For-VES-API.html
// (the older register-for-ves.driver-vehicle-licensing.api.gov.uk portal has
// been retired in favour of this developer portal).
// Optional override: DVLA_API_URL (defaults to the production endpoint;
// DVLA also publish a UAT/sandbox endpoint for testing without real plates:
// https://uat.driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles).
//
// Note: DVLA does not return the vehicle's model (e.g. "Focus") — only
// make (e.g. "FORD"), year, colour, fuel type, and tax/MOT status. Model
// must still be entered by hand.

import { json, options, getCallerProfile } from './_auth.js';

export const onRequestOptions = () => options();

const DEFAULT_DVLA_URL = 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    if (!env.DVLA_API_KEY) {
      return json({ error: 'DVLA lookup is not configured yet. Ask an administrator to set the DVLA_API_KEY environment variable.' }, 501);
    }

    const body = await request.json().catch(() => ({}));
    const registration = String(body.registration || '').toUpperCase().replace(/\s+/g, '');
    if (!registration) return json({ error: 'Registration is required' }, 400);

    const dvlaRes = await fetch(env.DVLA_API_URL || DEFAULT_DVLA_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.DVLA_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ registrationNumber: registration }),
    });

    const dvlaBody = await dvlaRes.json().catch(() => ({}));

    if (dvlaRes.status === 404) {
      return json({ error: 'No vehicle found for that registration with the DVLA.' }, 404);
    }
    if (!dvlaRes.ok) {
      const message = dvlaBody?.errors?.[0]?.title || dvlaBody?.message || 'DVLA lookup failed';
      return json({ error: message }, dvlaRes.status >= 400 && dvlaRes.status < 500 ? 400 : 502);
    }

    return json(dvlaBody);
  } catch (error) {
    return json({ error: error.message || String(error) }, 500);
  }
}
