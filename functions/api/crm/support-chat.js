// POST /api/crm/support-chat
// Body: { messages: [{role, content}] }
// Auth: Bearer <supabase access token>

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const SYSTEM_PROMPT = `You are the SmartCore CRM support assistant — a helpful, friendly assistant built into the SmartCore CRM system by SmartCore Technology (smartcoretechnology.co.uk).

IMPORTANT FORMATTING RULES:
- Never use markdown. No asterisks, no bold, no headers, no bullet dashes, no backticks.
- Write in plain conversational sentences and short paragraphs.
- If listing results, use numbered lines like "1. Item name — detail" on separate lines.
- Keep answers short and to the point.

DATA ACCESS:
You have tools to search the live CRM database. Use them whenever someone asks about specific records. When someone mentions a person's name in relation to records (e.g. "quotes added by Finley" or "tasks assigned to Sarah"), use the find_staff_member tool first to resolve their name to an ID, then use that ID in the relevant search tool.

Always try to answer data questions using the tools. Never say you cannot search by a field if a tool supports it — check the tool definitions carefully first.

ABOUT SMARTCORE CRM:
SmartCore CRM is a full business CRM system built by SmartCore Technology.

NAVIGATION: The sidebar has Main (Dashboard, Companies, Contacts, Leads, Pipeline, Tasks), Features (Calendar, Quotes, Documents, Reports, Customer Portal, Messaging, Projects), and System (Reminders, Commands, Settings). Support button is bottom-left above the profile.

COMPANIES: Name, industry, email, phone, website, status (Prospect/Active/Inactive/Churned), company value, assigned team member, address, postcode, customer since date, notes.

CONTACTS: First name, last name, job title, email, phone, linked company.

LEADS: Title, company, contact, status (New/Contacted/Qualified/Proposal/Won/Lost), estimated value, probability, source, assigned to, created by, notes, expected close date, pipeline stage.

PIPELINE: Kanban board with custom stages. Leads move through stages by drag and drop.

TASKS: Title, description, due date, priority (Low/Medium/High/Urgent), status (Todo/In Progress/Completed), linked company, assigned to, created by.

CALENDAR: Events with title, date, time, notes, linked company.

QUOTES: Quote number (QT-YEAR-XXXX), linked company, line items, subtotal, VAT, total, status (Draft/Sent/Accepted/Declined), created by.

DOCUMENTS: Files uploaded against companies. PDFs, images, Word docs, spreadsheets. Max 50MB.

REPORTS: Pipeline by stage, lead conversion, revenue over time, task completion rates.

MESSAGING: Two-way email messaging with customers, one thread per company. Customers reply via email.

REMINDERS: Subject, notes, date, time, repeat interval (none/daily/weekly/monthly/yearly). Emails sent when due.

COMMANDS: Automation rules — trigger (e.g. company status changed), action (send email, webhook), email recipients (specific addresses, team, customer), optional company filter.

SETTINGS: General, Plan and Features, Pipeline Stages, Email Templates, Appearance.

PLANS: Lite (basic), Professional (adds Calendar/Quotes/Documents/Reports), Business (adds Portal/Messaging/Projects), Enterprise (everything).

SUPPORT: For anything not covered here, email support@smartcoretechnology.co.uk.

Be friendly, concise, and helpful. Never use markdown.`;

const TOOLS = [
  {
    name: 'find_staff_member',
    description: 'Look up a staff member by name to get their ID. Use this FIRST whenever someone mentions a person by name and you need to filter records by who created or is assigned to them (e.g. "quotes by Finley", "tasks assigned to Sarah"). Returns their ID to use in other tools.',
    input_schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Full or partial name of the staff member' },
      },
    },
  },
  {
    name: 'search_companies',
    description: 'Search companies. Use for questions about specific companies or filtering companies by name, status, industry, or who they are assigned to.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Company name (partial match)' },
        status: { type: 'string', description: 'prospect, active, inactive, or churned' },
        industry: { type: 'string', description: 'Industry name (partial match)' },
        assigned_to_id: { type: 'string', description: 'Staff member ID to filter by who the company is assigned to' },
      },
    },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts by name, email, job title, or company. Use find_staff_member first if filtering by who created them.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name (partial match)' },
        last_name: { type: 'string', description: 'Last name (partial match)' },
        email: { type: 'string', description: 'Email address (partial match)' },
        job_title: { type: 'string', description: 'Job title (partial match)' },
        company_name: { type: 'string', description: 'Name of company the contact works at (partial match)' },
        created_by_id: { type: 'string', description: 'Staff member ID who created the contact' },
      },
    },
  },
  {
    name: 'search_leads',
    description: 'Search leads/opportunities. Use find_staff_member first if filtering by assigned person or creator.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Lead title (partial match)' },
        status: { type: 'string', description: 'new, contacted, qualified, proposal, won, or lost' },
        pipeline_stage: { type: 'string', description: 'Pipeline stage name (partial match)' },
        company_name: { type: 'string', description: 'Company name (partial match)' },
        source: { type: 'string', description: 'Lead source (partial match)' },
        assigned_to_id: { type: 'string', description: 'Staff member ID the lead is assigned to' },
        created_by_id: { type: 'string', description: 'Staff member ID who created the lead' },
        min_value: { type: 'number', description: 'Minimum estimated value in £' },
        max_value: { type: 'number', description: 'Maximum estimated value in £' },
      },
    },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks. Use find_staff_member first if filtering by assigned person or creator.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title (partial match)' },
        status: { type: 'string', description: 'todo, in_progress, or completed' },
        priority: { type: 'string', description: 'low, medium, high, or urgent' },
        company_name: { type: 'string', description: 'Company name the task is linked to (partial match)' },
        assigned_to_id: { type: 'string', description: 'Staff member ID the task is assigned to' },
        created_by_id: { type: 'string', description: 'Staff member ID who created the task' },
        due_before: { type: 'string', description: 'ISO date string — tasks due before this date' },
        due_after: { type: 'string', description: 'ISO date string — tasks due after this date' },
        overdue: { type: 'boolean', description: 'If true, return only overdue incomplete tasks' },
      },
    },
  },
  {
    name: 'search_quotes',
    description: 'Search quotes. Use find_staff_member first if filtering by who created them.',
    input_schema: {
      type: 'object',
      properties: {
        quote_number: { type: 'string', description: 'Quote number (partial match, e.g. QT-2025)' },
        status: { type: 'string', description: 'draft, sent, accepted, or declined' },
        company_name: { type: 'string', description: 'Company name (partial match)' },
        created_by_id: { type: 'string', description: 'Staff member ID who created the quote' },
        min_total: { type: 'number', description: 'Minimum quote total in £' },
        max_total: { type: 'number', description: 'Maximum quote total in £' },
      },
    },
  },
  {
    name: 'search_documents',
    description: 'Search documents uploaded to the CRM.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Document name (partial match)' },
        company_name: { type: 'string', description: 'Company name the document is linked to (partial match)' },
        category: { type: 'string', description: 'Document category' },
        uploaded_by_id: { type: 'string', description: 'Staff member ID who uploaded the document' },
      },
    },
  },
  {
    name: 'search_events',
    description: 'Search calendar events.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title (partial match)' },
        company_name: { type: 'string', description: 'Company name the event is linked to' },
        from_date: { type: 'string', description: 'ISO date string — events from this date' },
        to_date: { type: 'string', description: 'ISO date string — events up to this date' },
        upcoming_only: { type: 'boolean', description: 'If true, only return future events' },
      },
    },
  },
  {
    name: 'search_reminders',
    description: 'Search reminders.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Reminder subject (partial match)' },
        user_name: { type: 'string', description: 'Name of the person the reminder belongs to (partial match)' },
        sent: { type: 'boolean', description: 'true = only sent reminders, false = only pending reminders' },
        repeat_interval: { type: 'string', description: 'none, daily, weekly, monthly, or yearly' },
      },
    },
  },
  {
    name: 'get_dashboard_summary',
    description: 'Get a high-level summary of the CRM — total companies, active leads, pipeline value, overdue tasks, etc. Use when someone asks for an overview or summary of the business.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_activities',
    description: 'Search the activity log — things like companies created, leads updated, quotes sent, etc.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Filter by company name (partial match)' },
        type: { type: 'string', description: 'Activity type, e.g. company_created, lead_created, quote_created, contact_added' },
        created_by_id: { type: 'string', description: 'Staff member ID who performed the action' },
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

async function q(url, svcHdr) {
  const res = await fetch(url, { headers: svcHdr });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function runTool(toolName, input, tenantId, svcHdr) {
  const base = `${SUPABASE_URL}/rest/v1`;
  const enc = encodeURIComponent;

  try {
    // ── Find staff member by name ──────────────────────────────────────────
    if (toolName === 'find_staff_member') {
      const staff = await q(
        `${base}/core_employees?company_id=eq.${tenantId}&full_name=ilike.*${enc(input.name)}*&select=id,full_name,role,work_email&limit=10`,
        svcHdr
      );
      if (!staff.length) return `No staff member found matching "${input.name}".`;
      return staff.map(s => `ID:${s.id} | ${s.full_name} (${s.role || 'staff'}) — ${s.work_email || ''}`).join('\n');
    }

    // ── Companies ──────────────────────────────────────────────────────────
    if (toolName === 'search_companies') {
      let url = `${base}/crm_companies?tenant_id=eq.${tenantId}&select=name,status,industry,email,phone,company_value,city&order=name&limit=25`;
      if (input.name) url += `&name=ilike.*${enc(input.name)}*`;
      if (input.status) url += `&status=eq.${enc(input.status)}`;
      if (input.industry) url += `&industry=ilike.*${enc(input.industry)}*`;
      if (input.assigned_to_id) url += `&assigned_to=eq.${enc(input.assigned_to_id)}`;
      const data = await q(url, svcHdr);
      if (!data.length) return 'No companies found.';
      return `Found ${data.length} company/companies:\n` + data.map((c, i) =>
        `${i+1}. ${c.name} — ${c.status}${c.industry ? `, ${c.industry}` : ''}${c.city ? `, ${c.city}` : ''}${c.email ? ` (${c.email})` : ''}${c.company_value ? `, value £${c.company_value}` : ''}`
      ).join('\n');
    }

    // ── Contacts ───────────────────────────────────────────────────────────
    if (toolName === 'search_contacts') {
      let url = `${base}/crm_contacts?tenant_id=eq.${tenantId}&select=first_name,last_name,email,phone,job_title,crm_companies(name)&order=first_name&limit=25`;
      const ors = [];
      if (input.first_name) ors.push(`first_name.ilike.*${enc(input.first_name)}*`);
      if (input.last_name) ors.push(`last_name.ilike.*${enc(input.last_name)}*`);
      if (input.email) url += `&email=ilike.*${enc(input.email)}*`;
      if (input.job_title) url += `&job_title=ilike.*${enc(input.job_title)}*`;
      if (input.created_by_id) url += `&created_by=eq.${enc(input.created_by_id)}`;
      if (ors.length) url += `&or=(${ors.join(',')})`;
      let data = await q(url, svcHdr);
      if (input.company_name) data = data.filter(c => c.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No contacts found.';
      return `Found ${data.length} contact(s):\n` + data.map((c, i) =>
        `${i+1}. ${c.first_name} ${c.last_name}${c.job_title ? `, ${c.job_title}` : ''}${c.crm_companies?.name ? ` at ${c.crm_companies.name}` : ''}${c.email ? ` — ${c.email}` : ''}${c.phone ? `, ${c.phone}` : ''}`
      ).join('\n');
    }

    // ── Leads ──────────────────────────────────────────────────────────────
    if (toolName === 'search_leads') {
      let url = `${base}/crm_leads?tenant_id=eq.${tenantId}&select=title,status,pipeline_stage,estimated_value,probability,source,crm_companies(name)&order=created_at.desc&limit=25`;
      if (input.title) url += `&title=ilike.*${enc(input.title)}*`;
      if (input.status) url += `&status=eq.${enc(input.status)}`;
      if (input.pipeline_stage) url += `&pipeline_stage=ilike.*${enc(input.pipeline_stage)}*`;
      if (input.source) url += `&source=ilike.*${enc(input.source)}*`;
      if (input.assigned_to_id) url += `&assigned_to=eq.${enc(input.assigned_to_id)}`;
      if (input.created_by_id) url += `&created_by=eq.${enc(input.created_by_id)}`;
      if (input.min_value) url += `&estimated_value=gte.${input.min_value}`;
      if (input.max_value) url += `&estimated_value=lte.${input.max_value}`;
      let data = await q(url, svcHdr);
      if (input.company_name) data = data.filter(l => l.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No leads found.';
      return `Found ${data.length} lead(s):\n` + data.map((l, i) =>
        `${i+1}. ${l.title} — ${l.status}${l.pipeline_stage ? ` (${l.pipeline_stage})` : ''}${l.crm_companies?.name ? ` | ${l.crm_companies.name}` : ''}${l.estimated_value ? ` | £${l.estimated_value}` : ''}${l.probability ? ` | ${l.probability}% probability` : ''}`
      ).join('\n');
    }

    // ── Tasks ──────────────────────────────────────────────────────────────
    if (toolName === 'search_tasks') {
      let url = `${base}/crm_tasks?tenant_id=eq.${tenantId}&select=title,status,priority,due_date,crm_companies(name)&order=due_date&limit=25`;
      if (input.title) url += `&title=ilike.*${enc(input.title)}*`;
      if (input.status) url += `&status=eq.${enc(input.status)}`;
      if (input.priority) url += `&priority=eq.${enc(input.priority)}`;
      if (input.assigned_to_id) url += `&assigned_to=eq.${enc(input.assigned_to_id)}`;
      if (input.created_by_id) url += `&created_by=eq.${enc(input.created_by_id)}`;
      if (input.due_before) url += `&due_date=lte.${enc(input.due_before)}`;
      if (input.due_after) url += `&due_date=gte.${enc(input.due_after)}`;
      if (input.overdue) url += `&due_date=lt.${new Date().toISOString()}&status=neq.completed`;
      let data = await q(url, svcHdr);
      if (input.company_name) data = data.filter(t => t.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No tasks found.';
      return `Found ${data.length} task(s):\n` + data.map((t, i) =>
        `${i+1}. ${t.title} — ${t.status}, ${t.priority} priority${t.crm_companies?.name ? ` | ${t.crm_companies.name}` : ''}${t.due_date ? ` | due ${t.due_date.slice(0,10)}` : ''}`
      ).join('\n');
    }

    // ── Quotes ─────────────────────────────────────────────────────────────
    if (toolName === 'search_quotes') {
      let url = `${base}/crm_quotes?tenant_id=eq.${tenantId}&select=quote_number,status,total,subtotal,created_at,crm_companies(name)&order=created_at.desc&limit=25`;
      if (input.quote_number) url += `&quote_number=ilike.*${enc(input.quote_number)}*`;
      if (input.status) url += `&status=eq.${enc(input.status)}`;
      if (input.created_by_id) url += `&created_by=eq.${enc(input.created_by_id)}`;
      if (input.min_total) url += `&total=gte.${input.min_total}`;
      if (input.max_total) url += `&total=lte.${input.max_total}`;
      let data = await q(url, svcHdr);
      if (input.company_name) data = data.filter(q => q.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No quotes found.';
      return `Found ${data.length} quote(s):\n` + data.map((qt, i) =>
        `${i+1}. ${qt.quote_number || 'No number'} — ${qt.status}${qt.crm_companies?.name ? ` | ${qt.crm_companies.name}` : ''}${qt.total != null ? ` | £${qt.total}` : ''}${qt.created_at ? ` | created ${qt.created_at.slice(0,10)}` : ''}`
      ).join('\n');
    }

    // ── Documents ──────────────────────────────────────────────────────────
    if (toolName === 'search_documents') {
      let url = `${base}/crm_documents?tenant_id=eq.${tenantId}&select=name,category,file_size,created_at,crm_companies(name)&order=created_at.desc&limit=25`;
      if (input.name) url += `&name=ilike.*${enc(input.name)}*`;
      if (input.category) url += `&category=eq.${enc(input.category)}`;
      if (input.uploaded_by_id) url += `&uploaded_by=eq.${enc(input.uploaded_by_id)}`;
      let data = await q(url, svcHdr);
      if (input.company_name) data = data.filter(d => d.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No documents found.';
      return `Found ${data.length} document(s):\n` + data.map((d, i) =>
        `${i+1}. ${d.name}${d.category ? ` (${d.category})` : ''}${d.crm_companies?.name ? ` | ${d.crm_companies.name}` : ''}${d.created_at ? ` | uploaded ${d.created_at.slice(0,10)}` : ''}`
      ).join('\n');
    }

    // ── Events ─────────────────────────────────────────────────────────────
    if (toolName === 'search_events') {
      let url = `${base}/crm_events?tenant_id=eq.${tenantId}&select=title,start_time,end_time,type,notes,crm_companies(name)&order=start_time&limit=25`;
      if (input.title) url += `&title=ilike.*${enc(input.title)}*`;
      if (input.from_date) url += `&start_time=gte.${enc(input.from_date)}`;
      if (input.to_date) url += `&start_time=lte.${enc(input.to_date)}`;
      if (input.upcoming_only) url += `&start_time=gte.${new Date().toISOString()}`;
      let data = await q(url, svcHdr);
      if (input.company_name) data = data.filter(e => e.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No events found.';
      return `Found ${data.length} event(s):\n` + data.map((e, i) =>
        `${i+1}. ${e.title}${e.start_time ? ` | ${e.start_time.slice(0,16).replace('T',' ')}` : ''}${e.crm_companies?.name ? ` | ${e.crm_companies.name}` : ''}`
      ).join('\n');
    }

    // ── Reminders ──────────────────────────────────────────────────────────
    if (toolName === 'search_reminders') {
      let url = `${base}/crm_reminders?tenant_id=eq.${tenantId}&select=subject,remind_at,sent_at,repeat_interval,user_name,notes&order=remind_at&limit=25`;
      if (input.subject) url += `&subject=ilike.*${enc(input.subject)}*`;
      if (input.user_name) url += `&user_name=ilike.*${enc(input.user_name)}*`;
      if (input.repeat_interval) url += `&repeat_interval=eq.${enc(input.repeat_interval)}`;
      if (input.sent === true) url += `&sent_at=not.is.null`;
      if (input.sent === false) url += `&sent_at=is.null`;
      const data = await q(url, svcHdr);
      if (!data.length) return 'No reminders found.';
      return `Found ${data.length} reminder(s):\n` + data.map((r, i) =>
        `${i+1}. ${r.subject}${r.user_name ? ` (${r.user_name})` : ''} | due ${r.remind_at?.slice(0,16).replace('T',' ')}${r.repeat_interval && r.repeat_interval !== 'none' ? ` | repeats ${r.repeat_interval}` : ''}${r.sent_at ? ' | sent' : ' | pending'}`
      ).join('\n');
    }

    // ── Dashboard summary ──────────────────────────────────────────────────
    if (toolName === 'get_dashboard_summary') {
      const today = new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      const [comps, leadsData, tasksData, quotesData] = await Promise.all([
        q(`${base}/crm_companies?tenant_id=eq.${tenantId}&select=status`, svcHdr),
        q(`${base}/crm_leads?tenant_id=eq.${tenantId}&select=status,estimated_value`, svcHdr),
        q(`${base}/crm_tasks?tenant_id=eq.${tenantId}&select=status,due_date`, svcHdr),
        q(`${base}/crm_quotes?tenant_id=eq.${tenantId}&select=status,total`, svcHdr),
      ]);
      const totalCompanies = comps.length;
      const activeCompanies = comps.filter(c => c.status === 'active').length;
      const activeLeads = leadsData.filter(l => !['won','lost'].includes(l.status)).length;
      const wonLeads = leadsData.filter(l => l.status === 'won').length;
      const pipelineValue = leadsData.filter(l => !['won','lost'].includes(l.status)).reduce((s,l) => s + (Number(l.estimated_value)||0), 0);
      const overdueTasks = tasksData.filter(t => t.due_date && t.due_date < now && t.status !== 'completed').length;
      const todayTasks = tasksData.filter(t => t.due_date && t.due_date.slice(0,10) === today && t.status !== 'completed').length;
      const pendingQuotes = quotesData.filter(qt => qt.status === 'sent').length;
      const acceptedValue = quotesData.filter(qt => qt.status === 'accepted').reduce((s,qt) => s + (Number(qt.total)||0), 0);
      return `CRM Summary:\nTotal companies: ${totalCompanies} (${activeCompanies} active)\nActive leads: ${activeLeads} | Won leads: ${wonLeads}\nPipeline value: £${pipelineValue.toLocaleString()}\nTasks due today: ${todayTasks} | Overdue tasks: ${overdueTasks}\nQuotes awaiting response: ${pendingQuotes}\nTotal accepted quote value: £${acceptedValue.toLocaleString()}`;
    }

    // ── Activities ─────────────────────────────────────────────────────────
    if (toolName === 'search_activities') {
      let url = `${base}/crm_activities?tenant_id=eq.${tenantId}&select=type,title,created_at,crm_companies(name)&order=created_at.desc&limit=25`;
      if (input.type) url += `&type=eq.${enc(input.type)}`;
      if (input.created_by_id) url += `&created_by=eq.${enc(input.created_by_id)}`;
      let data = await q(url, svcHdr);
      if (input.company_name) data = data.filter(a => a.crm_companies?.name?.toLowerCase().includes(input.company_name.toLowerCase()));
      if (!data.length) return 'No activity found.';
      return `Found ${data.length} activity entries:\n` + data.map((a, i) =>
        `${i+1}. ${a.title}${a.crm_companies?.name ? ` | ${a.crm_companies.name}` : ''} | ${a.created_at?.slice(0,10)}`
      ).join('\n');
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

    // Agentic loop — Claude can call tools up to 8 times per response
    let currentMessages = [...messages];
    let reply = '';

    for (let i = 0; i < 8; i++) {
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
        currentMessages = [...currentMessages, { role: 'assistant', content: data.content }];

        const toolResults = await Promise.all(toolUseBlocks.map(async tb => ({
          type: 'tool_result',
          tool_use_id: tb.id,
          content: await runTool(tb.name, tb.input, tenantId, svcHdr),
        })));

        currentMessages = [...currentMessages, { role: 'user', content: toolResults }];
        continue;
      }

      reply = data.content?.find(b => b.type === 'text')?.text || '';
      break;
    }

    return json({ ok: true, reply });
  } catch (e) {
    return json({ ok: false, error: e.message }, 500);
  }
}
