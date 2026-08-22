// POST /api/nova/chat
// Body: { messages: [{role,content}], conversation_id?: string }
// Auth: Bearer <supabase access token>

import { getValidAccessToken, googleApi } from './_google.js';

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

function buildSystemPrompt(userName, todayStr) {
  return `You are Nova, the AI assistant built into the SmartCore Technology workplace platform by SmartCore Technology (smartcoretechnology.co.uk). You help teams get work done — you are warm, efficient, proactive and highly capable, like an outstanding colleague who never drops anything.

Today's date is ${todayStr}.
The user's name is ${userName}.

YOUR CAPABILITIES:
- Reading and analysing files the user uploads, including images and PDFs
- Rewriting and drafting emails and professional communications
- Managing projects, tasks and to-dos for the team
- Managing calendar events and appointments
- Managing contacts with full details
- Setting and managing reminders
- Taking and searching notes
- Finding locations and providing directions via map
- Searching CRM data (companies, contacts, leads, tasks, quotes)
- Providing daily briefings and summaries
- Searching the live web for current information
- Reading and sending Gmail, managing Google Calendar, and reading Google Drive files

WEB SEARCH:
You can search the web. Use it whenever the user asks about current events, prices, company information, or anything that may have changed recently — do not answer from memory when the answer could be out of date. Cite the source when you use search results.

GOOGLE WORKSPACE:
The user may connect their Google account, which gives you their Gmail, Google Calendar and Google Drive through the google_ tools.
- If a google_ tool reports that Google is not connected, tell the user to open Settings, go to Integrations and click Connect Google. Do not keep retrying.
- Before sending an email with google_send_email, always show the user the recipient, subject and full body and get their explicit go-ahead. Sending cannot be undone.
- Prefer google_create_event over create_event when the user means their real calendar, and say which calendar you used.
- Never repeat someone's email contents to anyone other than the account owner.

FILES, IMAGES AND PDFS:
You can see images and read PDFs directly when they are attached to the conversation. Describe only what is genuinely in front of you.

- If an image or PDF IS attached, look at it properly and answer from what you actually see. Be specific and detailed — read out any text, labels, dimensions or figures it contains.
- If the user mentions a file but NO attachment is present in the conversation, say plainly that the file did not come through and ask them to upload it again. Do not guess at what it might contain.
- Never invent or describe content you cannot actually see. Describing an attachment as "blank", "a placeholder" or "a generic icon" when you have not truly received one is a serious error — say it did not arrive instead.

RESPONSE RULES:
- Write in plain conversational British English. No markdown, no asterisks, no bold syntax, no headers with hashes, no bullet dashes. Use numbered lines like "1. Item" only when listing multiple things.
- Be concise but complete. Do not pad responses with filler.
- When you create, update or find something, clearly confirm what you did.
- Use British spelling (colour, organise, centre, etc.).
- Address the user by first name occasionally but not every message.
- Be proactive — if you spot something useful (upcoming event tomorrow, overdue task), mention it.
- When asked about time or dates, always use the date provided above as "today".
- Never invent data. Always use tools to create, search or update records.

CREATING RECORDS:
Before creating any record, confirm the key details with the user unless they have given you everything clearly. After creating, summarise what was created.

EMAIL DRAFTING:
When asked to draft an email, use the draft_email tool. Present the draft clearly and ask if the user would like any changes.

MAPS AND LOCATIONS:
When the user asks about a location, directions, or wants to find somewhere, use the find_location tool. This will return a map card.

CRM ACCESS:
You have access to the user's CRM data (companies, contacts, leads, tasks, quotes). Use the crm_ tools when asked about business data.`;
}

const TOOLS = [
  {
    name: 'get_today_briefing',
    description: 'Get a full briefing for today: upcoming events, tasks due today or overdue, pending reminders. Use when the user asks for their daily overview, what\'s on today, or a morning briefing.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_event',
    description: 'Create a new calendar event. Returns the created event details.',
    input_schema: {
      type: 'object',
      required: ['title', 'start_time'],
      properties: {
        title:            { type: 'string', description: 'Event title' },
        start_time:       { type: 'string', description: 'ISO 8601 datetime, e.g. 2026-07-01T14:00:00' },
        end_time:         { type: 'string', description: 'ISO 8601 datetime for when the event ends' },
        all_day:          { type: 'boolean', description: 'True if this is an all-day event' },
        location:         { type: 'string', description: 'Where the event takes place' },
        description:      { type: 'string', description: 'Additional notes or description' },
        reminder_minutes: { type: 'number', description: 'Minutes before event to send a reminder (default 30)' },
      },
    },
  },
  {
    name: 'search_events',
    description: 'Search for calendar events.',
    input_schema: {
      type: 'object',
      properties: {
        title:        { type: 'string',  description: 'Event title (partial match)' },
        from_date:    { type: 'string',  description: 'ISO date string' },
        to_date:      { type: 'string',  description: 'ISO date string' },
        upcoming_only:{ type: 'boolean', description: 'If true, only return future events' },
      },
    },
  },
  {
    name: 'update_event',
    description: 'Update an existing calendar event. First search_events to find the event ID.',
    input_schema: {
      type: 'object',
      required: ['event_id'],
      properties: {
        event_id:         { type: 'string' },
        title:            { type: 'string' },
        start_time:       { type: 'string' },
        end_time:         { type: 'string' },
        location:         { type: 'string' },
        description:      { type: 'string' },
        reminder_minutes: { type: 'number' },
      },
    },
  },
  {
    name: 'delete_event',
    description: 'Delete a calendar event.',
    input_schema: {
      type: 'object',
      required: ['event_id'],
      properties: { event_id: { type: 'string' } },
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task or to-do item.',
    input_schema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:       { type: 'string' },
        description: { type: 'string' },
        priority:    { type: 'string', description: 'low, medium, high, or urgent' },
        due_date:    { type: 'string', description: 'ISO date e.g. 2026-07-01' },
      },
    },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks.',
    input_schema: {
      type: 'object',
      properties: {
        title:     { type: 'string' },
        status:    { type: 'string', description: 'todo, in_progress, or completed' },
        priority:  { type: 'string' },
        due_before:{ type: 'string' },
        due_after: { type: 'string' },
        overdue:   { type: 'boolean' },
      },
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task as completed.',
    input_schema: {
      type: 'object',
      required: ['task_id'],
      properties: { task_id: { type: 'string' } },
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task.',
    input_schema: {
      type: 'object',
      required: ['task_id'],
      properties: { task_id: { type: 'string' } },
    },
  },
  {
    name: 'create_reminder',
    description: 'Create a reminder for a specific date and time.',
    input_schema: {
      type: 'object',
      required: ['title', 'remind_at'],
      properties: {
        title:           { type: 'string' },
        notes:           { type: 'string' },
        remind_at:       { type: 'string', description: 'ISO datetime' },
        repeat_interval: { type: 'string', description: 'none, daily, weekly, monthly, or yearly' },
      },
    },
  },
  {
    name: 'search_reminders',
    description: 'Search reminders.',
    input_schema: {
      type: 'object',
      properties: {
        title:   { type: 'string' },
        pending: { type: 'boolean' },
      },
    },
  },
  {
    name: 'delete_reminder',
    description: 'Delete a reminder.',
    input_schema: {
      type: 'object',
      required: ['reminder_id'],
      properties: { reminder_id: { type: 'string' } },
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new personal contact.',
    input_schema: {
      type: 'object',
      required: ['first_name'],
      properties: {
        first_name: { type: 'string' },
        last_name:  { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        birthday:   { type: 'string' },
        address:    { type: 'string' },
        category:   { type: 'string', description: 'personal, professional, or family' },
        notes:      { type: 'string' },
      },
    },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts.',
    input_schema: {
      type: 'object',
      properties: {
        name:     { type: 'string' },
        email:    { type: 'string' },
        category: { type: 'string' },
      },
    },
  },
  {
    name: 'update_contact',
    description: 'Update a contact. First search_contacts to find the ID.',
    input_schema: {
      type: 'object',
      required: ['contact_id'],
      properties: {
        contact_id: { type: 'string' },
        first_name: { type: 'string' },
        last_name:  { type: 'string' },
        email:      { type: 'string' },
        phone:      { type: 'string' },
        birthday:   { type: 'string' },
        address:    { type: 'string' },
        category:   { type: 'string' },
        notes:      { type: 'string' },
      },
    },
  },
  {
    name: 'create_note',
    description: 'Create a note.',
    input_schema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title:   { type: 'string' },
        content: { type: 'string' },
        tags:    { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'search_notes',
    description: 'Search notes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        tag:   { type: 'string' },
      },
    },
  },
  {
    name: 'find_location',
    description: 'Look up a location to show a map.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query:   { type: 'string' },
        context: { type: 'string' },
      },
    },
  },
  {
    name: 'draft_email',
    description: 'Draft a professional email.',
    input_schema: {
      type: 'object',
      required: ['purpose'],
      properties: {
        to:          { type: 'string' },
        subject:     { type: 'string' },
        purpose:     { type: 'string' },
        tone:        { type: 'string', description: 'professional, friendly, formal, or apologetic' },
        key_points:  { type: 'array', items: { type: 'string' } },
        from_name:   { type: 'string' },
      },
    },
  },
  {
    name: 'google_search_email',
    description: "Search the user's Gmail inbox. Returns matching messages with sender, subject, date and a snippet. Use Gmail search syntax, e.g. 'is:unread', 'from:jane@acme.com', 'newer_than:7d', 'has:attachment'. Requires the user to have connected Google.",
    input_schema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: "Gmail search query, e.g. 'is:unread newer_than:3d'" },
        max_results: { type: 'number', description: 'How many messages to return (default 10, max 25)' },
      },
    },
  },
  {
    name: 'google_read_email',
    description: 'Read the full body of one Gmail message. First use google_search_email to get the message ID.',
    input_schema: {
      type: 'object',
      required: ['message_id'],
      properties: { message_id: { type: 'string' } },
    },
  },
  {
    name: 'google_send_email',
    description: "Send an email from the user's Gmail account. Always confirm the recipient, subject and full body with the user before sending — this cannot be undone.",
    input_schema: {
      type: 'object',
      required: ['to', 'subject', 'body'],
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string' },
        body:    { type: 'string', description: 'Plain text body of the email' },
        cc:      { type: 'string', description: 'Optional CC address' },
      },
    },
  },
  {
    name: 'google_list_events',
    description: "List events from the user's Google Calendar within a date range.",
    input_schema: {
      type: 'object',
      properties: {
        from_date: { type: 'string', description: 'ISO date, defaults to today' },
        to_date:   { type: 'string', description: 'ISO date, defaults to 7 days ahead' },
      },
    },
  },
  {
    name: 'google_create_event',
    description: "Create an event in the user's Google Calendar. Use this rather than create_event when the user means their real Google calendar.",
    input_schema: {
      type: 'object',
      required: ['title', 'start_time'],
      properties: {
        title:       { type: 'string' },
        start_time:  { type: 'string', description: 'ISO 8601 datetime, e.g. 2026-07-01T14:00:00' },
        end_time:    { type: 'string', description: 'ISO 8601 datetime. Defaults to one hour after start.' },
        description: { type: 'string' },
        location:    { type: 'string' },
        attendees:   { type: 'array', items: { type: 'string' }, description: 'Email addresses to invite' },
      },
    },
  },
  {
    name: 'google_search_drive',
    description: "Search the user's Google Drive for files by name or content. Returns file names, types and IDs.",
    input_schema: {
      type: 'object',
      properties: {
        query:       { type: 'string', description: 'Words to search for in the file name or contents' },
        max_results: { type: 'number', description: 'Default 10, max 25' },
      },
    },
  },
  {
    name: 'google_read_drive_file',
    description: 'Read the text contents of a Google Doc, Sheet, Slide or plain text file from Drive. First use google_search_drive to get the file ID.',
    input_schema: {
      type: 'object',
      required: ['file_id'],
      properties: { file_id: { type: 'string' } },
    },
  },
  {
    name: 'crm_search_companies',
    description: 'Search CRM companies.',
    input_schema: {
      type: 'object',
      properties: {
        name:   { type: 'string' },
        status: { type: 'string' },
      },
    },
  },
  {
    name: 'crm_search_contacts',
    description: 'Search CRM contacts.',
    input_schema: {
      type: 'object',
      properties: {
        name:         { type: 'string' },
        company_name: { type: 'string' },
      },
    },
  },
  {
    name: 'crm_search_tasks',
    description: 'Search CRM tasks.',
    input_schema: {
      type: 'object',
      properties: {
        title:   { type: 'string' },
        status:  { type: 'string' },
        overdue: { type: 'boolean' },
      },
    },
  },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

async function nominatimGeocode(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': 'SmartCore Nova AI Assistant (smartcoretechnology.co.uk)' } }
    );
    const data = await res.json();
    if (data && data[0]) {
      return { display_name: data[0].display_name, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), found: true };
    }
  } catch (_) {}
  return { found: false };
}

// ── Gmail helpers ───────────────────────────────────────────────────────────
function b64urlDecode(data) {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (_) { return ''; }
}

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function headerVal(payload, name) {
  return payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// Walks the MIME tree preferring text/plain, falling back to stripped HTML.
function extractBody(payload) {
  if (!payload) return '';
  if (payload.body?.data && (!payload.mimeType || payload.mimeType.startsWith('text/'))) {
    const text = b64urlDecode(payload.body.data);
    return payload.mimeType === 'text/html' ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : text;
  }
  for (const part of payload.parts || []) {
    if (part.mimeType === 'text/plain' && part.body?.data) return b64urlDecode(part.body.data);
  }
  for (const part of payload.parts || []) {
    const nested = extractBody(part);
    if (nested) return nested;
  }
  return '';
}

async function runTool(toolName, input, userId, companyId, svcHdr, cards, env) {
  const base = `${SUPABASE_URL}/rest/v1`;
  const enc = encodeURIComponent;
  const nova = (path, opts = {}) => fetch(`${base}/${path}`, { ...opts, headers: { ...svcHdr, ...(opts.headers || {}) } });

  try {
    if (toolName === 'get_today_briefing') {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);
      const todayEnd = `${todayStr}T23:59:59`;
      const [eventsRes, tasksRes, remindersRes] = await Promise.all([
        nova(`nova_events?user_id=eq.${userId}&start_time=gte.${todayStr}&start_time=lte.${todayEnd}&order=start_time&select=id,title,start_time,end_time,location&limit=10`),
        nova(`nova_tasks?user_id=eq.${userId}&status=neq.completed&due_date=lte.${todayStr}&order=due_date&select=id,title,priority,due_date,status&limit=15`),
        nova(`nova_reminders?user_id=eq.${userId}&sent=eq.false&remind_at=lte.${todayEnd}&order=remind_at&select=id,title,remind_at&limit=10`),
      ]);
      const events = await eventsRes.json().catch(() => []);
      const tasks = await tasksRes.json().catch(() => []);
      const reminders = await remindersRes.json().catch(() => []);
      let summary = `BRIEFING FOR ${todayStr}:\n`;
      summary += `\nCALENDAR TODAY (${Array.isArray(events) ? events.length : 0} event${events.length !== 1 ? 's' : ''}):\n`;
      if (Array.isArray(events) && events.length) {
        events.forEach((e, i) => { const t = e.start_time ? e.start_time.slice(11, 16) : 'all day'; summary += `${i+1}. ${e.title} at ${t}${e.location ? ` — ${e.location}` : ''}\n`; });
      } else { summary += 'No events scheduled today.\n'; }
      summary += `\nTASKS DUE / OVERDUE (${Array.isArray(tasks) ? tasks.length : 0}):\n`;
      if (Array.isArray(tasks) && tasks.length) {
        tasks.forEach((t, i) => { const overdue = t.due_date < todayStr ? ' (OVERDUE)' : ''; summary += `${i+1}. [${t.priority?.toUpperCase() || 'MEDIUM'}] ${t.title}${t.due_date ? ` — due ${t.due_date}` : ''}${overdue}\n`; });
      } else { summary += 'No tasks due today.\n'; }
      summary += `\nREMINDERS (${Array.isArray(reminders) ? reminders.length : 0}):\n`;
      if (Array.isArray(reminders) && reminders.length) {
        reminders.forEach((r, i) => { summary += `${i+1}. ${r.title} — ${r.remind_at?.slice(0, 16).replace('T', ' ')}\n`; });
      } else { summary += 'No pending reminders.\n'; }
      return summary;
    }

    if (toolName === 'create_event') {
      const body = { user_id: userId, company_id: companyId, title: input.title, start_time: input.start_time, ...(input.end_time && { end_time: input.end_time }), ...(input.all_day != null && { all_day: input.all_day }), ...(input.location && { location: input.location }), ...(input.description && { description: input.description }), ...(input.reminder_minutes != null && { reminder_minutes: input.reminder_minutes }) };
      const res = await nova('nova_events', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) return `Failed to create event: ${JSON.stringify(result)}`;
      const ev = Array.isArray(result) ? result[0] : result;
      cards.push({ type: 'event', action: 'created', data: ev });
      return `Event created: "${ev.title}" on ${ev.start_time?.slice(0, 16).replace('T', ' ')}${ev.location ? ` at ${ev.location}` : ''} (ID: ${ev.id})`;
    }

    if (toolName === 'search_events') {
      let url = `nova_events?user_id=eq.${userId}&order=start_time&select=id,title,start_time,end_time,location,description&limit=20`;
      if (input.title) url += `&title=ilike.*${enc(input.title)}*`;
      if (input.from_date) url += `&start_time=gte.${enc(input.from_date)}`;
      if (input.to_date) url += `&start_time=lte.${enc(input.to_date)}T23:59:59`;
      if (input.upcoming_only) url += `&start_time=gte.${new Date().toISOString()}`;
      const res = await nova(url);
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No events found.';
      cards.push({ type: 'event_list', data });
      return `Found ${data.length} event(s):\n` + data.map((e, i) => `${i+1}. ${e.title} | ${e.start_time?.slice(0, 16).replace('T', ' ')}${e.location ? ` | ${e.location}` : ''} | ID:${e.id}`).join('\n');
    }

    if (toolName === 'update_event') {
      const { event_id, ...fields } = input;
      const updates = {};
      if (fields.title) updates.title = fields.title;
      if (fields.start_time) updates.start_time = fields.start_time;
      if (fields.end_time) updates.end_time = fields.end_time;
      if (fields.location) updates.location = fields.location;
      if (fields.description) updates.description = fields.description;
      if (fields.reminder_minutes != null) updates.reminder_minutes = fields.reminder_minutes;
      const res = await nova(`nova_events?id=eq.${enc(event_id)}&user_id=eq.${userId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(updates) });
      if (!res.ok) return `Failed to update event.`;
      return `Event updated successfully.`;
    }

    if (toolName === 'delete_event') {
      const res = await nova(`nova_events?id=eq.${enc(input.event_id)}&user_id=eq.${userId}`, { method: 'DELETE' });
      if (!res.ok) return `Failed to delete event.`;
      return `Event deleted.`;
    }

    if (toolName === 'create_task') {
      const body = { user_id: userId, company_id: companyId, title: input.title, priority: input.priority || 'medium', status: 'todo', ...(input.description && { description: input.description }), ...(input.due_date && { due_date: input.due_date }) };
      const res = await nova('nova_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) return `Failed to create task: ${JSON.stringify(result)}`;
      const task = Array.isArray(result) ? result[0] : result;
      cards.push({ type: 'task', action: 'created', data: task });
      return `Task created: "${task.title}"${task.due_date ? `, due ${task.due_date}` : ''}, priority: ${task.priority} (ID: ${task.id})`;
    }

    if (toolName === 'search_tasks') {
      const todayStr = new Date().toISOString().slice(0, 10);
      let url = `nova_tasks?user_id=eq.${userId}&order=due_date&select=id,title,priority,status,due_date,description&limit=25`;
      if (input.title) url += `&title=ilike.*${enc(input.title)}*`;
      if (input.status) url += `&status=eq.${enc(input.status)}`;
      if (input.priority) url += `&priority=eq.${enc(input.priority)}`;
      if (input.due_before) url += `&due_date=lte.${enc(input.due_before)}`;
      if (input.due_after) url += `&due_date=gte.${enc(input.due_after)}`;
      if (input.overdue) url += `&due_date=lt.${todayStr}&status=neq.completed`;
      const res = await nova(url);
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No tasks found.';
      cards.push({ type: 'task_list', data });
      return `Found ${data.length} task(s):\n` + data.map((t, i) => `${i+1}. [${t.priority?.toUpperCase()}] ${t.title} — ${t.status}${t.due_date ? ` | due ${t.due_date}` : ''} | ID:${t.id}`).join('\n');
    }

    if (toolName === 'complete_task') {
      const res = await nova(`nova_tasks?id=eq.${enc(input.task_id)}&user_id=eq.${userId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }) });
      if (!res.ok) return `Failed to complete task.`;
      return `Task marked as completed.`;
    }

    if (toolName === 'delete_task') {
      const res = await nova(`nova_tasks?id=eq.${enc(input.task_id)}&user_id=eq.${userId}`, { method: 'DELETE' });
      if (!res.ok) return `Failed to delete task.`;
      return `Task deleted.`;
    }

    if (toolName === 'create_reminder') {
      const body = { user_id: userId, company_id: companyId, title: input.title, remind_at: input.remind_at, repeat_interval: input.repeat_interval || 'none', ...(input.notes && { notes: input.notes }) };
      const res = await nova('nova_reminders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) return `Failed to create reminder: ${JSON.stringify(result)}`;
      const rem = Array.isArray(result) ? result[0] : result;
      cards.push({ type: 'reminder', action: 'created', data: rem });
      return `Reminder set: "${rem.title}" at ${rem.remind_at?.slice(0, 16).replace('T', ' ')}${rem.repeat_interval !== 'none' ? `, repeating ${rem.repeat_interval}` : ''} (ID: ${rem.id})`;
    }

    if (toolName === 'search_reminders') {
      let url = `nova_reminders?user_id=eq.${userId}&order=remind_at&select=id,title,remind_at,repeat_interval,notes&limit=20`;
      if (input.title) url += `&title=ilike.*${enc(input.title)}*`;
      if (input.pending) url += `&sent=eq.false`;
      const res = await nova(url);
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No reminders found.';
      return `Found ${data.length} reminder(s):\n` + data.map((r, i) => `${i+1}. ${r.title} — ${r.remind_at?.slice(0, 16).replace('T', ' ')} | ID:${r.id}`).join('\n');
    }

    if (toolName === 'delete_reminder') {
      const res = await nova(`nova_reminders?id=eq.${enc(input.reminder_id)}&user_id=eq.${userId}`, { method: 'DELETE' });
      if (!res.ok) return `Failed to delete reminder.`;
      return `Reminder deleted.`;
    }

    if (toolName === 'create_contact') {
      const body = { user_id: userId, company_id: companyId, first_name: input.first_name, ...(input.last_name && { last_name: input.last_name }), ...(input.email && { email: input.email }), ...(input.phone && { phone: input.phone }), ...(input.birthday && { birthday: input.birthday }), ...(input.address && { address: input.address }), ...(input.category && { category: input.category }), ...(input.notes && { notes: input.notes }) };
      const res = await nova('nova_contacts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) return `Failed to create contact: ${JSON.stringify(result)}`;
      const contact = Array.isArray(result) ? result[0] : result;
      cards.push({ type: 'contact', action: 'created', data: contact });
      return `Contact created: ${contact.first_name}${contact.last_name ? ' ' + contact.last_name : ''}${contact.email ? ` (${contact.email})` : ''} (ID: ${contact.id})`;
    }

    if (toolName === 'search_contacts') {
      let url = `nova_contacts?user_id=eq.${userId}&order=first_name&select=id,first_name,last_name,email,phone,birthday,address,category,notes&limit=20`;
      if (input.name) url += `&or=(first_name.ilike.*${enc(input.name)}*,last_name.ilike.*${enc(input.name)}*)`;
      if (input.email) url += `&email=ilike.*${enc(input.email)}*`;
      if (input.category) url += `&category=eq.${enc(input.category)}`;
      const res = await nova(url);
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No contacts found.';
      cards.push({ type: 'contact_list', data });
      return `Found ${data.length} contact(s):\n` + data.map((c, i) => `${i+1}. ${c.first_name}${c.last_name ? ' ' + c.last_name : ''}${c.email ? ` — ${c.email}` : ''} | ID:${c.id}`).join('\n');
    }

    if (toolName === 'update_contact') {
      const { contact_id, ...fields } = input;
      const updates = {};
      ['first_name','last_name','email','phone','birthday','address','category','notes'].forEach(f => { if (fields[f] !== undefined) updates[f] = fields[f]; });
      const res = await nova(`nova_contacts?id=eq.${enc(contact_id)}&user_id=eq.${userId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(updates) });
      if (!res.ok) return `Failed to update contact.`;
      return `Contact updated successfully.`;
    }

    if (toolName === 'create_note') {
      const body = { user_id: userId, company_id: companyId, title: input.title, content: input.content, tags: input.tags || [] };
      const res = await nova('nova_notes', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
      const result = await res.json();
      if (!res.ok) return `Failed to create note: ${JSON.stringify(result)}`;
      const note = Array.isArray(result) ? result[0] : result;
      cards.push({ type: 'note', action: 'created', data: note });
      return `Note saved: "${note.title}" (ID: ${note.id})`;
    }

    if (toolName === 'search_notes') {
      let url = `nova_notes?user_id=eq.${userId}&order=created_at.desc&select=id,title,content,tags,created_at&limit=15`;
      if (input.query) url += `&or=(title.ilike.*${enc(input.query)}*,content.ilike.*${enc(input.query)}*)`;
      if (input.tag) url += `&tags=cs.{${enc(input.tag)}}`;
      const res = await nova(url);
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No notes found.';
      cards.push({ type: 'note_list', data });
      return `Found ${data.length} note(s):\n` + data.map((n, i) => `${i+1}. "${n.title}" — ${n.content.slice(0, 80)}... | ID:${n.id}`).join('\n');
    }

    if (toolName === 'find_location') {
      const geo = await nominatimGeocode(input.query);
      if (geo.found) {
        cards.push({ type: 'map', query: input.query, display_name: geo.display_name, lat: geo.lat, lng: geo.lng });
        return `Location found: ${geo.display_name}. A map has been displayed.`;
      }
      cards.push({ type: 'map', query: input.query, found: false });
      return `Could not find exact coordinates for "${input.query}".`;
    }

    if (toolName === 'draft_email') {
      const subject = input.subject || `Re: ${input.purpose?.slice(0, 40)}`;
      cards.push({ type: 'email_draft', to: input.to || '', subject, purpose: input.purpose, tone: input.tone || 'professional', key_points: input.key_points || [], from_name: input.from_name || '' });
      return `Email draft prepared. To: ${input.to || '(recipient)'}, Subject: ${subject}. The draft is shown in the panel.`;
    }

    // ── Google Workspace ──────────────────────────────────────────────────
    if (toolName.startsWith('google_')) {
      const token = await getValidAccessToken(userId, svcHdr, env);
      if (!token) {
        return 'The user has not connected their Google account yet. Tell them to open Settings, go to Integrations, and click Connect Google.';
      }
      const g = 'https://www.googleapis.com';

      if (toolName === 'google_search_email') {
        const max = Math.min(input.max_results || 10, 25);
        const q = enc(input.query || 'in:inbox');
        const list = await googleApi(token, `${g}/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`);
        if (!list.ok) return `Gmail error: ${list.error}`;
        const ids = (list.data.messages || []).map(m => m.id);
        if (!ids.length) return 'No emails matched that search.';

        const msgs = await Promise.all(ids.map(async id => {
          const r = await googleApi(token, `${g}/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
          if (!r.ok) return null;
          return {
            id,
            from:    headerVal(r.data.payload, 'From'),
            subject: headerVal(r.data.payload, 'Subject'),
            date:    headerVal(r.data.payload, 'Date'),
            snippet: r.data.snippet || '',
            unread:  (r.data.labelIds || []).includes('UNREAD'),
          };
        }));

        const found = msgs.filter(Boolean);
        cards.push({ type: 'email_list', data: found });
        return `Found ${found.length} email(s):\n` + found.map((m, i) =>
          `${i + 1}. ${m.unread ? '[UNREAD] ' : ''}From: ${m.from} | Subject: ${m.subject} | ${m.date}\n   ${m.snippet}\n   ID:${m.id}`
        ).join('\n');
      }

      if (toolName === 'google_read_email') {
        const r = await googleApi(token, `${g}/gmail/v1/users/me/messages/${enc(input.message_id)}?format=full`);
        if (!r.ok) return `Gmail error: ${r.error}`;
        const body = extractBody(r.data.payload).slice(0, 6000);
        return `From: ${headerVal(r.data.payload, 'From')}\nTo: ${headerVal(r.data.payload, 'To')}\nSubject: ${headerVal(r.data.payload, 'Subject')}\nDate: ${headerVal(r.data.payload, 'Date')}\n\n${body || '(no readable text body)'}`;
      }

      if (toolName === 'google_send_email') {
        const lines = [
          `To: ${input.to}`,
          ...(input.cc ? [`Cc: ${input.cc}`] : []),
          `Subject: ${input.subject}`,
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          input.body,
        ];
        const r = await googleApi(token, `${g}/gmail/v1/users/me/messages/send`, {
          method: 'POST',
          body: JSON.stringify({ raw: b64urlEncode(lines.join('\r\n')) }),
        });
        if (!r.ok) return `Could not send the email: ${r.error}`;
        cards.push({ type: 'email_sent', to: input.to, subject: input.subject });
        return `Email sent to ${input.to} with subject "${input.subject}".`;
      }

      if (toolName === 'google_list_events') {
        const from = input.from_date ? new Date(input.from_date) : new Date();
        const to   = input.to_date ? new Date(input.to_date) : new Date(Date.now() + 7 * 864e5);
        const url = `${g}/calendar/v3/calendars/primary/events?timeMin=${enc(from.toISOString())}&timeMax=${enc(to.toISOString())}&singleEvents=true&orderBy=startTime&maxResults=25`;
        const r = await googleApi(token, url);
        if (!r.ok) return `Calendar error: ${r.error}`;
        const items = r.data.items || [];
        if (!items.length) return 'No Google Calendar events in that period.';
        cards.push({ type: 'gcal_list', data: items.map(e => ({ id: e.id, title: e.summary, start: e.start?.dateTime || e.start?.date, location: e.location })) });
        return `Found ${items.length} Google Calendar event(s):\n` + items.map((e, i) => {
          const start = e.start?.dateTime ? e.start.dateTime.slice(0, 16).replace('T', ' ') : `${e.start?.date} (all day)`;
          return `${i + 1}. ${e.summary || '(no title)'} — ${start}${e.location ? ` | ${e.location}` : ''}${e.attendees?.length ? ` | ${e.attendees.length} attendee(s)` : ''}`;
        }).join('\n');
      }

      if (toolName === 'google_create_event') {
        const start = new Date(input.start_time);
        const end = input.end_time ? new Date(input.end_time) : new Date(start.getTime() + 3600e3);
        const payload = {
          summary: input.title,
          start: { dateTime: start.toISOString() },
          end:   { dateTime: end.toISOString() },
          ...(input.description && { description: input.description }),
          ...(input.location && { location: input.location }),
          ...(input.attendees?.length && { attendees: input.attendees.map(e => ({ email: e })) }),
        };
        const r = await googleApi(token, `${g}/calendar/v3/calendars/primary/events?sendUpdates=all`, {
          method: 'POST', body: JSON.stringify(payload),
        });
        if (!r.ok) return `Could not create the event: ${r.error}`;
        cards.push({ type: 'gcal_event', action: 'created', data: { id: r.data.id, title: r.data.summary, start: r.data.start?.dateTime, link: r.data.htmlLink } });
        return `Google Calendar event created: "${r.data.summary}" on ${r.data.start?.dateTime?.slice(0, 16).replace('T', ' ')}.`;
      }

      if (toolName === 'google_search_drive') {
        const max = Math.min(input.max_results || 10, 25);
        const q = input.query ? `fullText contains '${String(input.query).replace(/'/g, "\\'")}' and trashed = false` : 'trashed = false';
        const url = `${g}/drive/v3/files?q=${enc(q)}&pageSize=${max}&fields=${enc('files(id,name,mimeType,modifiedTime,webViewLink)')}&orderBy=modifiedTime desc`;
        const r = await googleApi(token, url);
        if (!r.ok) return `Drive error: ${r.error}`;
        const files = r.data.files || [];
        if (!files.length) return 'No Drive files matched that search.';
        cards.push({ type: 'drive_list', data: files });
        return `Found ${files.length} Drive file(s):\n` + files.map((f, i) =>
          `${i + 1}. ${f.name} (${f.mimeType?.split('.').pop()}) — modified ${f.modifiedTime?.slice(0, 10)} | ID:${f.id}`
        ).join('\n');
      }

      if (toolName === 'google_read_drive_file') {
        const meta = await googleApi(token, `${g}/drive/v3/files/${enc(input.file_id)}?fields=name,mimeType`);
        if (!meta.ok) return `Drive error: ${meta.error}`;
        const mime = meta.data.mimeType || '';

        // Google-native formats must be exported; everything else downloads directly.
        const exportAs = mime === 'application/vnd.google-apps.document' ? 'text/plain'
                       : mime === 'application/vnd.google-apps.spreadsheet' ? 'text/csv'
                       : mime === 'application/vnd.google-apps.presentation' ? 'text/plain'
                       : null;

        const url = exportAs
          ? `${g}/drive/v3/files/${enc(input.file_id)}/export?mimeType=${enc(exportAs)}`
          : `${g}/drive/v3/files/${enc(input.file_id)}?alt=media`;

        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return `Could not read "${meta.data.name}": ${res.status}. Binary formats like PDF and images cannot be read this way — ask the user to download and upload it instead.`;
        const text = (await res.text()).slice(0, 8000);
        return `Contents of "${meta.data.name}":\n\n${text}`;
      }
    }

    if (toolName === 'crm_search_companies') {
      let url = `${base}/crm_companies?tenant_id=eq.${companyId}&select=name,status,industry,email,phone,city&order=name&limit=15`;
      if (input.name) url += `&name=ilike.*${enc(input.name)}*`;
      if (input.status) url += `&status=eq.${enc(input.status)}`;
      const res = await fetch(url, { headers: svcHdr });
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No CRM companies found.';
      return `Found ${data.length} CRM company/companies:\n` + data.map((c, i) => `${i+1}. ${c.name} — ${c.status}${c.industry ? `, ${c.industry}` : ''}${c.city ? `, ${c.city}` : ''}`).join('\n');
    }

    if (toolName === 'crm_search_contacts') {
      let url = `${base}/crm_contacts?tenant_id=eq.${companyId}&select=first_name,last_name,email,phone,job_title,crm_companies(name)&order=first_name&limit=15`;
      if (input.name) url += `&or=(first_name.ilike.*${enc(input.name)}*,last_name.ilike.*${enc(input.name)}*)`;
      const res = await fetch(url, { headers: svcHdr });
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No CRM contacts found.';
      return `Found ${data.length} CRM contact(s):\n` + data.map((c, i) => `${i+1}. ${c.first_name} ${c.last_name || ''}${c.job_title ? `, ${c.job_title}` : ''}${c.crm_companies?.name ? ` at ${c.crm_companies.name}` : ''}${c.email ? ` — ${c.email}` : ''}`).join('\n');
    }

    if (toolName === 'crm_search_tasks') {
      const todayStr = new Date().toISOString().slice(0, 10);
      let url = `${base}/crm_tasks?tenant_id=eq.${companyId}&select=title,status,priority,due_date&order=due_date&limit=20`;
      if (input.title) url += `&title=ilike.*${enc(input.title)}*`;
      if (input.status) url += `&status=eq.${enc(input.status)}`;
      if (input.overdue) url += `&due_date=lt.${todayStr}&status=neq.completed`;
      const res = await fetch(url, { headers: svcHdr });
      const data = await res.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) return 'No CRM tasks found.';
      return `Found ${data.length} CRM task(s):\n` + data.map((t, i) => `${i+1}. ${t.title} — ${t.status}, ${t.priority}${t.due_date ? ` | due ${t.due_date}` : ''}`).join('\n');
    }

    return 'Unknown tool.';
  } catch (e) {
    return `Tool error: ${e.message}`;
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
  });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  try {
    const auth = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!auth) return json({ ok: false, error: 'Unauthorised' }, 401);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${auth}` } });
    if (!userRes.ok) return json({ ok: false, error: 'Unauthorised' }, 401);
    const userData = await userRes.json();
    if (!userData?.id) return json({ ok: false, error: 'Unauthorised' }, 401);

    const svcHdr = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };

    const profRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${userData.id}&select=full_name,company_id&limit=1`, { headers: svcHdr });
    const profData = await profRes.json().catch(() => []);
    const profile = profData?.[0];
    if (!profile?.company_id) return json({ ok: false, error: 'Profile not found' }, 403);

    const userId    = userData.id;
    const companyId = profile.company_id;
    const userName  = (profile.full_name || 'there').split(' ')[0];

    const body = await request.json();
    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) return json({ ok: false, error: 'Missing messages' }, 400);

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ ok: false, error: 'AI not configured' }, 500);

    const today = new Date();
    const todayStr = today.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const systemPrompt = buildSystemPrompt(userName, todayStr);
    let currentMessages = [...messages];
    let reply = '';
    const cards = [];

    for (let i = 0; i < 15; i++) {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          // web_search runs on Anthropic's side; the rest are handled by runTool below.
          tools: [...TOOLS, { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          messages: currentMessages,
        }),
      });
      if (!claudeRes.ok) { const err = await claudeRes.text(); console.error('Claude API error:', err); return json({ ok: false, error: 'AI error' }, 500); }
      const data = await claudeRes.json();
      // A web_search turn returns several text blocks around the results, so
      // take all of them rather than just the first.
      const allText = (blocks) => (blocks || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

      if (data.stop_reason === 'end_turn') { reply = allText(data.content); break; }
      if (data.stop_reason === 'tool_use') {
        const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
        currentMessages = [...currentMessages, { role: 'assistant', content: data.content }];
        const toolResults = await Promise.all(toolUseBlocks.map(async tb => ({ type: 'tool_result', tool_use_id: tb.id, content: await runTool(tb.name, tb.input, userId, companyId, svcHdr, cards, env) })));
        currentMessages = [...currentMessages, { role: 'user', content: toolResults }];
        continue;
      }
      reply = allText(data.content);
      break;
    }

    return json({ ok: true, reply, cards });
  } catch (e) {
    console.error('Nova chat error:', e);
    return json({ ok: false, error: e.message }, 500);
  }
}
