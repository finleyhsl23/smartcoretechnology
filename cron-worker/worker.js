/**
 * SmartCore Cron Worker
 * Two schedules (see wrangler.toml): daily jobs at 08:00 UTC, and a
 * frequent (every-15-min) tick for jobs whose timing is per-record rather
 * than a fixed UTC time.
 * Deploy separately with: wrangler deploy (from /cron-worker directory)
 */

const SITE = 'https://smartcoretechnology.co.uk';

const DAILY_JOBS = [
  { name: 'Invoice generator', path: '/api/cron-invoice' },
  { name: 'Reminder emails',   path: '/api/cron-reminders' },
  { name: 'Convoy compliance reminders', path: '/api/convoy/cron-compliance-reminders' },
];

const FREQUENT_JOBS = [
  // Each site configures its own local sign-out time, so this can't be a
  // single daily UTC firing — it has to check in often enough to catch
  // every site's moment as it comes up in that site's own timezone.
  { name: 'Presence auto sign-out', path: '/api/presence-fire-safety/cron-auto-sign-out' },
];

export default {
  // Scheduled trigger — fires on each cron schedule in wrangler.toml
  async scheduled(event, env, ctx) {
    const jobs = event.cron === '*/15 * * * *' ? FREQUENT_JOBS : DAILY_JOBS;
    const results = await runJobs(jobs, env);
    console.log('SmartCore cron complete:', event.cron, JSON.stringify(results));
  },

  // HTTP trigger — GET /  — for manual testing from HQ or curl. Runs
  // everything regardless of schedule, since there's no cron context here.
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

    const results = await runJobs([...DAILY_JOBS, ...FREQUENT_JOBS], env);
    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function runJobs(jobs, env) {
  const results = [];

  for (const job of jobs) {
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
