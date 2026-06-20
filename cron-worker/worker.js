/**
 * SmartCore Cron Worker
 * Runs daily at 08:00 UTC and calls all scheduled Pages Function endpoints.
 * Deploy separately with: wrangler deploy (from /cron-worker directory)
 */

const SITE = 'https://smartcoretechnology.co.uk';

const CRON_JOBS = [
  { name: 'Invoice generator', path: '/api/cron-invoice' },
  { name: 'Reminder emails',   path: '/api/cron-reminders' },
];

export default {
  // Scheduled trigger — fires on the cron schedule in wrangler.toml
  async scheduled(event, env, ctx) {
    const results = await runAllJobs(env);
    console.log('SmartCore cron complete:', JSON.stringify(results));
  },

  // HTTP trigger — GET /  — for manual testing from HQ or curl
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Simple auth check via secret query param or header
    const token = url.searchParams.get('token') || request.headers.get('x-cron-token');
    if (token !== env.CRON_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const results = await runAllJobs(env);
    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function runAllJobs(env) {
  const results = [];

  for (const job of CRON_JOBS) {
    const start = Date.now();
    try {
      const res = await fetch(`${SITE}${job.path}`, {
        method: 'GET',
        headers: {
          'x-cron-token': env.CRON_SECRET,
          'User-Agent': 'SmartCore-Cron/1.0',
        },
      });
      const body = await res.text();
      results.push({
        job: job.name,
        status: res.status,
        ok: res.ok,
        ms: Date.now() - start,
        response: tryJson(body),
      });
    } catch (err) {
      results.push({
        job: job.name,
        status: 0,
        ok: false,
        ms: Date.now() - start,
        error: err.message,
      });
    }
  }

  return results;
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}
