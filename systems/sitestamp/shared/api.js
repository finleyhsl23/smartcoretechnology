import { sb } from "./supabase.js";

const BUCKET = "sitestamp-media";

function throwIfError(error) { if (error) throw error; }

// ── Projects ────────────────────────────────────────────────────────────
export const projects = {
  async list(companyId, { status = null } = {}) {
    let q = sb().from("sitestamp_projects").select("*")
      .eq("company_id", companyId).order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    throwIfError(error);
    return data || [];
  },

  async get(id) {
    const { data, error } = await sb().from("sitestamp_projects").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return data;
  },

  async create(row) {
    const { data, error } = await sb().from("sitestamp_projects").insert(row).select().single();
    throwIfError(error);
    return data;
  },

  async update(id, patch) {
    const { data, error } = await sb().from("sitestamp_projects").update(patch).eq("id", id).select().single();
    throwIfError(error);
    return data;
  },

  async setStatus(id, status) {
    const patch = { status };
    if (status === "archived") patch.archived_at = new Date().toISOString();
    return this.update(id, patch);
  },

  /** Counts of media / open tasks / checklist progress for a project. */
  async stats(projectId) {
    const [mediaRes, tasksRes, checklistsRes] = await Promise.all([
      sb().from("sitestamp_media").select("id", { count: "exact", head: true }).eq("project_id", projectId),
      sb().from("sitestamp_tasks").select("id", { count: "exact", head: true }).eq("project_id", projectId).neq("status", "done"),
      sb().from("sitestamp_project_checklist_items")
        .select("is_complete, sitestamp_project_checklists!inner(project_id)")
        .eq("sitestamp_project_checklists.project_id", projectId),
    ]);
    const items = checklistsRes.data || [];
    return {
      mediaCount: mediaRes.count || 0,
      openTasks: tasksRes.count || 0,
      checklistTotal: items.length,
      checklistDone: items.filter(i => i.is_complete).length,
    };
  },
};

// ── Project members ─────────────────────────────────────────────────────
export const members = {
  async listForProject(projectId) {
    const { data, error } = await sb().from("sitestamp_project_members")
      .select("*, core_employees(id, full_name, work_email, role)")
      .eq("project_id", projectId).order("added_at");
    throwIfError(error);
    return data || [];
  },

  async add(row) {
    const { data, error } = await sb().from("sitestamp_project_members").insert(row).select().single();
    throwIfError(error);
    return data;
  },

  async remove(id) {
    const { error } = await sb().from("sitestamp_project_members").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Media ────────────────────────────────────────────────────────────────
export const media = {
  async listForProject(projectId, { mediaType = null, limit = 200 } = {}) {
    let q = sb().from("sitestamp_media")
      .select("*, core_employees(full_name), sitestamp_media_tags(sitestamp_tags(id,name,color))")
      .eq("project_id", projectId).order("taken_at", { ascending: false }).limit(limit);
    if (mediaType) q = q.eq("media_type", mediaType);
    const { data, error } = await q;
    throwIfError(error);
    return data || [];
  },

  async listRecentForCompany(companyId, limit = 12) {
    const { data, error } = await sb().from("sitestamp_media")
      .select("*, sitestamp_projects(name)")
      .eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
    throwIfError(error);
    return data || [];
  },

  async get(id) {
    const { data, error } = await sb().from("sitestamp_media")
      .select("*, core_employees(full_name), sitestamp_projects(name), sitestamp_media_tags(sitestamp_tags(id,name,color))")
      .eq("id", id).maybeSingle();
    throwIfError(error);
    return data;
  },

  async create(row) {
    const { data, error } = await sb().from("sitestamp_media").insert(row).select().single();
    throwIfError(error);
    return data;
  },

  async update(id, patch) {
    const { data, error } = await sb().from("sitestamp_media").update(patch).eq("id", id).select().single();
    throwIfError(error);
    return data;
  },

  async remove(id) {
    const { error } = await sb().from("sitestamp_media").delete().eq("id", id);
    throwIfError(error);
  },

  async uploadFile(path, file) {
    const { error } = await sb().storage.from(BUCKET).upload(path, file, {
      upsert: false, contentType: file.type || "application/octet-stream",
    });
    throwIfError(error);
    return path;
  },

  async signedUrl(path, expiresIn = 3600) {
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, expiresIn);
    throwIfError(error);
    return data?.signedUrl || null;
  },

  async removeFile(path) {
    const { error } = await sb().storage.from(BUCKET).remove([path]);
    throwIfError(error);
  },

  async setTags(mediaId, tagIds) {
    await sb().from("sitestamp_media_tags").delete().eq("media_id", mediaId);
    if (tagIds.length) {
      const { error } = await sb().from("sitestamp_media_tags").insert(tagIds.map(tag_id => ({ media_id: mediaId, tag_id })));
      throwIfError(error);
    }
  },
};

export const comments = {
  async list(mediaId) {
    const { data, error } = await sb().from("sitestamp_media_comments")
      .select("*, core_employees(full_name)").eq("media_id", mediaId).order("created_at");
    throwIfError(error);
    return data || [];
  },
  async add(row) {
    const { data, error } = await sb().from("sitestamp_media_comments").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async remove(id) {
    const { error } = await sb().from("sitestamp_media_comments").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Tags ─────────────────────────────────────────────────────────────────
export const tags = {
  async list(companyId) {
    const { data, error } = await sb().from("sitestamp_tags").select("*").eq("company_id", companyId).order("name");
    throwIfError(error);
    return data || [];
  },
  async create(row) {
    const { data, error } = await sb().from("sitestamp_tags").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async remove(id) {
    const { error } = await sb().from("sitestamp_tags").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Checklist templates ─────────────────────────────────────────────────
export const checklistTemplates = {
  async list(companyId) {
    const { data, error } = await sb().from("sitestamp_checklist_templates")
      .select("*, sitestamp_checklist_template_items(*)").eq("company_id", companyId).order("created_at", { ascending: false });
    throwIfError(error);
    return (data || []).map(t => ({ ...t, sitestamp_checklist_template_items: (t.sitestamp_checklist_template_items || []).sort((a, b) => a.sort_order - b.sort_order) }));
  },
  async create(row) {
    const { data, error } = await sb().from("sitestamp_checklist_templates").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async update(id, patch) {
    const { error } = await sb().from("sitestamp_checklist_templates").update(patch).eq("id", id);
    throwIfError(error);
  },
  async remove(id) {
    const { error } = await sb().from("sitestamp_checklist_templates").delete().eq("id", id);
    throwIfError(error);
  },
  async addItem(row) {
    const { data, error } = await sb().from("sitestamp_checklist_template_items").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async removeItem(id) {
    const { error } = await sb().from("sitestamp_checklist_template_items").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Project checklists ───────────────────────────────────────────────────
export const projectChecklists = {
  async listForProject(projectId) {
    const { data, error } = await sb().from("sitestamp_project_checklists")
      .select("*, sitestamp_project_checklist_items(*)").eq("project_id", projectId).order("created_at");
    throwIfError(error);
    return (data || []).map(c => ({ ...c, sitestamp_project_checklist_items: (c.sitestamp_project_checklist_items || []).sort((a, b) => a.sort_order - b.sort_order) }));
  },

  async createFromTemplate({ projectId, companyId, template, createdBy }) {
    const { data: checklist, error } = await sb().from("sitestamp_project_checklists").insert({
      project_id: projectId, company_id: companyId, template_id: template?.id || null,
      name: template?.name || "New checklist", created_by: createdBy,
    }).select().single();
    throwIfError(error);

    const items = template?.sitestamp_checklist_template_items || [];
    if (items.length) {
      const { error: itemsErr } = await sb().from("sitestamp_project_checklist_items").insert(
        items.map(i => ({ project_checklist_id: checklist.id, label: i.label, sort_order: i.sort_order, requires_photo: i.requires_photo }))
      );
      throwIfError(itemsErr);
    }
    return checklist;
  },

  async addItem(row) {
    const { data, error } = await sb().from("sitestamp_project_checklist_items").insert(row).select().single();
    throwIfError(error);
    return data;
  },

  async toggleItem(id, isComplete, completedBy, mediaId = null) {
    const patch = isComplete
      ? { is_complete: true, completed_by: completedBy, completed_at: new Date().toISOString(), media_id: mediaId }
      : { is_complete: false, completed_by: null, completed_at: null, media_id: null };
    const { data, error } = await sb().from("sitestamp_project_checklist_items").update(patch).eq("id", id).select().single();
    throwIfError(error);
    return data;
  },

  async remove(id) {
    const { error } = await sb().from("sitestamp_project_checklists").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Daily logs ───────────────────────────────────────────────────────────
export const dailyLogs = {
  async listForProject(projectId) {
    const { data, error } = await sb().from("sitestamp_daily_logs")
      .select("*, core_employees(full_name)").eq("project_id", projectId).order("log_date", { ascending: false });
    throwIfError(error);
    return data || [];
  },
  async create(row) {
    const { data, error } = await sb().from("sitestamp_daily_logs").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async remove(id) {
    const { error } = await sb().from("sitestamp_daily_logs").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Tasks ────────────────────────────────────────────────────────────────
export const tasks = {
  async listForProject(projectId) {
    const { data, error } = await sb().from("sitestamp_tasks")
      .select("*, core_employees!sitestamp_tasks_assignee_employee_id_fkey(full_name)").eq("project_id", projectId).order("created_at", { ascending: false });
    throwIfError(error);
    return data || [];
  },
  async listForCompany(companyId, { assigneeId = null, status = null } = {}) {
    let q = sb().from("sitestamp_tasks")
      .select("*, sitestamp_projects(name), core_employees!sitestamp_tasks_assignee_employee_id_fkey(full_name)")
      .eq("company_id", companyId).order("due_date", { ascending: true, nullsFirst: false });
    if (assigneeId) q = q.eq("assignee_employee_id", assigneeId);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    throwIfError(error);
    return data || [];
  },
  async create(row) {
    const { data, error } = await sb().from("sitestamp_tasks").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async update(id, patch) {
    const { data, error } = await sb().from("sitestamp_tasks").update(patch).eq("id", id).select().single();
    throwIfError(error);
    return data;
  },
  async remove(id) {
    const { error } = await sb().from("sitestamp_tasks").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Company employees (for pickers) ─────────────────────────────────────
export const employees = {
  async listForCompany(companyId) {
    const { data, error } = await sb().from("core_employees")
      .select("id, full_name, work_email, role").eq("company_id", companyId).order("full_name");
    throwIfError(error);
    return data || [];
  },
};

// ── Permission grants ────────────────────────────────────────────────────
export const permissionGrants = {
  async listForCompany(companyId) {
    const { data, error } = await sb().from("sitestamp_permission_grants")
      .select("*, core_employees(full_name, work_email, role)").eq("company_id", companyId).order("granted_at", { ascending: false });
    throwIfError(error);
    return data || [];
  },
  async grant(row) {
    const { data, error } = await sb().from("sitestamp_permission_grants").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async revoke(id) {
    const { error } = await sb().from("sitestamp_permission_grants").delete().eq("id", id);
    throwIfError(error);
  },
};

// ── Settings ─────────────────────────────────────────────────────────────
export const settings = {
  async get(companyId) {
    const { data, error } = await sb().from("sitestamp_settings").select("*").eq("company_id", companyId).maybeSingle();
    throwIfError(error);
    return data;
  },
  async upsert(row) {
    const { data, error } = await sb().from("sitestamp_settings").upsert(row, { onConflict: "company_id" }).select().single();
    throwIfError(error);
    return data;
  },
};

// ── Webhooks & API keys (integrations) ──────────────────────────────────
export const webhooks = {
  async list(companyId) {
    const { data, error } = await sb().from("sitestamp_webhooks").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
    throwIfError(error);
    return data || [];
  },
  async create(row) {
    const { data, error } = await sb().from("sitestamp_webhooks").insert(row).select().single();
    throwIfError(error);
    return data;
  },
  async update(id, patch) {
    const { error } = await sb().from("sitestamp_webhooks").update(patch).eq("id", id);
    throwIfError(error);
  },
  async remove(id) {
    const { error } = await sb().from("sitestamp_webhooks").delete().eq("id", id);
    throwIfError(error);
  },
};

export const apiKeys = {
  async list(companyId) {
    const { data, error } = await sb().from("sitestamp_api_keys")
      .select("id, label, key_prefix, created_at, last_used_at, revoked_at").eq("company_id", companyId).order("created_at", { ascending: false });
    throwIfError(error);
    return data || [];
  },
  async revoke(id) {
    const { error } = await sb().from("sitestamp_api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    throwIfError(error);
  },
};

// ── Audit log ────────────────────────────────────────────────────────────
export const audit = {
  async recent(companyId, limit = 20) {
    const { data, error } = await sb().from("sitestamp_audit_logs")
      .select("*, core_employees(full_name)").eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
    throwIfError(error);
    return data || [];
  },
  async log({ companyId, actorEmployeeId, action, entityType, entityId, newValues = null }) {
    // Best-effort — never block the calling action if this insert fails.
    try {
      await sb().from("sitestamp_audit_logs").insert({
        company_id: companyId, actor_employee_id: actorEmployeeId, action,
        entity_type: entityType, entity_id: entityId, new_values: newValues,
      });
    } catch { /* audit logging is non-critical */ }
  },
};
