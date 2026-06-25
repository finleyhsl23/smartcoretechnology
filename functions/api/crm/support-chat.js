// POST /api/crm/support-chat
// Body: { messages: [{role, content}] }
// Auth: Bearer <supabase access token>
// Proxies to Claude API for CRM support chat

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const SYSTEM_PROMPT = `You are the SmartCore CRM support assistant. You help users understand and use SmartCore CRM — a customer relationship management system built by SmartCore Technology.

SmartCore CRM includes:
- Companies: manage your customer and prospect company records
- Contacts: individual people linked to companies
- Leads: track inbound or outbound sales opportunities
- Pipeline: Kanban-style deal tracking with custom stages
- Tasks: assign and track work items across your team
- Calendar: schedule and view events
- Quotes: create and send professional quotes to customers
- Documents: upload and store files per company
- Reports: revenue and activity reporting
- Messaging: two-way email messaging with customers, threaded per company
- Reminders: set one-off or repeating reminders with email notifications
- Commands: automation rules — trigger emails or webhooks when CRM events happen (e.g. status changes, new leads)
- Settings: manage pipeline stages, email templates, plan features, appearance

If a user asks something you don't know the answer to, suggest they email support@smartcoretechnology.co.uk for further help.

Keep answers concise and helpful. Use plain language — no jargon.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'Unauthorized' }, 401);

    // Verify caller is a valid logged-in user
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return json({ ok: false, error: 'Unauthorized' }, 401);
    const userData = await userRes.json();
    if (!userData?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

    const body = await request.json();
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return json({ ok: false, error: 'Missing messages' }, 400);
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ ok: false, error: 'AI not configured' }, 500);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error('Claude API error:', err);
      return json({ ok: false, error: 'AI error' }, 500);
    }

    const data = await claudeRes.json();
    const reply = data.content?.[0]?.text || '';
    return json({ ok: true, reply });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
