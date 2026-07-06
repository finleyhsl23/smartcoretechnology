// POST /api/crm/support-chat
// Body: { messages: [{role, content}], tenant_id }
// Auth: Bearer <supabase access token>

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const SYSTEM_PROMPT = `You are the SmartCore CRM AI assistant. You have full access to the user's CRM data and can read, create, update, and delete records on their behalf.

When users ask you to do something (add a company, create a task, schedule a meeting, etc.) — do it immediately using the available tools. Don't just explain how; take action.

Be concise and friendly. After completing an action, confirm what you did in one sentence. Use **bold** for company names, lead titles, and key values.

Today's date: ${new Date().toISOString().slice(0, 10)}`;

const TOOLS = [
  {
    name: "list_companies",
    description: "List or search companies in the CRM",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional name search" },
        status: { type: "string", description: "Filter by status: active, inactive, prospect, churned" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "create_company",
    description: "Create a new company in the CRM",
    input_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        status: { type: "string", description: "active, inactive, prospect, churned" },
        company_value: { type: "number" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "update_company",
    description: "Update an existing company",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        industry: { type: "string" },
        website: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        status: { type: "string" },
        company_value: { type: "number" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "delete_company",
    description: "Delete a company by ID",
    input_schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "list_contacts",
    description: "List or search contacts",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string" },
        company_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_contact",
    description: "Create a new contact",
    input_schema: {
      type: "object",
      required: ["first_name", "last_name"],
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        job_title: { type: "string" },
        crm_company_id: { type: "string", description: "Company UUID to link this contact to" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "update_contact",
    description: "Update an existing contact",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        job_title: { type: "string" },
        crm_company_id: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "delete_contact",
    description: "Delete a contact by ID",
    input_schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "list_leads",
    description: "List or search leads/opportunities",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string" },
        status: { type: "string", description: "new, contacted, qualified, proposal_sent, negotiation, won, lost" },
        stage: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_lead",
    description: "Create a new lead/opportunity",
    input_schema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        status: { type: "string", description: "new, contacted, qualified, proposal_sent, negotiation, won, lost" },
        pipeline_stage: { type: "string" },
        estimated_value: { type: "number" },
        probability: { type: "number", description: "0-100" },
        source: { type: "string" },
        crm_company_id: { type: "string" },
        crm_contact_id: { type: "string" },
        notes: { type: "string" },
        expected_close_date: { type: "string", description: "ISO date string" },
      },
    },
  },
  {
    name: "update_lead",
    description: "Update a lead/opportunity",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        pipeline_stage: { type: "string" },
        estimated_value: { type: "number" },
        probability: { type: "number" },
        notes: { type: "string" },
        expected_close_date: { type: "string" },
      },
    },
  },
  {
    name: "delete_lead",
    description: "Delete a lead by ID",
    input_schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "list_tasks",
    description: "List tasks",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "pending, in_progress, completed" },
        priority: { type: "string", description: "low, medium, high, urgent" },
        due_today: { type: "boolean" },
        company_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_task",
    description: "Create a new task",
    input_schema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string", description: "pending, in_progress, completed" },
        priority: { type: "string", description: "low, medium, high, urgent" },
        due_date: { type: "string", description: "ISO datetime string" },
        crm_company_id: { type: "string" },
        crm_lead_id: { type: "string" },
      },
    },
  },
  {
    name: "update_task",
    description: "Update a task",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        priority: { type: "string" },
        due_date: { type: "string" },
      },
    },
  },
  {
    name: "delete_task",
    description: "Delete a task by ID",
    input_schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "list_events",
    description: "List calendar events",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO datetime, start of range" },
        to: { type: "string", description: "ISO datetime, end of range" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_event",
    description: "Create a calendar event",
    input_schema: {
      type: "object",
      required: ["title", "start_time"],
      properties: {
        title: { type: "string" },
        start_time: { type: "string", description: "ISO datetime" },
        end_time: { type: "string", description: "ISO datetime" },
        type: { type: "string", description: "meeting, call, demo, other" },
        description: { type: "string" },
        location: { type: "string" },
        crm_company_id: { type: "string" },
        crm_contact_id: { type: "string" },
        crm_lead_id: { type: "string" },
      },
    },
  },
  {
    name: "update_event",
    description: "Update a calendar event",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        start_time: { type: "string" },
        end_time: { type: "string" },
        type: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
      },
    },
  },
  {
    name: "delete_event",
    description: "Delete a calendar event by ID",
    input_schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "list_quotes",
    description: "List quotes",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "draft, sent, accepted, rejected, expired" },
        company_id: { type: "string" },
        limit: { type: "number" },
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

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ── Supabase REST helpers ───────────────────────────────────

function svc(env) {
  return {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function sbGet(env, table, params = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, { headers: svc(env) });
  return r.json();
}

async function sbPost(env, table, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: svc(env), body: JSON.stringify(body),
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { error: text }; }
}

async function sbPatch(env, table, id, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH', headers: { ...svc(env), Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  const text = await r.text();
  try { const d = JSON.parse(text); return Array.isArray(d) ? d[0] : d; } catch { return { error: text }; }
}

async function sbDelete(env, table, id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE', headers: svc(env),
  });
  return r.ok ? { ok: true } : { error: await r.text() };
}

// ── Tool execution ──────────────────────────────────────────

async function executeTool(name, input, env, tenantId, userId) {
  const base = { tenant_id: tenantId, created_by: userId };

  switch (name) {
    case 'list_companies': {
      let p = `?tenant_id=eq.${tenantId}&order=name&limit=${input.limit || 50}`;
      if (input.search) p += `&name=ilike.*${encodeURIComponent(input.search)}*`;
      if (input.status) p += `&status=eq.${input.status}`;
      const data = await sbGet(env, 'crm_companies', p);
      return Array.isArray(data) ? data.map(c => ({ id: c.id, name: c.name, status: c.status, industry: c.industry, email: c.email, phone: c.phone, website: c.website, company_value: c.company_value })) : data;
    }
    case 'create_company': {
      const data = await sbPost(env, 'crm_companies', { ...base, ...input });
      const r = Array.isArray(data) ? data[0] : data;
      return r?.id ? { ok: true, id: r.id, name: r.name } : { error: r?.message || JSON.stringify(r) };
    }
    case 'update_company': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_companies', id, { ...fields, updated_at: new Date().toISOString() });
      return r?.id ? { ok: true, id: r.id, name: r.name } : { error: r?.message || JSON.stringify(r) };
    }
    case 'delete_company':
      return sbDelete(env, 'crm_companies', input.id);

    case 'list_contacts': {
      let p = `?tenant_id=eq.${tenantId}&order=first_name&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.company_id) p += `&crm_company_id=eq.${input.company_id}`;
      if (input.search) p += `&or=(first_name.ilike.*${encodeURIComponent(input.search)}*,last_name.ilike.*${encodeURIComponent(input.search)}*,email.ilike.*${encodeURIComponent(input.search)}*)`;
      const data = await sbGet(env, 'crm_contacts', p);
      return Array.isArray(data) ? data.map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name}`, email: c.email, phone: c.phone, job_title: c.job_title, company: c.crm_companies?.name })) : data;
    }
    case 'create_contact': {
      const data = await sbPost(env, 'crm_contacts', { ...base, ...input });
      const r = Array.isArray(data) ? data[0] : data;
      return r?.id ? { ok: true, id: r.id, name: `${r.first_name} ${r.last_name}` } : { error: r?.message || JSON.stringify(r) };
    }
    case 'update_contact': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_contacts', id, { ...fields, updated_at: new Date().toISOString() });
      return r?.id ? { ok: true, id: r.id } : { error: r?.message || JSON.stringify(r) };
    }
    case 'delete_contact':
      return sbDelete(env, 'crm_contacts', input.id);

    case 'list_leads': {
      let p = `?tenant_id=eq.${tenantId}&order=created_at.desc&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.status) p += `&status=eq.${input.status}`;
      if (input.stage) p += `&pipeline_stage=eq.${input.stage}`;
      if (input.search) p += `&title=ilike.*${encodeURIComponent(input.search)}*`;
      const data = await sbGet(env, 'crm_leads', p);
      return Array.isArray(data) ? data.map(l => ({ id: l.id, title: l.title, status: l.status, stage: l.pipeline_stage, value: l.estimated_value, probability: l.probability, company: l.crm_companies?.name })) : data;
    }
    case 'create_lead': {
      const data = await sbPost(env, 'crm_leads', { ...base, status: 'new', pipeline_stage: 'new', ...input });
      const r = Array.isArray(data) ? data[0] : data;
      return r?.id ? { ok: true, id: r.id, title: r.title } : { error: r?.message || JSON.stringify(r) };
    }
    case 'update_lead': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_leads', id, { ...fields, updated_at: new Date().toISOString() });
      return r?.id ? { ok: true, id: r.id } : { error: r?.message || JSON.stringify(r) };
    }
    case 'delete_lead':
      return sbDelete(env, 'crm_leads', input.id);

    case 'list_tasks': {
      let p = `?tenant_id=eq.${tenantId}&order=due_date&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.status) p += `&status=eq.${input.status}`;
      if (input.priority) p += `&priority=eq.${input.priority}`;
      if (input.company_id) p += `&crm_company_id=eq.${input.company_id}`;
      if (input.due_today) {
        const today = new Date().toISOString().slice(0, 10);
        p += `&due_date=gte.${today}T00:00:00&due_date=lte.${today}T23:59:59`;
      }
      const data = await sbGet(env, 'crm_tasks', p);
      return Array.isArray(data) ? data.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, company: t.crm_companies?.name })) : data;
    }
    case 'create_task': {
      const data = await sbPost(env, 'crm_tasks', { ...base, status: 'pending', priority: 'medium', ...input });
      const r = Array.isArray(data) ? data[0] : data;
      return r?.id ? { ok: true, id: r.id, title: r.title } : { error: r?.message || JSON.stringify(r) };
    }
    case 'update_task': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_tasks', id, { ...fields, updated_at: new Date().toISOString() });
      return r?.id ? { ok: true, id: r.id } : { error: r?.message || JSON.stringify(r) };
    }
    case 'delete_task':
      return sbDelete(env, 'crm_tasks', input.id);

    case 'list_events': {
      let p = `?tenant_id=eq.${tenantId}&order=start_time&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.from) p += `&start_time=gte.${input.from}`;
      if (input.to) p += `&start_time=lte.${input.to}`;
      const data = await sbGet(env, 'crm_events', p);
      return Array.isArray(data) ? data.map(e => ({ id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time, type: e.type, location: e.location, company: e.crm_companies?.name })) : data;
    }
    case 'create_event': {
      const data = await sbPost(env, 'crm_events', { ...base, type: 'meeting', ...input });
      const r = Array.isArray(data) ? data[0] : data;
      return r?.id ? { ok: true, id: r.id, title: r.title, start_time: r.start_time } : { error: r?.message || JSON.stringify(r) };
    }
    case 'update_event': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_events', id, { ...fields, updated_at: new Date().toISOString() });
      return r?.id ? { ok: true, id: r.id } : { error: r?.message || JSON.stringify(r) };
    }
    case 'delete_event':
      return sbDelete(env, 'crm_events', input.id);

    case 'list_quotes': {
      let p = `?tenant_id=eq.${tenantId}&order=created_at.desc&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.status) p += `&status=eq.${input.status}`;
      if (input.company_id) p += `&crm_company_id=eq.${input.company_id}`;
      const data = await sbGet(env, 'crm_quotes', p);
      return Array.isArray(data) ? data.map(q => ({ id: q.id, title: q.title, status: q.status, total: q.total, company: q.crm_companies?.name, created_at: q.created_at })) : data;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── Main handler ────────────────────────────────────────────

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

    // Get tenant_id using service key (bypasses RLS)
    // Try smartcore_core_employees first (user_id), then core_employees (auth_user_id)
    let tenantId = null;
    const p1 = await fetch(
      `${SUPABASE_URL}/rest/v1/smartcore_core_employees?user_id=eq.${userData.id}&select=company_id&limit=1`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    );
    const r1 = await p1.json();
    tenantId = r1?.[0]?.company_id;

    if (!tenantId) {
      const p2 = await fetch(
        `${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${userData.id}&select=company_id&limit=1`,
        { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
      );
      const r2 = await p2.json();
      tenantId = r2?.[0]?.company_id;
    }

    if (!tenantId) return json({ ok: false, error: 'No tenant' }, 403);

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ ok: false, error: 'AI not configured' }, 500);

    const body = await request.json();
    const messages = Array.isArray(body.messages) ? [...body.messages] : [];
    if (!messages.length) return json({ ok: false, error: 'No messages' }, 400);

    // Agentic loop — up to 6 rounds of tool use
    let rounds = 0;
    while (rounds < 6) {
      rounds++;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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
          messages,
        }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.text();
        console.error('Anthropic error:', err);
        return json({ ok: false, error: 'AI error' }, 502);
      }

      const aiJson = await aiRes.json();

      if (aiJson.stop_reason === 'end_turn') {
        const reply = aiJson.content?.find(b => b.type === 'text')?.text || '';
        return json({ ok: true, reply });
      }

      if (aiJson.stop_reason === 'tool_use') {
        // Add assistant message with tool use blocks
        messages.push({ role: 'assistant', content: aiJson.content });

        // Execute all tool calls and collect results
        const toolResults = [];
        for (const block of aiJson.content) {
          if (block.type !== 'tool_use') continue;
          let result;
          try {
            result = await executeTool(block.name, block.input, env, tenantId, userData.id);
          } catch (e) {
            result = { error: e.message };
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unexpected stop reason
      const reply = aiJson.content?.find(b => b.type === 'text')?.text || '';
      return json({ ok: true, reply });
    }

    return json({ ok: true, reply: 'I completed the operations. Let me know if you need anything else.' });
  } catch (e) {
    console.error('support-chat error:', e);
    return json({ ok: false, error: e.message }, 500);
  }
}
