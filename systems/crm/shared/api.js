import { sb } from "./supabase.js";
import { getProfile } from "./auth.js";

// Get tenant_id for current user
async function tid() {
  const p = await getProfile();
  return p.company_id;
}

// ── Companies ──────────────────────────────────────────────
export const companies = {
  async list({ search = "", status = "", limit = 100, offset = 0 } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_companies")
      .select("*", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("name")
      .range(offset, offset + limit - 1);
    if (search) q = q.ilike("name", `%${search}%`);
    if (status) q = q.eq("status", status);
    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  },

  async get(id) {
    const { data, error } = await sb().from("crm_companies").select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  },

  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_companies")
      .insert({ ...fields, tenant_id: tenantId, created_by: p.id })
      .select().single();
    if (error) throw error;
    await activities.log({ crm_company_id: data.id, type: "company_created", title: `Company created: ${data.name}` });
    return data;
  },

  async update(id, fields) {
    const { data, error } = await sb().from("crm_companies")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await sb().from("crm_companies").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Contacts ───────────────────────────────────────────────
export const contacts = {
  async list({ search = "", companyId = "", status = "", limit = 100, offset = 0 } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_contacts")
      .select("*, crm_companies(name)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("first_name")
      .range(offset, offset + limit - 1);
    if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    if (companyId) q = q.eq("crm_company_id", companyId);
    if (status) q = q.eq("status", status);
    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  },

  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_contacts")
      .insert({ ...fields, tenant_id: tenantId, created_by: p.id })
      .select().single();
    if (error) throw error;
    if (fields.crm_company_id) {
      await activities.log({ crm_company_id: fields.crm_company_id, crm_contact_id: data.id, type: "contact_added", title: `Contact added: ${data.first_name} ${data.last_name}` });
    }
    return data;
  },

  async update(id, fields) {
    const { data, error } = await sb().from("crm_contacts")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await sb().from("crm_contacts").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Leads ──────────────────────────────────────────────────
export const leads = {
  async list({ search = "", status = "", assignedTo = "", stage = "", limit = 200, offset = 0 } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_leads")
      .select("*, crm_companies(name), crm_contacts(first_name, last_name)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (search) q = q.ilike("title", `%${search}%`);
    if (status) q = q.eq("status", status);
    if (assignedTo) q = q.eq("assigned_to", assignedTo);
    if (stage) q = q.eq("pipeline_stage", stage);
    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  },

  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_leads")
      .insert({ ...fields, tenant_id: tenantId, created_by: p.id })
      .select().single();
    if (error) throw error;
    if (fields.crm_company_id) {
      await activities.log({ crm_company_id: fields.crm_company_id, crm_lead_id: data.id, type: "lead_created", title: `Lead created: ${data.title}` });
    }
    return data;
  },

  async update(id, fields) {
    const { data, error } = await sb().from("crm_leads")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async updateStage(id, stage) {
    const statusMap = { new: "new", contacted: "contacted", qualified: "qualified", proposal_sent: "proposal_sent", negotiation: "negotiation", won: "won", lost: "lost" };
    const { data, error } = await sb().from("crm_leads")
      .update({ pipeline_stage: stage, status: statusMap[stage] || stage, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await sb().from("crm_leads").delete().eq("id", id);
    if (error) throw error;
  },

  async pipelineStats() {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_leads")
      .select("pipeline_stage, estimated_value, status")
      .eq("tenant_id", tenantId);
    if (error) throw error;
    return data || [];
  },
};

// ── Activities ─────────────────────────────────────────────
export const activities = {
  async list(companyId, limit = 50) {
    const { data, error } = await sb().from("crm_activities")
      .select("*")
      .eq("crm_company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async recent(limit = 20) {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_activities")
      .select("*, crm_companies(name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async log({ crm_company_id, crm_contact_id, crm_lead_id, type, title, description, metadata }) {
    const tenantId = await tid();
    const p = await getProfile();
    const { error } = await sb().from("crm_activities").insert({
      tenant_id: tenantId,
      crm_company_id: crm_company_id || null,
      crm_contact_id: crm_contact_id || null,
      crm_lead_id: crm_lead_id || null,
      type, title,
      description: description || null,
      metadata: metadata || {},
      created_by: p.id,
    });
    if (error) console.error("Activity log error:", error);
  },
};

// ── Tasks ──────────────────────────────────────────────────
export const tasks = {
  async list({ status = "", priority = "", assignedTo = "", companyId = "", dueToday = false, limit = 100 } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_tasks")
      .select("*, crm_companies(name), crm_leads(title)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    if (priority) q = q.eq("priority", priority);
    if (assignedTo) q = q.eq("assigned_to", assignedTo);
    if (companyId) q = q.eq("crm_company_id", companyId);
    if (dueToday) {
      const today = new Date().toISOString().slice(0,10);
      q = q.gte("due_date", today + "T00:00:00").lte("due_date", today + "T23:59:59");
    }
    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  },

  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_tasks")
      .insert({ ...fields, tenant_id: tenantId, created_by: p.id })
      .select().single();
    if (error) throw error;
    return data;
  },

  async update(id, fields) {
    const { data, error } = await sb().from("crm_tasks")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async complete(id) {
    const p = await getProfile();
    return tasks.update(id, { status: "completed", completed_at: new Date().toISOString(), completed_by: p.id });
  },

  async delete(id) {
    const { error } = await sb().from("crm_tasks").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Events ─────────────────────────────────────────────────
export const events = {
  async list({ from, to, limit = 200 } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_events")
      .select("*, crm_companies(name)")
      .eq("tenant_id", tenantId)
      .order("start_time")
      .limit(limit);
    if (from) q = q.gte("start_time", from);
    if (to)   q = q.lte("start_time", to);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_events")
      .insert({ ...fields, tenant_id: tenantId, created_by: p.id })
      .select().single();
    if (error) throw error;
    return data;
  },

  async update(id, fields) {
    const { data, error } = await sb().from("crm_events")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await sb().from("crm_events").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Quotes ─────────────────────────────────────────────────
export const quotes = {
  async list({ status = "", companyId = "", limit = 100 } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_quotes")
      .select("*, crm_companies(name)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) q = q.eq("status", status);
    if (companyId) q = q.eq("crm_company_id", companyId);
    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  },

  async nextNumber(tenantId) {
    const year = new Date().getFullYear();
    const { data } = await sb().from("crm_quotes")
      .select("quote_number")
      .eq("tenant_id", tenantId)
      .ilike("quote_number", `QT-${year}-%`)
      .order("quote_number", { ascending: false })
      .limit(1);
    const last = data?.[0]?.quote_number;
    const seq = last ? parseInt(last.split("-")[2] || "0", 10) + 1 : 1;
    return `QT-${year}-${String(seq).padStart(4, "0")}`;
  },

  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const quote_number = await quotes.nextNumber(tenantId);
    const { data, error } = await sb().from("crm_quotes")
      .insert({ ...fields, tenant_id: tenantId, created_by: p.id, quote_number })
      .select().single();
    if (error) throw error;
    if (fields.crm_company_id) {
      await activities.log({ crm_company_id: fields.crm_company_id, crm_lead_id: fields.crm_lead_id, type: "quote_created", title: `Quote created: ${quote_number}`, metadata: { quote_id: data.id, total: data.total } });
    }
    return data;
  },

  async update(id, fields) {
    const { data, error } = await sb().from("crm_quotes")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await sb().from("crm_quotes").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Documents ──────────────────────────────────────────────
export const documents = {
  async list({ companyId = "", category = "", limit = 100 } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_documents")
      .select("*, crm_companies(name)", { count: "exact" })
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (companyId) q = q.eq("crm_company_id", companyId);
    if (category) q = q.eq("category", category);
    const { data, count, error } = await q;
    if (error) throw error;
    return { data: data || [], count: count || 0 };
  },

  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_documents")
      .insert({ ...fields, tenant_id: tenantId, uploaded_by: p.id })
      .select().single();
    if (error) throw error;
    if (fields.crm_company_id) {
      await activities.log({ crm_company_id: fields.crm_company_id, type: "document_uploaded", title: `Document uploaded: ${fields.name}` });
    }
    return data;
  },

  async delete(id) {
    const { error } = await sb().from("crm_documents").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Dashboard stats ────────────────────────────────────────
export async function dashboardStats() {
  const tenantId = await tid();
  const today = new Date().toISOString().slice(0,10);

  const [comps, leads_, tasks_, events_, pipeline, activities_] = await Promise.all([
    sb().from("crm_companies").select("status", { count: "exact", head: false }).eq("tenant_id", tenantId),
    sb().from("crm_leads").select("status, estimated_value, probability, pipeline_stage", { count: "exact" }).eq("tenant_id", tenantId),
    sb().from("crm_tasks").select("status, due_date", { count: "exact" }).eq("tenant_id", tenantId),
    sb().from("crm_events").select("id, title, start_time, type, crm_companies(name)").eq("tenant_id", tenantId).gte("start_time", new Date().toISOString()).order("start_time").limit(5),
    sb().from("crm_leads").select("pipeline_stage, estimated_value").eq("tenant_id", tenantId).not("status", "in", '("won","lost")'),
    sb().from("crm_activities").select("id, type, title, created_at, crm_companies(name)").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(10),
  ]);

  const companies_ = comps.data || [];
  const leadsData  = leads_.data || [];
  const tasksData  = tasks_.data || [];

  const activeCompanies = companies_.filter(c => c.status === "active").length;
  const totalCompanies  = companies_.length;
  const activeLeads     = leadsData.filter(l => !["won","lost"].includes(l.status)).length;
  const wonLeads        = leadsData.filter(l => l.status === "won").length;
  const lostLeads       = leadsData.filter(l => l.status === "lost").length;
  const pipelineValue   = (pipeline.data || []).reduce((s,l) => s + (Number(l.estimated_value)||0), 0);
  const forecast        = leadsData.filter(l => !["won","lost"].includes(l.status)).reduce((s,l) => s + (Number(l.estimated_value)||0) * ((l.probability||0)/100), 0);
  const todayTasks      = tasksData.filter(t => t.due_date && t.due_date.slice(0,10) === today && t.status !== "completed").length;
  const overdueTasks    = tasksData.filter(t => t.due_date && t.due_date < new Date().toISOString() && t.status !== "completed").length;

  return {
    totalCompanies, activeCompanies, activeLeads, wonLeads, lostLeads,
    pipelineValue, forecast, todayTasks, overdueTasks,
    upcomingEvents: events_.data || [],
    recentActivity: activities_.data || [],
  };
}

// ── Staff list (from core_employees) ──────────────────────
export async function getStaff() {
  const tenantId = await tid();
  const { data, error } = await sb().from("core_employees")
    .select("id, full_name, role, work_email")
    .eq("company_id", tenantId)
    .order("full_name");
  if (error) throw error;
  return data || [];
}

// ── Portal Users ───────────────────────────────────────────
export const portalUsers = {
  async list() {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_portal_users")
      .select("*, crm_contacts(first_name, last_name, email), crm_companies(name)")
      .eq("tenant_id", tenantId)
      .order("invited_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async invite(email, name, contactId = null) {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_portal_users")
      .upsert({ tenant_id: tenantId, email, name, crm_contact_id: contactId, status: "invited", invited_at: new Date().toISOString() }, { onConflict: "tenant_id,email" })
      .select().single();
    if (error) throw error;
    return data;
  },
  async activate(id, authUserId) {
    const { data, error } = await sb().from("crm_portal_users")
      .update({ auth_user_id: authUserId, status: "active", activated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async revoke(id) {
    const { error } = await sb().from("crm_portal_users").update({ status: "suspended" }).eq("id", id);
    if (error) throw error;
  },
};

// ── Messages ───────────────────────────────────────────────
export const messages = {
  async list(contactId) {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_messages")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("crm_contact_id", contactId)
      .order("created_at");
    if (error) throw error;
    return data || [];
  },
  async listAll() {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_messages")
      .select("*, crm_contacts(first_name, last_name, email)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async send(contactId, body, senderName) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_messages").insert({
      tenant_id: tenantId,
      crm_contact_id: contactId,
      sender_type: "staff",
      sender_id: p.id,
      sender_name: senderName || p.full_name,
      body,
    }).select().single();
    if (error) throw error;
    return data;
  },
  async markRead(contactId) {
    const tenantId = await tid();
    await sb().from("crm_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("crm_contact_id", contactId)
      .eq("sender_type", "customer")
      .is("read_at", null);
  },
};

// ── Projects ───────────────────────────────────────────────
export const projects = {
  async list({ companyId = "" } = {}) {
    const tenantId = await tid();
    let q = sb().from("crm_projects")
      .select("*, crm_companies(name), crm_project_milestones(*)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (companyId) q = q.eq("crm_company_id", companyId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async create(fields) {
    const tenantId = await tid();
    const p = await getProfile();
    const { data, error } = await sb().from("crm_projects")
      .insert({ ...fields, tenant_id: tenantId, created_by: p.id })
      .select().single();
    if (error) throw error;
    return data;
  },
  async update(id, fields) {
    const { data, error } = await sb().from("crm_projects")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async delete(id) {
    const { error } = await sb().from("crm_projects").delete().eq("id", id);
    if (error) throw error;
  },
  async addMilestone(projectId, fields) {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_project_milestones")
      .insert({ ...fields, project_id: projectId, tenant_id: tenantId })
      .select().single();
    if (error) throw error;
    return data;
  },
  async updateMilestone(id, fields) {
    const { data, error } = await sb().from("crm_project_milestones")
      .update(fields).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteMilestone(id) {
    const { error } = await sb().from("crm_project_milestones").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Signatures ─────────────────────────────────────────────
export const signatures = {
  async list() {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_signature_requests")
      .select("*, crm_contacts(first_name, last_name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async create(fields) {
    const tenantId = await tid();
    const { data, error } = await sb().from("crm_signature_requests")
      .insert({ ...fields, tenant_id: tenantId })
      .select().single();
    if (error) throw error;
    return data;
  },
  async getByToken(token) {
    const { data, error } = await sb().from("crm_signature_requests")
      .select("*").eq("token", token).single();
    if (error) throw error;
    return data;
  },
  async sign(token, signatureData) {
    const { data, error } = await sb().from("crm_signature_requests")
      .update({ status: "signed", signature_data: signatureData, signed_at: new Date().toISOString() })
      .eq("token", token).eq("status", "pending").select().single();
    if (error) throw error;
    return data;
  },
  async decline(token, reason) {
    const { data, error } = await sb().from("crm_signature_requests")
      .update({ status: "declined", decline_reason: reason, declined_at: new Date().toISOString() })
      .eq("token", token).eq("status", "pending").select().single();
    if (error) throw error;
    return data;
  },
};
