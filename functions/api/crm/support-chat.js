// POST /api/crm/support-chat
// Body: { messages: [{role, content}] }
// Auth: Bearer <supabase access token>

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const SYSTEM_PROMPT = `You are the SmartCore CRM support assistant. You help users with questions about SmartCore CRM features, how to use the system, and troubleshoot common issues.

SmartCore CRM features include: Companies, Contacts, Leads, Pipeline (Kanban board), Tasks, Calendar, Quotes, Documents, Reports & Analytics, Customer Portal, Messaging, Commands/Automations, and Settings.

Tiers:
- CRM Lite (£19.99/mo): Dashboard, Companies, Contacts, Leads, Pipeline, Tasks, Timeline
- CRM Professional (£39.99/mo): Adds Calendar, Quotes, Documents, Reports, Email Templates, Lead Scoring, Revenue Forecasting
- CRM Business (£69.99/mo): Adds Customer Portal, Messaging, Projects, Custom Fields, Workflows
- CRM Enterprise (£149.99/mo): Full access including AI Support, Advanced Analytics, API Access, Audit Logs

Be concise, friendly, and helpful. If you don't know something specific about SmartCore, suggest contacting support@smartcoretechnology.co.uk.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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

export async function onRequestPost(context) {
  try {
    const { env, request } = context;

    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'Unauthorized' }, 401);

    // Verify user
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return json({ ok: false, error: 'Unauthorized' }, 401);
    const userData = await userRes.json();
    if (!userData?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return json({ ok: false, error: 'No messages' }, 400);

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ ok: false, error: 'AI not configured' }, 500);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: SYSTEM_PROMPT,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    if (!aiRes.ok) {
      const err = await aiRes.text();
      console.error('Anthropic error:', err);
      return json({ ok: false, error: 'AI error' }, 502);
    }

    const aiJson = await aiRes.json();
    const reply = aiJson.content?.[0]?.text || '';
    return json({ ok: true, reply });
  } catch (e) {
    console.error('support-chat error:', e);
    return json({ ok: false, error: e.message }, 500);
  }
}
