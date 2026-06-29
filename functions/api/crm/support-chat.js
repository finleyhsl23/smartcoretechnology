// POST /api/crm/support-chat
// Body: { messages: [{role, content}] }
// Auth: Bearer <supabase access token>
// Proxies to Claude API with tool use for live CRM data queries

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const SYSTEM_PROMPT = `You are the SmartCore CRM support assistant — a helpful, friendly assistant built into the SmartCore CRM system by SmartCore Technology (smartcoretechnology.co.uk).

IMPORTANT FORMATTING RULES:
- Never use markdown. No asterisks, no bold, no headers, no bullet dashes, no backticks.
- Write in plain conversational sentences and short paragraphs.
- If you need to list things, use plain numbered lines like "1. Do this" on separate lines.
- Keep answers short and to the point.

DATA ACCESS:
You have tools to search the live CRM database. Use them whenever someone asks about specific records — contacts, companies, leads, tasks, quotes, or pipeline deals. When showing results, present them in a clean readable way without markdown. If a search returns no results, say so clearly and suggest they check their search terms.

ABOUT SMARTCORE CRM:
SmartCore CRM is a full business CRM system. Here is everything about it:

NAVIGATION:
The sidebar on the left has all the main pages. The sections are: Main (Dashboard, Companies, Contacts, Leads, Pipeline, Tasks), Features (Calendar, Quotes, Documents, Reports, Customer Portal, Messaging, Projects), and System (Reminders, Commands, Settings). There is also a Support button at the bottom left above the user profile — that opens this chat.

DASHBOARD:
Shows a summary of the business. Includes total companies, open leads, pipeline value, tasks due today, recent activity, and quick links to other pages.

COMPANIES:
The main record for each business you work with. Each company has: name, industry, email, phone, website, status (Prospect / Active / Inactive / Churned), company value, assigned team member, address, postcode, customer since date, and notes. You can view, add, edit, or delete companies. Clicking a company name opens the company detail page which shows all contacts, leads, tasks, documents, quotes, and messages linked to that company. When a company status is updated, Commands can fire automatically.

CONTACTS:
Individual people linked to companies. Each contact has: name, job title, email, phone, and which company they belong to. You can add, edit, and delete contacts.

LEADS:
Sales opportunities. Each lead has: title, company, contact, status (New / Contacted / Qualified / Proposal / Won / Lost), value, source, assigned to, notes, and expected close date. You can filter by status and search. Leads can trigger Commands when their status changes.

PIPELINE:
A Kanban board showing deals as cards in columns by stage. You can drag cards between stages. Stages are customisable in Settings. Each card shows the deal name, company, value, and assigned person.

TASKS:
Work items assigned to team members. Each task has: title, description, due date, priority (Low / Medium / High / Urgent), status (To Do / In Progress / Done), and linked company or contact. You can filter tasks by status and priority.

CALENDAR:
A monthly/weekly calendar showing scheduled events. You can add events with a title, date, time, and notes.

QUOTES:
Create professional quotes to send to customers. Each quote has: a reference number, linked company, line items (description, quantity, unit price), subtotal, VAT, and total. Quotes can be marked as Draft, Sent, Accepted, or Declined. You can view a formatted quote and send it to the customer.

DOCUMENTS:
Upload and store files against companies. Supports PDFs, images, Word docs, spreadsheets, and more. Max file size is 50MB. Files are stored in Supabase storage.

REPORTS:
Shows revenue and activity data. Includes charts for pipeline value by stage, lead conversion rates, revenue over time, and task completion rates.

CUSTOMER PORTAL:
Allows customers to log in and view their account. Currently the messaging feature is live. A full self-service portal with project tracking and e-signatures is coming soon.

MESSAGING:
Two-way email messaging with customers, one thread per company. Staff send messages from inside the CRM. The customer receives an email and can reply — their reply appears in the thread automatically. There is a Refresh button in the thread header to manually reload messages (useful on iPhone where auto-refresh can be slow). Commands can fire when a new customer message arrives.

REMINDERS:
Set reminders for yourself or your team. Each reminder has: subject, notes, date, time, and repeat interval (none / daily / weekly / monthly / yearly). When a reminder is due, an email is sent automatically. You can edit a future reminder to change its date, time, subject, or notes. Sent reminders show when they were sent. Repeating reminders automatically reschedule to the next occurrence after sending.

COMMANDS (Automations):
Automation rules that fire when something happens in the CRM. Each command has a name, a trigger, an optional trigger value filter, an action (Send email, Notify team, or Webhook), email recipients (specific addresses, your whole team, or the customer), and an optional company filter to restrict which companies it fires for.

SETTINGS:
Manage your CRM configuration. Tabs include General, Plan and Features, Pipeline Stages, Email Templates, and Appearance.

PLANS:
- CRM Lite: Dashboard, Companies, Contacts, Leads, Pipeline, Tasks
- CRM Professional: adds Calendar, Quotes, Documents, Reports, Email Templates
- CRM Business: adds Customer Portal, Messaging, Projects
- CRM Enterprise: full access to all features

SUPPORT:
If someone needs help beyond what this assistant can answer, they should email support@smartcoretechnology.co.uk.

Always answer as if you know this system inside out. Be friendly, concise, and helpful. Never use markdown formatting.`;

const TOOLS = [
  {
    name: 'search_companies',
    description: 'Search companies in the CRM. Use when the user asks about a specific company or wants to find companies by name, status, or industry.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Company name to search for (partial match)' },
        status: { type: 'string', description: 'Filter by status: prospect, active, inactive, churned' },
        industry: { type: 'string', description: 'Filter by industry' },
      },
    },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts in the CRM. Use when the user asks about a specific person or wants to find contacts by name, email, or company.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact name to search for (partial match)' },
        email: { type: 'string', description: 'Email address to search for' },
        company_name: { type: 'string', description: 'Name of the company the contact works at' },
      },
    },
  },
  {
    name: 'search_leads',
    description: 'Search leads in the CRM. Use when the user asks about sales opportunities or leads.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Lead title to search for (partial match)' },
        status: { type: 'string', description: 'Filter by status: new, contacted, qualified, proposal, won, lost' },
        company_name: { type: 'string', description: 'Name of the company the lead is for' },
      },
    },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks in the CRM. Use when the user asks about tasks or to-do items.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title to search for (partial match)' },
        status: { type: 'string', description: 'Filter by status: todo, in_progress, done' },
        priority: { type: 'string', description: 'Filter by priority: low, medium, high, urgent' },
      },
    },
  },
  {
    name: 'search_quotes',
    description: 'Search quotes in the CRM. Use when the user asks about quotes or proposals.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Name of the company the quote is for' },
        status: { type: 'string', description: 'Filter by status: draft, sent, accepted, declined' },
      },
    },
  },
  {
    name: 'get_pipeline_deals',
    description: 'Get deals in the pipeline. Use when the user asks about pipeline, deals, or stages.',
    input_schema: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Filter by pipeline stage name' },
        company_name: { type: 'string', description: 'Filter by company name' },
      },
    },
  },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

async function runTool(toolName, input, tenantId, svcHdr) {
  try {
    const base = `${SUPABASE_URL}/rest/v1`;

    if (toolName === 'search_companies') {
      let url = `${base}/crm_companies?tenant_id=eq.${tenantId}&select=name,status,industry,email,phone,company_value&limit=20&order=name`;
      if (input.name) url += `&name=ilike.*${encodeURIComponent(input.name)}*`;
      if (input.status) url += `&status=eq.${encodeURIComponent(input.status)}`;
      if (input.industry) url += `&industry=ilike.*${encodeURIComponent(input.industry)}*`;
      const res = await fetch(url, { headers: svcHdr });
      const data = await res.json();
      if (!data.length) return 'No companies found matching that search.';
      return data.map(c => `${c.name} — ${c.status}${c.industry ? `, ${c.industry}` : ''}${c.email ? `, ${c.email}` : ''}${c.company_value ? `, value: £${c.company_value}` : ''}`).join('\n');
    }

    if (toolName === 'search_contacts') {
      let url = `${base}/crm_contacts?tenant_id=eq.${tenantId}&select=full_name,email,phone,job_title,crm_companies(name)&limit=20&order=full_name`;
      if (input.name) url += `&full_name=ilike.*${encodeURIComponent(input.name)}*`;
      if (input.email) url += `&email=ilike.*${encodeURIComponent(input.email)}*`;
      const res = await fetch(url, { headers: svcHdr });
      const data = await res.json();
      if (!data.length) return 'No contacts found matching that search.';
      return data.map(c => `${c.full_name}${c.job_title ? `, ${c.job_title}` : ''}${c.crm_companies?.name ? ` at ${c.crm_companies.name}` : ''}${c.email ? ` — ${c.email}` : ''}${c.phone ? `, ${c.phone}` : ''}`).join('\n');
    }

    if (toolName === 'search_leads') {
      let url = `${base}/crm_leads?tenant_id=eq.${tenantId}&select=title,status,value,source,crm_companies(name)&limit=20&order=created_at.desc`;
      if (input.title) url += `&title=ilike.*${encodeURIComponent(input.title)}*`;
      if (input.status) url += `&status=eq.${encodeURIComponent(input.status)}`;
      const res = await fetch(url, { headers: svcHdr });
      const data = await res.json();
      if (!data.length) return 'No leads found matching that search.';
      return data.map(l => `${l.title} — ${l.status}${l.crm_companies?.name ? ` (${l.crm_companies.name})` : ''}${l.value ? `, £${l.value}` : ''}`).join('\n');
    }

    if (toolName === 'search_tasks') {
      let url = `${base}/crm_tasks?tenant_id=eq.${tenantId}&select=title,status,priority,due_date,crm_companies(name)&limit=20&order=due_date`;
      if (input.title) url += `&title=ilike.*${encodeURIComponent(input.title)}*`;
      if (input.status) url += `&status=eq.${encodeURIComponent(input.status)}`;
      if (input.priority) url += `&priority=eq.${encodeURIComponent(input.priority)}`;
      const res = await fetch(url, { headers: svcHdr });
      const data = await res.json();
      if (!data.length) return 'No tasks found matching that search.';
      return data.map(t => `${t.title} — ${t.status}, ${t.priority} priority${t.crm_companies?.name ? ` (${t.crm_companies.name})` : ''}${t.due_date ? `, due ${t.due_date}` : ''}`).join('\n');
    }

    if (toolName === 'search_quotes') {
      let url = `${base}/crm_quotes?tenant_id=eq.${tenantId}&select=quote_number,status,total,crm_companies(name)&limit=20&order=created_at.desc`;
      if (input.status) url += `&status=eq.${encodeURIComponent(input.status)}`;
      const res = await fetch(url, { headers: svcHdr });
      let data = await res.json();
      if (input.company_name) data = data.filter(q => q.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No quotes found matching that search.';
      return data.map(q => `Quote ${q.quote_number || ''} — ${q.status}${q.crm_companies?.name ? ` for ${q.crm_companies.name}` : ''}${q.total ? `, £${q.total}` : ''}`).join('\n');
    }

    if (toolName === 'get_pipeline_deals') {
      let url = `${base}/crm_pipeline_deals?tenant_id=eq.${tenantId}&select=name,stage,value,crm_companies(name)&limit=20&order=created_at.desc`;
      if (input.stage) url += `&stage=ilike.*${encodeURIComponent(input.stage)}*`;
      const res = await fetch(url, { headers: svcHdr });
      let data = await res.json();
      if (input.company_name) data = data.filter(d => d.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No pipeline deals found matching that search.';
      return data.map(d => `${d.name} — ${d.stage}${d.crm_companies?.name ? ` (${d.crm_companies.name})` : ''}${d.value ? `, £${d.value}` : ''}`).join('\n');
    }

    return 'Unknown tool.';
  } catch (e) {
    return `Search error: ${e.message}`;
  }
}

export async function onRequestPost(context) {
  const { env, request } = context;

  try {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, error: 'Unauthorized' }, 401);

    // Verify caller and get their profile
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return json({ ok: false, error: 'Unauthorized' }, 401);
    const userData = await userRes.json();
    if (!userData?.id) return json({ ok: false, error: 'Unauthorized' }, 401);

    const svcHdr = {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Get tenant_id from employee profile
    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${userData.id}&select=company_id&limit=1`,
      { headers: svcHdr }
    );
    const profData = await profRes.json();
    const tenantId = profData?.[0]?.company_id;
    if (!tenantId) return json({ ok: false, error: 'Profile not found' }, 403);

    const body = await request.json();
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return json({ ok: false, error: 'Missing messages' }, 400);
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ ok: false, error: 'AI not configured' }, 500);

    // Agentic loop — allow Claude to call tools up to 5 times
    let currentMessages = [...messages];
    let reply = '';

    for (let i = 0; i < 5; i++) {
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
          tools: TOOLS,
          messages: currentMessages,
        }),
      });

      if (!claudeRes.ok) {
        const err = await claudeRes.text();
        console.error('Claude API error:', err);
        return json({ ok: false, error: 'AI error' }, 500);
      }

      const data = await claudeRes.json();

      if (data.stop_reason === 'end_turn') {
        reply = data.content?.find(b => b.type === 'text')?.text || '';
        break;
      }

      if (data.stop_reason === 'tool_use') {
        const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
        const assistantMsg = { role: 'assistant', content: data.content };
        currentMessages = [...currentMessages, assistantMsg];

        const toolResults = await Promise.all(toolUseBlocks.map(async tb => ({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: await runTool(tb.name, tb.input, tenantId, svcHdr),
        })));

        currentMessages = [...currentMessages, { role: 'user', content: toolResults }];
        continue;
      }

      // Fallback — grab any text
      reply = data.content?.find(b => b.type === 'text')?.text || '';
      break;
    }

    return json({ ok: true, reply });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
