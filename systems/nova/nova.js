// Nova Workplace AI

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL  = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";
const db = () => createClient(SB_URL, SB_ANON);

// ── State ──────────────────────────────────────────────────────────────────
let session = null, profile = null;
let teamMembers = [];
let projects = [];
let uploadedFiles = [];
let activeProjectId = null;
let selectedColor = "#5b8aff";
let activeTaskProjectId = null;
let activeMemberProjectId = null;
let aiMessages = [], aiConvId = null;
let recognition = null, aiListening = false;
let activeSettingsTab = "profile";

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toast(type, msg) {
  const wrap = document.getElementById("toastwrap");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove("active");
}

function openModal(id) {
  document.getElementById(id)?.classList.add("active");
}

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const t = localStorage.getItem("nova_theme") || "dark";
  document.documentElement.setAttribute("data-theme", t);
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("nova_theme", next);
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function requireAuth() {
  const client = db();
  const { data } = await client.auth.getSession();
  if (!data?.session) { window.location.href = "/app/index.html"; throw 0; }
  session = data.session;
  const { data: prof } = await client
    .from("user_profiles")
    .select("user_id, company_id, role, full_name, active")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!prof) { window.location.href = "/app/index.html"; throw 0; }
  profile = prof;
}

// ── Navigation ─────────────────────────────────────────────────────────────
const TITLES = { home: "Home", team: "Team", files: "Files", email: "Email Rewriter", projects: "Projects" };

function showModule(name) {
  document.querySelectorAll(".module").forEach(el => el.classList.add("hidden"));
  document.getElementById("mod-" + name)?.classList.remove("hidden");
  document.querySelectorAll(".snav[data-module]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.module === name);
  });
  const el = document.getElementById("pageTitle");
  if (el) el.textContent = TITLES[name] || name;
  if (name === "home") loadHome();
  if (name === "team") loadTeam("all");
  if (name === "projects") loadProjects();
}

// ── Presence ───────────────────────────────────────────────────────────────
async function updatePresence() {
  if (!session || !profile) return;
  try {
    await db().from("nova_presence").upsert({
      user_id:      session.user.id,
      company_id:   profile.company_id,
      display_name: profile.full_name || session.user.email,
      last_seen:    new Date().toISOString(),
      status:       "online",
    }, { onConflict: "user_id" });
  } catch (_) {}
}

async function getOnlineCount() {
  try {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { count } = await db().from("nova_presence")
      .select("*", { count: "exact", head: true })
      .eq("company_id", profile.company_id)
      .gte("last_seen", cutoff);
    return count || 0;
  } catch (_) { return 0; }
}

// ── Home ───────────────────────────────────────────────────────────────────
async function loadHome() {
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const first = profile?.full_name?.split(" ")[0] || "";
  const greetEl = document.getElementById("homeGreeting");
  if (greetEl) greetEl.textContent = "Good " + period + (first ? ", " + first : "");

  const [online, projData, taskData] = await Promise.all([
    getOnlineCount(),
    db().from("nova_projects").select("*", { count: "exact", head: true }).eq("company_id", profile.company_id).eq("status", "active"),
    db().from("nova_tasks").select("nova_projects!inner(company_id)", { count: "exact", head: true }).eq("nova_projects.company_id", profile.company_id).neq("status", "done"),
  ]);

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setVal("statOnline", online);
  setVal("statProjects", projData.count || 0);
  setVal("statTasks", taskData.count || 0);
  setVal("statFiles", uploadedFiles.length);
  setVal("onlineBadge", online);

  // Activity feed
  const acts = [];
  try {
    const { data: rp } = await db().from("nova_projects")
      .select("title, created_at").eq("company_id", profile.company_id)
      .order("created_at", { ascending: false }).limit(3);
    rp?.forEach(p => acts.push({ icon: "📋", text: "Project created: " + p.title, time: p.created_at }));

    const { data: rt } = await db().from("nova_tasks")
      .select("title, created_at, nova_projects(title, company_id)")
      .order("created_at", { ascending: false }).limit(5);
    rt?.forEach(t => {
      if (t.nova_projects?.company_id === profile.company_id)
        acts.push({ icon: "✅", text: "Task added: " + t.title + " — " + t.nova_projects.title, time: t.created_at });
    });
  } catch (_) {}

  acts.sort((a, b) => new Date(b.time) - new Date(a.time));
  const list = document.getElementById("activityList");
  if (!list) return;
  if (!acts.length) { list.innerHTML = '<div class="empty-hint">No recent activity</div>'; return; }
  list.innerHTML = acts.slice(0, 6).map(a => {
    const d = new Date(a.time);
    const ts = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `<div class="activity-item"><span class="act-icon">${a.icon}</span><div><div class="act-text">${esc(a.text)}</div><div class="act-time">${ts}</div></div></div>`;
  }).join("");
}

// ── Team ───────────────────────────────────────────────────────────────────
async function loadTeam(filter) {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const [presRes, profRes] = await Promise.all([
    db().from("nova_presence").select("user_id, display_name, last_seen").eq("company_id", profile.company_id),
    db().from("user_profiles").select("user_id, full_name, role").eq("company_id", profile.company_id),
  ]);

  teamMembers = (profRes.data || []).map(p => {
    const pres = presRes.data?.find(r => r.user_id === p.user_id);
    const online = !!(pres && pres.last_seen >= cutoff);
    const name = p.full_name || pres?.display_name || "Team Member";
    return {
      user_id:  p.user_id,
      name,
      role:     p.role || "Member",
      online,
      last_seen: pres?.last_seen || null,
      initials:  name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase(),
    };
  });

  teamMembers.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

  const shown = filter === "online" ? teamMembers.filter(m => m.online)
              : filter === "offline" ? teamMembers.filter(m => !m.online)
              : teamMembers;

  const onlineCount = teamMembers.filter(m => m.online).length;
  const subEl = document.getElementById("teamSub");
  if (subEl) subEl.textContent = onlineCount + " online · " + teamMembers.length + " total";
  const badgeEl = document.getElementById("onlineBadge");
  if (badgeEl) badgeEl.textContent = onlineCount;

  const grid = document.getElementById("teamGrid");
  if (!grid) return;
  if (!shown.length) { grid.innerHTML = '<div class="empty-hint">No team members</div>'; return; }

  grid.innerHTML = shown.map(m => {
    const statusClass = m.online ? "online" : "offline";
    const timeStr = m.last_seen
      ? "Last seen " + new Date(m.last_seen).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : "Never logged in";
    const meTag = m.user_id === session.user.id ? ' <span class="you-tag">You</span>' : "";
    return `
      <div class="team-card">
        <div class="team-card-avatar">${esc(m.initials)}</div>
        <div class="status-dot ${statusClass}"></div>
        <div class="team-card-name">${esc(m.name)}${meTag}</div>
        <div class="team-card-role">${esc(m.role)}</div>
        <div class="team-card-status">${m.online ? "● Online now" : timeStr}</div>
      </div>`;
  }).join("");
}

// ── Files ───────────────────────────────────────────────────────────────────
function renderFiles() {
  const list = document.getElementById("filesList");
  if (!list) return;
  if (!uploadedFiles.length) { list.innerHTML = ""; return; }
  const icons = { pdf:"📄", doc:"📝", docx:"📝", xls:"📊", xlsx:"📊", csv:"📊",
                  jpg:"🖼️", jpeg:"🖼️", png:"🖼️", gif:"🖼️", webp:"🖼️",
                  mp4:"🎬", mov:"🎬", mp3:"🎵", zip:"🗜️", json:"📋", txt:"📃", md:"📃" };
  list.innerHTML = uploadedFiles.map((f, i) => {
    const ext = f.name.split(".").pop().toLowerCase();
    const icon = icons[ext] || "📁";
    const size = f.size < 1024 ? f.size + " B" : f.size < 1048576 ? (f.size/1024).toFixed(1) + " KB" : (f.size/1048576).toFixed(1) + " MB";
    return `
      <div class="file-item">
        <span class="file-icon">${icon}</span>
        <div class="file-info">
          <div class="file-name">${esc(f.name)}</div>
          <div class="file-meta">${esc(size)}${f.type ? " · " + esc(f.type) : ""}</div>
        </div>
        <div class="file-actions">
          <button class="file-btn" onclick="window._analyzeFile(${i})">Ask Nova</button>
          <button class="file-btn danger" onclick="window._removeFile(${i})">Remove</button>
        </div>
      </div>`;
  }).join("");
  const statEl = document.getElementById("statFiles");
  if (statEl) statEl.textContent = uploadedFiles.length;
}

async function handleFiles(files) {
  for (const f of files) uploadedFiles.push(f);
  renderFiles();
  toast("ok", files.length + " file" + (files.length !== 1 ? "s" : "") + " added");
}

window._removeFile = function(i) { uploadedFiles.splice(i, 1); renderFiles(); };

// Media types Claude can look at directly
const VISION_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // Anthropic per-file limit

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsText(file);
  });
}

window._analyzeFile = async function(i) {
  const file = uploadedFiles[i];
  if (!file) return;
  openAiPanel();

  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const isImage = VISION_TYPES.includes(file.type) || /^(jpg|jpeg|png|gif|webp)$/.test(ext);
  const isPdf   = file.type === "application/pdf" || ext === "pdf";
  const isText  = /\.(txt|md|csv|json|js|ts|jsx|tsx|html|css|py|rb|go|rs|sql|sh|yaml|yml|xml|log)$/i.test(file.name)
               || file.type.startsWith("text/")
               || file.type === "application/json";

  try {
    if (isImage || isPdf) {
      if (file.size > MAX_MEDIA_BYTES) {
        toast("warn", "File is over 5 MB — too large for Nova to read");
        appendAiMsg("nova", "\"" + file.name + "\" is " + (file.size / 1048576).toFixed(1) + " MB. I can only read images and PDFs up to 5 MB — try compressing it and uploading again.");
        return;
      }
      const data = await readAsBase64(file);
      const mediaType = isPdf
        ? "application/pdf"
        : (VISION_TYPES.includes(file.type) ? file.type : (ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg"));

      const block = isPdf
        ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
        : { type: "image",    source: { type: "base64", media_type: mediaType, data } };

      const ask = isPdf
        ? "Please read this PDF called \"" + file.name + "\" and summarise what it contains. Highlight anything that needs action."
        : "Please look at this image called \"" + file.name + "\" and describe what you see. If it contains any text, read it out for me.";

      await sendAiMessage({
        display: (isPdf ? "📄 " : "🖼️ ") + file.name + " — " + ask,
        content: [block, { type: "text", text: ask }],
      });
      return;
    }

    if (isText) {
      const text = await readAsText(file);
      const preview = text.slice(0, 8000);
      const suffix = text.length > 8000 ? "\n\n[File truncated — " + (text.length - 8000) + " more characters not shown]" : "";
      await sendAiMessage("Please analyse this file called \"" + file.name + "\":\n\n" + preview + suffix);
      return;
    }

    await sendAiMessage("I've uploaded a file called \"" + file.name + "\" (" + (file.type || "unknown type") + ", " + (file.size / 1024).toFixed(1) + " KB). I can't read this format directly — what are my options for working with it?");
  } catch (_) {
    toast("bad", "Could not read that file");
  }
};

// ── Email ───────────────────────────────────────────────────────────────────
async function rewriteEmail() {
  const input = (document.getElementById("emailInput")?.value || "").trim();
  if (!input) { toast("warn", "Paste an email first"); return; }
  const tone = document.getElementById("toneSelect")?.value || "professional";
  const btn = document.getElementById("rewriteBtn");
  const output = document.getElementById("emailOutput");
  if (!btn || !output) return;

  btn.disabled = true;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> Rewriting…';
  output.innerHTML = '<div class="email-empty"><div class="typing-dots"><span></span><span></span><span></span></div></div>';

  try {
    const prompt = "Rewrite the following email in a " + tone + " tone. Keep the core message intact but improve the language, structure, and clarity. Return ONLY the rewritten email with no additional commentary:\n\n" + input;
    const res = await fetch("/api/nova/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    if (data.ok && data.reply) {
      output.innerHTML = '<div style="white-space:pre-wrap;line-height:1.7">' + esc(data.reply) + '</div>';
      window._emailResult = data.reply;
      const copyBtn = document.getElementById("copyEmailBtn");
      if (copyBtn) copyBtn.classList.remove("hidden");
    } else {
      output.innerHTML = '<div class="email-empty"><p>Something went wrong. Please try again.</p></div>';
    }
  } catch (_) {
    output.innerHTML = '<div class="email-empty"><p>Connection error. Please try again.</p></div>';
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> Rewrite';
}

// ── Projects ────────────────────────────────────────────────────────────────
async function loadProjects() {
  const { data } = await db().from("nova_projects")
    .select("id, title, description, color, status, due_date, created_at")
    .eq("company_id", profile.company_id)
    .eq("status", "active")
    .order("created_at", { ascending: false });
  projects = data || [];

  const subEl = document.getElementById("projectsSub");
  if (subEl) subEl.textContent = projects.length + " active project" + (projects.length !== 1 ? "s" : "");

  const grid = document.getElementById("projectsGrid");
  if (!grid) return;
  if (!projects.length) { grid.innerHTML = '<div class="empty-hint">No projects yet — create your first one</div>'; return; }

  const { data: tasks } = await db().from("nova_tasks").select("project_id, status").in("project_id", projects.map(p => p.id));

  grid.innerHTML = projects.map(p => {
    const pt = (tasks || []).filter(t => t.project_id === p.id);
    const done = pt.filter(t => t.status === "done").length;
    const pct = pt.length ? Math.round(done / pt.length * 100) : 0;
    const clr = esc(p.color || "#5b8aff");
    const due = p.due_date ? '<div class="proj-due">Due ' + new Date(p.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + '</div>' : "";
    return `
      <div class="proj-card" onclick="window._openProject('${esc(p.id)}')">
        <div class="proj-card-bar" style="background:${clr}"></div>
        <div class="proj-card-body">
          <div class="proj-card-title">${esc(p.title)}</div>
          <div class="proj-card-desc">${esc(p.description || "")}</div>
          ${due}
          <div class="proj-progress">
            <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${clr}"></div></div>
            <span class="prog-label">${done}/${pt.length}</span>
          </div>
        </div>
      </div>`;
  }).join("");
}

window._openProject = async function(id) {
  activeProjectId = id;
  document.getElementById("projectsListView")?.classList.add("hidden");
  document.getElementById("projectDetailView")?.classList.remove("hidden");
  await renderProjectDetail(id);
};

async function renderProjectDetail(id) {
  const proj = projects.find(p => p.id === id);
  if (!proj) return;

  const [{ data: tasks }, { data: members }] = await Promise.all([
    db().from("nova_tasks").select("*").eq("project_id", id).order("created_at", { ascending: true }),
    db().from("nova_project_members").select("user_id, role, user_profiles(full_name)").eq("project_id", id),
  ]);

  const groups = { todo: [], in_progress: [], done: [] };
  (tasks || []).forEach(t => { if (groups[t.status]) groups[t.status].push(t); else groups.todo.push(t); });

  const statusColors = { todo: "#64748b", in_progress: "#f59e0b", done: "#10b981" };
  const statusLabels = { todo: "To Do", in_progress: "In Progress", done: "Done" };
  const advLabels    = { todo: "▶", in_progress: "✓", done: "↩" };
  const nextStatus   = { todo: "in_progress", in_progress: "done", done: "todo" };

  const tasksHtml = Object.entries(groups).map(([status, items]) => {
    if (!items.length) return "";
    const rows = items.map(t => {
      const due = t.due_date ? '<span class="task-due-badge">' + new Date(t.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + '</span>' : "";
      return `
        <div class="task-item">
          <button class="task-advance" onclick="window._advanceTask('${esc(t.id)}','${nextStatus[status]}')" title="Advance">${advLabels[status]}</button>
          <div class="task-item-body">
            <div class="task-item-title${status === "done" ? " done" : ""}">${esc(t.title)}</div>
            <div class="task-item-meta"><span class="task-prio prio-${esc(t.priority||"medium")}">${esc(t.priority||"medium")}</span>${due}</div>
          </div>
          <button class="task-del" onclick="window._deleteTask('${esc(t.id)}')" title="Remove">✕</button>
        </div>`;
    }).join("");
    return '<div class="task-group"><div class="task-group-head" style="color:' + statusColors[status] + '">' + statusLabels[status] + ' <span class="task-count">' + items.length + '</span></div>' + rows + '</div>';
  }).join("");

  const membersHtml = (members || []).map(m => {
    const name = m.user_profiles?.full_name || "Member";
    const init = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    return '<div class="proj-member"><div class="pm-avatar">' + esc(init) + '</div><div class="pm-name">' + esc(name) + '</div></div>';
  }).join("");

  const clr = esc(proj.color || "#5b8aff");
  const content = document.getElementById("projectDetailContent");
  if (!content) return;

  content.innerHTML = `
    <div class="proj-detail-head">
      <div class="proj-detail-color" style="background:${clr}"></div>
      <div>
        <div class="proj-detail-title">${esc(proj.title)}</div>
        <div class="proj-detail-desc">${esc(proj.description || "No description")}</div>
      </div>
    </div>
    <div class="proj-detail-body">
      <div>
        <div class="section-head"><span>Tasks</span><button class="btn-sm" onclick="window._openAddTask('${esc(id)}')">+ Add task</button></div>
        <div id="taskBoard">${tasksHtml || '<div class="empty-hint">No tasks yet</div>'}</div>
      </div>
      <div>
        <div class="section-head"><span>Members</span><button class="btn-sm" onclick="window._openAddMember('${esc(id)}')">+ Add</button></div>
        <div class="proj-members-list" id="projMembersList">${membersHtml || '<div class="empty-hint" style="font-size:12px">No members added</div>'}</div>
      </div>
    </div>`;
}

window._advanceTask = async function(taskId, next) {
  await db().from("nova_tasks").update({ status: next }).eq("id", taskId);
  await renderProjectDetail(activeProjectId);
};

window._deleteTask = async function(taskId) {
  await db().from("nova_tasks").delete().eq("id", taskId);
  await renderProjectDetail(activeProjectId);
};

window._openAddTask = function(projectId) {
  activeTaskProjectId = projectId;
  const sel = document.getElementById("tmAssignee");
  if (sel) {
    sel.innerHTML = '<option value="">Unassigned</option>' +
      teamMembers.map(m => '<option value="' + esc(m.user_id) + '">' + esc(m.name) + '</option>').join("");
  }
  const ti = document.getElementById("tmTitle"); if (ti) ti.value = "";
  const td = document.getElementById("tmDue");   if (td) td.value = "";
  const tp = document.getElementById("tmPriority"); if (tp) tp.value = "medium";
  openModal("taskModalBg");
};

window._openAddMember = function(projectId) {
  activeMemberProjectId = projectId;
  const inp = document.getElementById("memberSearch"); if (inp) inp.value = "";
  const res = document.getElementById("memberSearchResults"); if (res) res.innerHTML = "";
  openModal("memberModalBg");
};

async function saveTask() {
  const title = (document.getElementById("tmTitle")?.value || "").trim();
  if (!title) { toast("warn", "Task title is required"); return; }
  const priority    = document.getElementById("tmPriority")?.value || "medium";
  const due_date    = document.getElementById("tmDue")?.value || null;
  const assignee_id = document.getElementById("tmAssignee")?.value || null;
  const { error } = await db().from("nova_tasks").insert({ project_id: activeTaskProjectId, title, priority, due_date, assignee_id: assignee_id || undefined, status: "todo", created_by: session.user.id });
  if (error) { toast("bad", "Failed to add task"); return; }
  closeModal("taskModalBg");
  toast("ok", "Task added");
  await renderProjectDetail(activeProjectId);
}

function searchMembers(q) {
  const res = document.getElementById("memberSearchResults");
  if (!res) return;
  if (!q.trim()) { res.innerHTML = ""; return; }
  const hits = teamMembers.filter(m => m.name.toLowerCase().includes(q.toLowerCase()));
  if (!hits.length) { res.innerHTML = '<div class="search-no-result">No matches</div>'; return; }
  res.innerHTML = hits.map(m => `
    <div class="search-result-item" onclick="window._addMember('${esc(m.user_id)}')">
      <div class="sr-avatar">${esc(m.initials)}</div>
      <div><div class="sr-name">${esc(m.name)}</div><div class="sr-role">${esc(m.role)}</div></div>
      <span class="${m.online ? "status-online" : "status-offline"}">${m.online ? "Online" : "Offline"}</span>
    </div>`).join("");
}

window._addMember = async function(userId) {
  const { error } = await db().from("nova_project_members").upsert({ project_id: activeMemberProjectId, user_id: userId, role: "member" }, { onConflict: "project_id,user_id" });
  if (error) { toast("bad", "Could not add member"); return; }
  closeModal("memberModalBg");
  toast("ok", "Member added to project");
  await renderProjectDetail(activeProjectId);
};

// ── Create / delete project ─────────────────────────────────────────────────
function openNewProjectModal() {
  const fi = document.getElementById("pmTitle"); if (fi) fi.value = "";
  const fd = document.getElementById("pmDesc");  if (fd) fd.value = "";
  const fu = document.getElementById("pmDue");   if (fu) fu.value = "";
  selectedColor = "#5b8aff";
  document.querySelectorAll(".cswatch").forEach(s => s.classList.toggle("active", s.dataset.color === "#5b8aff"));
  openModal("projectModalBg");
}

async function saveProject() {
  const title = (document.getElementById("pmTitle")?.value || "").trim();
  if (!title) { toast("warn", "Project name is required"); return; }
  const description = (document.getElementById("pmDesc")?.value || "").trim();
  const due_date    = document.getElementById("pmDue")?.value || null;
  const { data, error } = await db().from("nova_projects").insert({
    company_id: profile.company_id,
    title, description,
    color:      selectedColor,
    status:     "active",
    due_date,
    created_by: session.user.id,
  }).select().single();
  if (error) { toast("bad", "Failed to create project"); return; }
  await db().from("nova_project_members").insert({ project_id: data.id, user_id: session.user.id, role: "lead" });
  closeModal("projectModalBg");
  toast("ok", "Project created");
  showModule("projects");
}

async function deleteProject() {
  if (!activeProjectId || !confirm("Delete this project and all its tasks?")) return;
  await db().from("nova_tasks").delete().eq("project_id", activeProjectId);
  await db().from("nova_project_members").delete().eq("project_id", activeProjectId);
  await db().from("nova_projects").delete().eq("id", activeProjectId);
  activeProjectId = null;
  document.getElementById("projectDetailView")?.classList.add("hidden");
  document.getElementById("projectsListView")?.classList.remove("hidden");
  toast("ok", "Project deleted");
  await loadProjects();
}

// ── AI Panel ────────────────────────────────────────────────────────────────
function openAiPanel() {
  document.getElementById("aiOverlay")?.classList.add("active");
  document.getElementById("aiPanel")?.classList.add("active");
  document.getElementById("aiTextarea")?.focus();
}

function closeAiPanel() {
  document.getElementById("aiOverlay")?.classList.remove("active");
  document.getElementById("aiPanel")?.classList.remove("active");
}

function setAiOrb(state) {
  const o = document.getElementById("aiOrb");
  if (!o) return;
  o.className = "ai-orb" + (state !== "idle" ? " " + state : "");
}

function appendAiMsg(role, content) {
  const msgs = document.getElementById("aiMsgs");
  if (!msgs) return;
  document.getElementById("aiWelcome")?.remove();
  const el = document.createElement("div");
  el.className = "ai-msg " + role;
  const av = role === "user" ? (profile?.full_name?.[0] || "U").toUpperCase() : "✦";
  el.innerHTML = '<div class="ai-msg-avatar">' + av + '</div><div class="ai-msg-bubble">' + esc(content).replace(/\n/g, "<br>") + '</div>';
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function showAiTyping() {
  const msgs = document.getElementById("aiMsgs");
  if (!msgs) return;
  const el = document.createElement("div");
  el.className = "ai-msg nova";
  el.id = "aiTyping";
  el.innerHTML = '<div class="ai-msg-avatar">✦</div><div class="ai-msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

function hideAiTyping() { document.getElementById("aiTyping")?.remove(); }

async function ensureAiConv(msg) {
  if (aiConvId) return;
  const { data } = await db().from("nova_conversations").insert({
    user_id: session.user.id,
    company_id: profile.company_id,
    title: msg.slice(0, 80),
  }).select().single();
  if (data) aiConvId = data.id;
}

// Re-sending base64 media on every follow-up would blow up the payload, so only
// the most recent message keeps its image/document blocks; older ones collapse
// to a short placeholder that keeps the conversation readable.
function trimHistory(msgs) {
  const lastIdx = msgs.length - 1;
  return msgs.map((m, i) => {
    if (i === lastIdx || !Array.isArray(m.content)) return m;
    const stripped = m.content.map(b =>
      (b.type === "image" || b.type === "document")
        ? { type: "text", text: "[" + (b.type === "image" ? "image" : "PDF") + " shared earlier in this conversation]" }
        : b
    );
    return { ...m, content: stripped };
  });
}

// `override` may be a plain string, or { display, content } where `content` is
// an Anthropic content-block array (used for images and PDFs).
async function sendAiMessage(override) {
  const ta = document.getElementById("aiTextarea");
  const isRich = override && typeof override === "object";
  const content = isRich ? override.content : (override || ta?.value || "").trim();
  const display = isRich ? override.display : content;
  if (!content || (Array.isArray(content) && !content.length)) return;
  if (ta && !override) { ta.value = ""; ta.style.height = "24px"; }
  const sendBtn = document.getElementById("aiSendBtn");
  if (sendBtn) sendBtn.disabled = true;

  openAiPanel();
  appendAiMsg("user", display);
  aiMessages.push({ role: "user", content });
  await ensureAiConv(display);
  setAiOrb("thinking");
  showAiTyping();

  try {
    const res = await fetch("/api/nova/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + session.access_token },
      body: JSON.stringify({ messages: trimHistory(aiMessages.slice(-20)), conversation_id: aiConvId }),
    });
    const data = await res.json();
    hideAiTyping();
    setAiOrb("idle");
    const reply = (data.ok && data.reply) ? data.reply : "I'm sorry, something went wrong. Please try again.";
    aiMessages.push({ role: "assistant", content: reply });
    appendAiMsg("nova", reply);
  } catch (_) {
    hideAiTyping();
    setAiOrb("idle");
    appendAiMsg("nova", "Connection error. Please check your connection and try again.");
  }

  if (sendBtn) sendBtn.disabled = false;
}

// ── Voice ───────────────────────────────────────────────────────────────────
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-GB";

  recognition.onresult = (e) => {
    let final = "", interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    const ta = document.getElementById("aiTextarea");
    if (ta) ta.value = final || interim;
    if (final) {
      aiListening = false;
      document.getElementById("aiMicBtn")?.classList.remove("active");
      sendAiMessage();
    }
  };

  recognition.onend = () => {
    aiListening = false;
    document.getElementById("aiMicBtn")?.classList.remove("active");
  };
}

function toggleVoice() {
  if (!recognition) { toast("warn", "Voice input not supported in this browser"); return; }
  if (aiListening) {
    recognition.stop();
    aiListening = false;
    document.getElementById("aiMicBtn")?.classList.remove("active");
  } else {
    try {
      recognition.start();
      aiListening = true;
      document.getElementById("aiMicBtn")?.classList.add("active");
    } catch (_) {
      toast("warn", "Could not start microphone");
    }
  }
}

// ── Settings ────────────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById("settingsOverlay")?.classList.add("active");
  document.getElementById("settingsPanel")?.classList.add("active");
  renderSettingsTab(activeSettingsTab);
}

function closeSettings() {
  document.getElementById("settingsOverlay")?.classList.remove("active");
  document.getElementById("settingsPanel")?.classList.remove("active");
}

function renderSettingsTab(tab) {
  activeSettingsTab = tab;
  document.querySelectorAll(".s-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const body = document.getElementById("settingsBody");
  if (!body) return;

  if (tab === "profile") {
    body.innerHTML = `
      <div class="sfield"><div class="sfield-label">Full name</div><div class="sfield-val">${esc(profile?.full_name || "–")}</div></div>
      <div class="sfield"><div class="sfield-label">Email</div><div class="sfield-val">${esc(session?.user?.email || "–")}</div></div>
      <div class="sfield"><div class="sfield-label">Role</div><div class="sfield-val">${esc(profile?.role || "Member")}</div></div>
      <div class="sfield"><div class="sfield-label">Company ID</div><div class="sfield-val">${esc(profile?.company_id || "–")}</div></div>`;
  } else if (tab === "appearance") {
    const cur = document.documentElement.getAttribute("data-theme");
    body.innerHTML = `
      <div class="srow">
        <span class="srow-label">Theme</span>
        <div style="display:flex;gap:6px">
          <button class="theme-opt${cur === "dark" ? " active" : ""}" onclick="setTheme('dark',this)">Dark</button>
          <button class="theme-opt${cur === "light" ? " active" : ""}" onclick="setTheme('light',this)">Light</button>
        </div>
      </div>`;
    window.setTheme = function(t, btn) {
      document.documentElement.setAttribute("data-theme", t);
      localStorage.setItem("nova_theme", t);
      document.querySelectorAll(".theme-opt").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    };
  } else if (tab === "notifications") {
    const granted = Notification.permission === "granted";
    body.innerHTML = `
      <div class="srow">
        <span class="srow-label">Browser notifications</span>
        <label class="toggle"><input type="checkbox" id="notifToggle"${granted ? " checked" : ""}><span class="toggle-slider"></span></label>
      </div>`;
    document.getElementById("notifToggle")?.addEventListener("change", async (e) => {
      if (e.target.checked) {
        const p = await Notification.requestPermission();
        if (p !== "granted") { e.target.checked = false; toast("warn", "Notifications blocked by browser"); }
      }
    });
  } else if (tab === "privacy") {
    body.innerHTML = `
      <div class="sinfo">Your conversations are stored securely in your company's Supabase instance and are only accessible to you. Nova processes your messages through the SmartCore API.</div>
      <button class="btn-ghost" style="margin-top:16px" onclick="window._clearHistory()">Clear conversation history</button>`;
    window._clearHistory = async function() {
      if (!confirm("Clear all Nova conversation history?")) return;
      const { data: convs } = await db().from("nova_conversations").select("id").eq("user_id", session.user.id);
      if (convs?.length) {
        await db().from("nova_messages").delete().in("conversation_id", convs.map(c => c.id));
        await db().from("nova_conversations").delete().eq("user_id", session.user.id);
      }
      aiMessages = []; aiConvId = null;
      toast("ok", "Conversation history cleared");
    };
  }
}

// ── Sidebar user ─────────────────────────────────────────────────────────────
function renderSidebarUser() {
  const name = profile?.full_name || session?.user?.email || "User";
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const av = document.getElementById("suAvatar"); if (av) av.textContent = initials;
  const nm = document.getElementById("suName");   if (nm) nm.textContent = name;
  const rl = document.getElementById("suRole");   if (rl) rl.textContent = profile?.role || "Member";
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  initTheme();
  await requireAuth();
  renderSidebarUser();

  // Module nav
  document.querySelectorAll(".snav[data-module]").forEach(btn => {
    btn.addEventListener("click", () => showModule(btn.dataset.module));
  });
  document.querySelectorAll(".quick-card[data-module]").forEach(btn => {
    btn.addEventListener("click", () => showModule(btn.dataset.module));
  });
  document.getElementById("homeNewProject")?.addEventListener("click", () => {
    openNewProjectModal();
    showModule("projects");
  });

  // Theme
  document.getElementById("themeBtn")?.addEventListener("click", toggleTheme);

  // Hamburger
  document.getElementById("hamburger")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
  });

  // Logout
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await db().auth.signOut();
    window.location.href = "/app/index.html";
  });

  // Settings
  document.getElementById("settingsNavBtn")?.addEventListener("click", openSettings);
  document.getElementById("settingsOverlay")?.addEventListener("click", closeSettings);
  document.getElementById("settingsClose")?.addEventListener("click", closeSettings);
  document.querySelectorAll(".s-tab").forEach(b => b.addEventListener("click", () => renderSettingsTab(b.dataset.tab)));

  // AI Panel
  document.getElementById("aiFabBtn")?.addEventListener("click", openAiPanel);
  document.getElementById("aiOverlay")?.addEventListener("click", closeAiPanel);
  document.getElementById("aiPanelClose")?.addEventListener("click", closeAiPanel);
  document.getElementById("aiMicBtn")?.addEventListener("click", toggleVoice);
  document.getElementById("aiSendBtn")?.addEventListener("click", () => sendAiMessage());

  const aiTA = document.getElementById("aiTextarea");
  if (aiTA) {
    aiTA.addEventListener("input", () => {
      aiTA.style.height = "24px";
      aiTA.style.height = Math.min(aiTA.scrollHeight, 120) + "px";
      const sb = document.getElementById("aiSendBtn");
      if (sb) sb.disabled = !aiTA.value.trim();
    });
    aiTA.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }
    });
  }

  // Projects
  document.getElementById("newProjectBtn")?.addEventListener("click", openNewProjectModal);
  document.getElementById("projectModalX")?.addEventListener("click", () => closeModal("projectModalBg"));
  document.getElementById("projectModalCancel")?.addEventListener("click", () => closeModal("projectModalBg"));
  document.getElementById("projectModalSave")?.addEventListener("click", saveProject);
  document.getElementById("projectModalBg")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeModal("projectModalBg"); });
  document.getElementById("backToProjects")?.addEventListener("click", () => {
    activeProjectId = null;
    document.getElementById("projectDetailView")?.classList.add("hidden");
    document.getElementById("projectsListView")?.classList.remove("hidden");
  });
  document.getElementById("deleteProjectBtn")?.addEventListener("click", deleteProject);
  document.querySelectorAll(".cswatch").forEach(s => {
    s.addEventListener("click", () => {
      selectedColor = s.dataset.color;
      document.querySelectorAll(".cswatch").forEach(cs => cs.classList.toggle("active", cs === s));
    });
  });

  // Task modal
  document.getElementById("taskModalX")?.addEventListener("click", () => closeModal("taskModalBg"));
  document.getElementById("taskModalCancel")?.addEventListener("click", () => closeModal("taskModalBg"));
  document.getElementById("taskModalSave")?.addEventListener("click", saveTask);
  document.getElementById("taskModalBg")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeModal("taskModalBg"); });

  // Member modal
  document.getElementById("memberModalX")?.addEventListener("click", () => closeModal("memberModalBg"));
  document.getElementById("memberModalCancel")?.addEventListener("click", () => closeModal("memberModalBg"));
  document.getElementById("memberModalBg")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeModal("memberModalBg"); });
  document.getElementById("memberSearch")?.addEventListener("input", e => searchMembers(e.target.value));

  // Invite modal
  document.getElementById("inviteBtn")?.addEventListener("click", () => {
    const box = document.getElementById("inviteLinkBox");
    if (box) box.textContent = window.location.origin + "/app/index.html";
    openModal("inviteModalBg");
  });
  document.getElementById("inviteModalX")?.addEventListener("click", () => closeModal("inviteModalBg"));
  document.getElementById("inviteModalBg")?.addEventListener("click", e => { if (e.target === e.currentTarget) closeModal("inviteModalBg"); });
  document.getElementById("copyInviteBtn")?.addEventListener("click", () => {
    navigator.clipboard.writeText(window.location.origin + "/app/index.html").then(() => toast("ok", "Link copied"));
  });

  // Email
  document.getElementById("rewriteBtn")?.addEventListener("click", rewriteEmail);
  document.getElementById("copyEmailBtn")?.addEventListener("click", () => {
    if (window._emailResult) navigator.clipboard.writeText(window._emailResult).then(() => toast("ok", "Copied"));
  });

  // Files
  const fileInput = document.getElementById("fileInput");
  document.getElementById("browseBtn")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", e => handleFiles(Array.from(e.target.files || [])));
  const dropZone = document.getElementById("dropZone");
  if (dropZone) {
    dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
    dropZone.addEventListener("drop", e => { e.preventDefault(); dropZone.classList.remove("drag-over"); handleFiles(Array.from(e.dataTransfer?.files || [])); });
    dropZone.addEventListener("click", e => { if (e.target !== document.getElementById("browseBtn")) fileInput?.click(); });
  }

  // Team filters
  document.querySelectorAll(".filter-btn[data-filter]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      loadTeam(btn.dataset.filter);
    });
  });

  // Voice init
  initVoice();

  // Presence heartbeat
  await updatePresence();
  setInterval(updatePresence, 60000);

  // Start on home
  showModule("home");
}

boot().catch(console.error);
