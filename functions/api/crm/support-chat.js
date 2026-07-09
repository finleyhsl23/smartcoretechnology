// POST /api/crm/support-chat
// Body: { messages: [{role, content}], tenant_id }
// Auth: Bearer <supabase access token>

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const SYSTEM_PROMPT = `You are the SmartCore CRM AI assistant. You have full access to the user's CRM data and can read, create, update, and delete records on their behalf.

When users ask you to do something (add a company, create a task, schedule a meeting, log a conversation, etc.) — do it immediately using the available tools. Don't just explain how; take action.

Be concise and friendly. After completing an action, confirm what you did in one sentence. Use **bold** for company names, lead titles, and key values.

Today's date: ${new Date().toISOString().slice(0, 10)}`;

const BASE_TOOLS = [
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
  {
    name: "list_tickets",
    description: "List support tickets",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "open, in_progress, resolved, closed" },
        priority: { type: "string", description: "low, medium, high, urgent" },
        company_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "update_ticket",
    description: "Update a support ticket (change status, priority, assignee, add notes)",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        status: { type: "string", description: "open, in_progress, resolved, closed" },
        priority: { type: "string", description: "low, medium, high, urgent" },
        assigned_to: { type: "string", description: "Employee ID" },
        resolution_notes: { type: "string" },
      },
    },
  },
  {
    name: "list_conversations",
    description: "List logged conversations for a company",
    input_schema: {
      type: "object",
      required: ["company_id"],
      properties: {
        company_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "log_conversation",
    description: "Log a conversation/interaction with a company",
    input_schema: {
      type: "object",
      required: ["company_id", "summary", "method"],
      properties: {
        company_id: { type: "string" },
        method: { type: "string", description: "call, email, meeting, video_call, in_person, other" },
        occurred_at: { type: "string", description: "ISO datetime (defaults to now)" },
        our_attendees: { type: "string" },
        their_attendees: { type: "string" },
        summary: { type: "string" },
        follow_up_date: { type: "string", description: "ISO date for follow-up reminder" },
        follow_up_note: { type: "string" },
      },
    },
  },
  {
    name: "list_reminders",
    description: "List upcoming reminders",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date, start of range (default today)" },
        to: { type: "string", description: "ISO date, end of range" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_reminder",
    description: "Create a follow-up reminder",
    input_schema: {
      type: "object",
      required: ["title", "remind_at"],
      properties: {
        title: { type: "string" },
        remind_at: { type: "string", description: "ISO datetime" },
        note: { type: "string" },
        crm_company_id: { type: "string" },
        crm_lead_id: { type: "string" },
        crm_contact_id: { type: "string" },
      },
    },
  },
];

const EXTRA_TOOLS = [
  {
    name: "list_projects",
    description: "List or search projects",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "active, planning, on_hold, completed, cancelled" },
        company_id: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_project",
    description: "Create a new project",
    input_schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", description: "active, planning, on_hold, completed, cancelled" },
        crm_company_id: { type: "string" },
        visible_to_portal: { type: "boolean" },
      },
    },
  },
  {
    name: "update_project",
    description: "Update a project",
    input_schema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        crm_company_id: { type: "string" },
        visible_to_portal: { type: "boolean" },
      },
    },
  },
  {
    name: "delete_project",
    description: "Delete a project by ID",
    input_schema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  },
  {
    name: "list_documents",
    description: "List documents, optionally filtered by company",
    input_schema: {
      type: "object",
      properties: {
        company_id: { type: "string" },
        category: { type: "string", description: "general, contract, quote, proposal, photo, form, report, other" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_products",
    description: "List products/services in the catalogue",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string" },
        category: { type: "string" },
        active_only: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_staff",
    description: "List all staff/employees in the organisation",
    input_schema: {
      type: "object",
      properties: {
        department: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "list_pipeline",
    description: "List pipeline stages and lead counts per stage",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_ticket",
    description: "Create a new support ticket",
    input_schema: {
      type: "object",
      required: ["subject"],
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", description: "low, medium, high, urgent" },
        type: { type: "string", description: "bug, feature_request, support, billing, other" },
        crm_company_id: { type: "string" },
        assigned_to: { type: "string", description: "Employee ID" },
      },
    },
  },
];

const LEADERBOARD_TOOL = {
  name: "list_leaderboard",
  description: "Show the sales leaderboard — who has the most accepted quotes and highest value in a given period",
  input_schema: {
    type: "object",
    properties: {
      days: { type: "number", description: "Number of past days to include (default 30)" },
    },
  },
};

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

async function logActivity(env, tenantId, userId, type, title, companyId) {
  try {
    await sbPost(env, 'crm_activities', {
      tenant_id: tenantId,
      created_by: userId,
      type,
      title,
      crm_company_id: companyId || null,
    });
  } catch (_) {}
}

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
      if (r?.id) { await logActivity(env, tenantId, userId, 'company_created', r.name, r.id); return { ok: true, id: r.id, name: r.name }; }
      return { error: r?.message || JSON.stringify(r) };
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
      if (r?.id) { await logActivity(env, tenantId, userId, 'contact_added', `${r.first_name} ${r.last_name}`, input.crm_company_id || null); return { ok: true, id: r.id, name: `${r.first_name} ${r.last_name}` }; }
      return { error: r?.message || JSON.stringify(r) };
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
      if (r?.id) { await logActivity(env, tenantId, userId, 'lead_created', r.title, input.crm_company_id || null); return { ok: true, id: r.id, title: r.title }; }
      return { error: r?.message || JSON.stringify(r) };
    }
    case 'update_lead': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_leads', id, { ...fields, updated_at: new Date().toISOString() });
      if (r?.id) {
        if (fields.status === 'won') await logActivity(env, tenantId, userId, 'deal_won', r.title || `Lead ${id}`, r.crm_company_id || null);
        else if (fields.status === 'lost') await logActivity(env, tenantId, userId, 'deal_lost', r.title || `Lead ${id}`, r.crm_company_id || null);
        return { ok: true, id: r.id };
      }
      return { error: r?.message || JSON.stringify(r) };
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
      if (r?.id) { await logActivity(env, tenantId, userId, 'task_created', r.title, input.crm_company_id || null); return { ok: true, id: r.id, title: r.title }; }
      return { error: r?.message || JSON.stringify(r) };
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
      if (r?.id) { await logActivity(env, tenantId, userId, 'meeting', r.title, input.crm_company_id || null); return { ok: true, id: r.id, title: r.title, start_time: r.start_time }; }
      return { error: r?.message || JSON.stringify(r) };
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

    case 'list_tickets': {
      let p = `?tenant_id=eq.${tenantId}&order=created_at.desc&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.status) p += `&status=eq.${input.status}`;
      if (input.priority) p += `&priority=eq.${input.priority}`;
      if (input.company_id) p += `&crm_company_id=eq.${input.company_id}`;
      const data = await sbGet(env, 'crm_tickets', p);
      return Array.isArray(data) ? data.map(t => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority, company: t.crm_companies?.name, created_at: t.created_at })) : data;
    }
    case 'update_ticket': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_tickets', id, { ...fields, updated_at: new Date().toISOString() });
      return r?.id ? { ok: true, id: r.id } : { error: r?.message || JSON.stringify(r) };
    }

    case 'list_conversations': {
      let p = `?tenant_id=eq.${tenantId}&crm_company_id=eq.${input.company_id}&order=occurred_at.desc&limit=${input.limit || 50}`;
      const data = await sbGet(env, 'crm_company_conversations', p);
      return Array.isArray(data) ? data.map(c => ({ id: c.id, method: c.method, occurred_at: c.occurred_at, summary: c.summary, our_attendees: c.our_attendees, their_attendees: c.their_attendees, follow_up_date: c.follow_up_date })) : data;
    }
    case 'log_conversation': {
      const payload = {
        ...base,
        crm_company_id: input.company_id,
        method: input.method,
        occurred_at: input.occurred_at || new Date().toISOString(),
        summary: input.summary,
        our_attendees: input.our_attendees || null,
        their_attendees: input.their_attendees || null,
        follow_up_date: input.follow_up_date || null,
        follow_up_note: input.follow_up_note || null,
        logged_by: userId,
      };
      const data = await sbPost(env, 'crm_company_conversations', payload);
      const r = Array.isArray(data) ? data[0] : data;
      if (!r?.id) return { error: r?.message || JSON.stringify(r) };
      // If follow-up requested, also create a reminder
      if (input.follow_up_date) {
        await sbPost(env, 'crm_reminders', {
          tenant_id: tenantId,
          created_by: userId,
          title: `Follow up: ${input.follow_up_note || 'Company conversation follow-up'}`,
          remind_at: input.follow_up_date,
          crm_company_id: input.company_id,
        });
      }
      const methodToType = { call: 'call', email: 'email', meeting: 'meeting', video: 'meeting' };
      await logActivity(env, tenantId, userId, methodToType[input.method] || 'note', `${input.method || 'Conversation'} logged`, input.company_id || null);
      return { ok: true, id: r.id };
    }

    case 'list_reminders': {
      const from = input.from || new Date().toISOString().slice(0, 10);
      let p = `?tenant_id=eq.${tenantId}&remind_at=gte.${from}&order=remind_at&limit=${input.limit || 50}`;
      if (input.to) p += `&remind_at=lte.${input.to}`;
      const data = await sbGet(env, 'crm_reminders', p);
      return Array.isArray(data) ? data.map(r => ({ id: r.id, title: r.title, remind_at: r.remind_at, note: r.note })) : data;
    }
    case 'create_reminder': {
      const data = await sbPost(env, 'crm_reminders', { ...base, ...input });
      const r = Array.isArray(data) ? data[0] : data;
      return r?.id ? { ok: true, id: r.id, title: r.title } : { error: r?.message || JSON.stringify(r) };
    }

    case 'list_projects': {
      let p = `?tenant_id=eq.${tenantId}&order=created_at.desc&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.status) p += `&status=eq.${input.status}`;
      if (input.company_id) p += `&crm_company_id=eq.${input.company_id}`;
      const data = await sbGet(env, 'crm_projects', p);
      return Array.isArray(data) ? data.map(p => ({ id: p.id, name: p.name, status: p.status, description: p.description, company: p.crm_companies?.name, created_at: p.created_at })) : data;
    }
    case 'create_project': {
      const data = await sbPost(env, 'crm_projects', { ...base, status: 'active', ...input });
      const r = Array.isArray(data) ? data[0] : data;
      if (r?.id) { await logActivity(env, tenantId, userId, 'project_created', r.name, input.crm_company_id || null); return { ok: true, id: r.id, name: r.name }; }
      return { error: r?.message || JSON.stringify(r) };
    }
    case 'update_project': {
      const { id, ...fields } = input;
      const r = await sbPatch(env, 'crm_projects', id, { ...fields, updated_at: new Date().toISOString() });
      return r?.id ? { ok: true, id: r.id } : { error: r?.message || JSON.stringify(r) };
    }
    case 'delete_project':
      return sbDelete(env, 'crm_projects', input.id);

    case 'list_documents': {
      let p = `?tenant_id=eq.${tenantId}&order=created_at.desc&limit=${input.limit || 50}&select=*,crm_companies(name)`;
      if (input.company_id) p += `&crm_company_id=eq.${input.company_id}`;
      if (input.category) p += `&category=eq.${input.category}`;
      const data = await sbGet(env, 'crm_documents', p);
      return Array.isArray(data) ? data.map(d => ({ id: d.id, name: d.name, category: d.category, file_type: d.file_type, company: d.crm_companies?.name, created_at: d.created_at })) : data;
    }

    case 'list_products': {
      let p = `?tenant_id=eq.${tenantId}&order=name&limit=${input.limit || 50}`;
      if (input.active_only !== false) p += `&active=eq.true`;
      if (input.search) p += `&name=ilike.*${encodeURIComponent(input.search)}*`;
      if (input.category) p += `&category=eq.${input.category}`;
      const data = await sbGet(env, 'crm_products', p);
      return Array.isArray(data) ? data.map(p => ({ id: p.id, name: p.name, sku: p.sku, price: p.price, category: p.category, active: p.active })) : data;
    }

    case 'list_staff': {
      let p = `?company_id=eq.${tenantId}&order=full_name&limit=${input.limit || 100}&select=id,auth_user_id,full_name,email,role,department,job_title`;
      if (input.department) p += `&department=eq.${input.department}`;
      const data = await sbGet(env, 'core_employees', p);
      return Array.isArray(data) ? data.map(e => ({ id: e.id, name: e.full_name, email: e.email, role: e.role, department: e.department, job_title: e.job_title })) : data;
    }

    case 'list_pipeline': {
      const data = await sbGet(env, 'crm_leads', `?tenant_id=eq.${tenantId}&select=pipeline_stage,status,estimated_value`);
      if (!Array.isArray(data)) return data;
      const stages = {};
      for (const l of data) {
        const s = l.pipeline_stage || 'unknown';
        if (!stages[s]) stages[s] = { stage: s, count: 0, total_value: 0 };
        stages[s].count++;
        stages[s].total_value += l.estimated_value || 0;
      }
      return Object.values(stages).sort((a, b) => b.count - a.count);
    }

    case 'create_ticket': {
      const data = await sbPost(env, 'crm_tickets', { ...base, status: 'open', priority: 'medium', ...input });
      const r = Array.isArray(data) ? data[0] : data;
      if (r?.id) { await logActivity(env, tenantId, userId, 'ticket_created', r.subject, input.crm_company_id || null); return { ok: true, id: r.id, subject: r.subject }; }
      return { error: r?.message || JSON.stringify(r) };
    }

    case 'list_leaderboard': {
      const days = input.days || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const data = await sbGet(env, 'crm_quotes', `?tenant_id=eq.${tenantId}&status=eq.accepted&accepted_at=gte.${since}&select=assigned_to,total`);
      if (!Array.isArray(data)) return data;
      const map = {};
      for (const q of data) {
        const k = q.assigned_to || 'unassigned';
        if (!map[k]) map[k] = { assigned_to: k, won: 0, value: 0 };
        map[k].won++;
        map[k].value += q.total || 0;
      }
      // Fetch employees and build lookup by both id and auth_user_id
      const empData = await sbGet(env, 'core_employees', `?company_id=eq.${tenantId}&select=id,auth_user_id,full_name`);
      const nameMap = {};
      if (Array.isArray(empData)) {
        for (const e of empData) {
          if (e.id) nameMap[e.id] = e.full_name;
          if (e.auth_user_id) nameMap[e.auth_user_id] = e.full_name;
        }
      }
      return Object.values(map)
        .sort((a, b) => b.value - a.value || b.won - a.won)
        .map((e, i) => ({ rank: i + 1, name: nameMap[e.assigned_to] || e.assigned_to || 'Unassigned', accepted_quotes: e.won, value: `£${e.value.toLocaleString()}` }));
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

    // Get tenant_id
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

    // Verify enterprise tier — AI Assistant is enterprise-only
    const tierRes = await fetch(
      `${SUPABASE_URL}/rest/v1/company_modules?company_id=eq.${tenantId}&module_key=eq.smartcore-crm&select=tier&limit=1`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
    );
    const tierData = await tierRes.json();
    const crmTier = tierData?.[0]?.tier;
    if (crmTier !== 'enterprise') return json({ ok: false, error: 'AI Assistant requires the Enterprise plan.' }, 403);

    // Check leaderboard setting server-side
    const settingsData = await sbGet(env, `crm_settings?tenant_id=eq.${tenantId}&limit=1`);
    const settings = Array.isArray(settingsData) ? settingsData[0] : null;
    const leaderboardEnabled = settings?.leaderboard_enabled !== false;

    const tools = leaderboardEnabled ? [...BASE_TOOLS, ...EXTRA_TOOLS, LEADERBOARD_TOOL] : [...BASE_TOOLS, ...EXTRA_TOOLS];

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
          tools,
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
        messages.push({ role: 'assistant', content: aiJson.content });

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

      const reply = aiJson.content?.find(b => b.type === 'text')?.text || '';
      return json({ ok: true, reply });
    }

    return json({ ok: true, reply: 'I completed the operations. Let me know if you need anything else.' });
  } catch (e) {
    console.error('support-chat error:', e);
    return json({ ok: false, error: e.message }, 500);
  }
}
