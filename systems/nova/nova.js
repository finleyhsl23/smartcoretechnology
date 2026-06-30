// SmartCore Nova — AI Personal Assistant Frontend

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";
const sb = () => createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ──────────────────────────────────────────────────────────────────
let session       = null;
let profile       = null;
let conversations = [];
let activeConvId  = null;
let messages      = [];  // [{role, content}] for API
let ttsEnabled    = true;
let recognition   = null;
let isListening   = false;
let synth         = window.speechSynthesis;
let utterance     = null;

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("nova_theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("nova_theme", next);
  document.getElementById("themeBtn").textContent = next === "dark" ? "☀️" : "🌙";
}

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(type, msg) {
  const wrap = document.getElementById("toastwrap");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Orb / Status ──────────────────────────────────────────────────────────
function setOrbState(state) {
  const orb = document.getElementById("novaOrb");
  const rings = document.getElementById("orbRings");
  const badge = document.getElementById("statusBadge");
  if (!orb) return;

  orb.className = "nova-orb" + (state !== "idle" ? ` ${state}` : "");
  rings.className = "nova-orb-rings" + (["listening","thinking"].includes(state) ? " active" : "");

  const labels = {
    idle:      "Ready",
    listening: "Listening…",
    thinking:  "Thinking…",
    speaking:  "Speaking…",
  };
  badge.textContent = labels[state] || "Ready";
  badge.className   = `nova-status-badge ${state !== "idle" ? state : ""}`;
}

// ── Sidebar toggle ─────────────────────────────────────────────────────────
function initMobileNav() {
  const hamburger = document.getElementById("hamburger");
  const sidebar   = document.getElementById("novaSidebar");
  const overlay   = document.getElementById("sidebarOverlay");

  hamburger?.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("open");
  });
  overlay?.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  });
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function requireAuth() {
  const client = sb();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session) throw new Error("Not authenticated");
  session = data.session;

  const { data: prof, error: profErr } = await client
    .from("user_profiles")
    .select("user_id, company_id, role, full_name, active")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (profErr || !prof) throw new Error("No profile");
  profile = prof;
}

// ── Conversation management ────────────────────────────────────────────────
async function loadConversations() {
  const client = sb();
  const { data } = await client
    .from("nova_conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_id", session.user.id)
    .order("updated_at", { ascending: false })
    .limit(50);

  conversations = data || [];
  renderHistory();
}

async function createConversation(title = "New conversation") {
  const client = sb();
  const { data, error } = await client
    .from("nova_conversations")
    .insert({ user_id: session.user.id, company_id: profile.company_id, title })
    .select()
    .single();

  if (error) throw error;
  conversations.unshift(data);
  renderHistory();
  return data;
}

async function updateConversationTitle(convId, title) {
  const client = sb();
  await client
    .from("nova_conversations")
    .update({ title: title.slice(0, 80) })
    .eq("id", convId)
    .eq("user_id", session.user.id);

  const conv = conversations.find(c => c.id === convId);
  if (conv) conv.title = title;
  renderHistory();
}

async function deleteConversation(convId, e) {
  e.stopPropagation();
  const client = sb();
  await client
    .from("nova_conversations")
    .delete()
    .eq("id", convId)
    .eq("user_id", session.user.id);

  conversations = conversations.filter(c => c.id !== convId);
  if (activeConvId === convId) {
    startNewChat();
  } else {
    renderHistory();
  }
}

async function loadConversationMessages(convId) {
  const client = sb();
  const { data } = await client
    .from("nova_messages")
    .select("id, role, content, metadata, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });

  return data || [];
}

async function saveMessage(convId, role, content, metadata = {}) {
  const client = sb();
  await client
    .from("nova_messages")
    .insert({ conversation_id: convId, role, content, metadata });
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderHistory() {
  const list = document.getElementById("historyList");
  if (!list) return;

  if (!conversations.length) {
    list.innerHTML = `<div style="padding:12px 10px;font-size:12px;color:var(--text3);text-align:center;">No conversations yet</div>`;
    return;
  }

  list.innerHTML = conversations.map(c => `
    <div class="history-item${c.id === activeConvId ? " active" : ""}" onclick="window._openConv('${c.id}')">
      <span class="history-item-icon">💬</span>
      <div class="history-item-text">
        <div class="history-item-title">${esc(c.title)}</div>
        <div class="history-item-time">${timeAgo(c.updated_at)}</div>
      </div>
      <button class="history-item-del" title="Delete" onclick="window._delConv('${c.id}',event)">✕</button>
    </div>
  `).join("");
}

function renderTopbarTitle() {
  const el = document.getElementById("topbarTitle");
  if (!el) return;
  const conv = conversations.find(c => c.id === activeConvId);
  el.textContent = conv ? conv.title : "Nova";
}

function renderEmpty() {
  const chat = document.getElementById("novaChat");
  chat.innerHTML = `
    <div class="nova-empty">
      <div class="nova-empty-orb"></div>
      <h2>Hi${profile ? `, ${profile.full_name?.split(" ")[0]}` : ""}! I'm Nova.</h2>
      <p>Your personal AI assistant. I can manage your calendar, tasks, contacts, reminders, notes, find locations, draft emails, and access your CRM — all by voice or text.</p>
      <div class="suggestion-chips">
        <div class="suggestion-chip" onclick="window._suggest(this)">📅 What's on today?</div>
        <div class="suggestion-chip" onclick="window._suggest(this)">📝 Create a task</div>
        <div class="suggestion-chip" onclick="window._suggest(this)">👤 Add a contact</div>
        <div class="suggestion-chip" onclick="window._suggest(this)">🗺️ Find a location</div>
        <div class="suggestion-chip" onclick="window._suggest(this)">📧 Draft an email</div>
        <div class="suggestion-chip" onclick="window._suggest(this)">⏰ Set a reminder</div>
        <div class="suggestion-chip" onclick="window._suggest(this)">📋 Show my tasks</div>
        <div class="suggestion-chip" onclick="window._suggest(this)">🔍 Search my CRM</div>
      </div>
    </div>
  `;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return "just now";
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-GB");
}

function fmtTime(iso) {
  if (!iso) return "";
  return iso.slice(11, 16);
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Render a user message bubble ───────────────────────────────────────────
function renderUserMsg(content, timestamp) {
  const chat = document.getElementById("novaChat");
  const el = document.createElement("div");
  el.className = "chat-inner";
  el.innerHTML = `
    <div class="msg user">
      <div class="msg-avatar">${profile?.full_name?.[0]?.toUpperCase() || "U"}</div>
      <div class="msg-body">
        <div class="msg-bubble">${esc(content)}</div>
        <div class="msg-time">${timestamp || fmtTime(new Date().toISOString())}</div>
      </div>
    </div>
  `;
  chat.appendChild(el);
  scrollToBottom();
}

// ── Render Nova's response ─────────────────────────────────────────────────
function renderNovaMsg(content, cards = [], timestamp) {
  const chat = document.getElementById("novaChat");
  const el = document.createElement("div");
  el.className = "chat-inner";

  let cardsHtml = "";
  if (cards && cards.length) {
    cardsHtml = `<div class="msg-cards">${cards.map(renderCard).join("")}</div>`;
  }

  el.innerHTML = `
    <div class="msg nova">
      <div class="msg-avatar">✦</div>
      <div class="msg-body">
        <div class="msg-bubble">${esc(content)}</div>
        ${cardsHtml}
        <div class="msg-time">${timestamp || fmtTime(new Date().toISOString())}</div>
      </div>
    </div>
  `;
  chat.appendChild(el);
  scrollToBottom();
}

// ── Render rich cards ──────────────────────────────────────────────────────
function renderCard(card) {
  if (!card) return "";

  switch (card.type) {
    case "map":
      return renderMapCard(card);
    case "event":
    case "event_list":
      return renderEventCard(card);
    case "task":
    case "task_list":
      return renderTaskCard(card);
    case "contact":
    case "contact_list":
      return renderContactCard(card);
    case "email_draft":
      return renderEmailDraft(card);
    case "note":
    case "note_list":
      return renderNoteCard(card);
    case "reminder":
      return renderReminderCard(card);
    default:
      return "";
  }
}

function renderMapCard(card) {
  const lat  = card.lat || 51.5074;
  const lng  = card.lng || -0.1278;
  const zoom = 14;
  const name = card.display_name || card.query || "Location";
  const mapUrl  = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.01},${lat-0.007},${lng+0.01},${lat+0.007}&layer=mapnik&marker=${lat},${lng}`;
  const openUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;

  return `
    <div class="card card-map">
      <div class="card-head">
        <span class="card-head-icon">🗺️</span>
        <span>Location</span>
      </div>
      <iframe src="${esc(mapUrl)}" loading="lazy" title="Map of ${esc(name)}"></iframe>
      <div class="card-map-info">
        <span>${esc(name.length > 60 ? name.slice(0, 60) + "…" : name)}</span>
        <a href="${openUrl}" target="_blank" rel="noopener" class="card-map-link">Open in Maps ↗</a>
      </div>
    </div>
  `;
}

function renderEventCard(card) {
  const items = card.type === "event_list" ? card.data : [card.data];
  if (!items || !items.length) return "";

  const rows = items.slice(0, 5).map(e => {
    const t = e.start_time ? fmtTime(e.start_time) : "All day";
    const d = e.start_time ? fmtDate(e.start_time) : "";
    return `
      <div class="event-row" style="margin-bottom:12px;">
        <div class="event-time-block">
          <div class="etime">${esc(t)}</div>
          <div class="edate">${esc(d)}</div>
        </div>
        <div class="event-info">
          <div class="event-title">${esc(e.title)}</div>
          <div class="event-meta">
            ${e.location ? `<div class="event-loc">📍 ${esc(e.location)}</div>` : ""}
            ${e.description ? `<div>${esc(e.description.slice(0, 80))}${e.description.length > 80 ? "…" : ""}</div>` : ""}
          </div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="card card-event">
      <div class="card-head">
        <span class="card-head-icon">📅</span>
        <span>${card.action === "created" ? "Event Created" : `${items.length} Event${items.length !== 1 ? "s" : ""}`}</span>
      </div>
      <div class="card-body">${rows}</div>
    </div>
  `;
}

function renderTaskCard(card) {
  const items = card.type === "task_list" ? card.data : [card.data];
  if (!items || !items.length) return "";

  const rows = items.slice(0, 8).map(t => `
    <div class="task-row">
      <div class="task-check${t.status === "completed" ? " done" : ""}"></div>
      <span class="task-text${t.status === "completed" ? " done" : ""}">${esc(t.title)}</span>
      <span class="task-priority prio-${t.priority || "medium"}">${t.priority || "medium"}</span>
      ${t.due_date ? `<span class="task-due">${t.due_date}</span>` : ""}
    </div>
  `).join("");

  return `
    <div class="card">
      <div class="card-head">
        <span class="card-head-icon">✅</span>
        <span>${card.action === "created" ? "Task Created" : `${items.length} Task${items.length !== 1 ? "s" : ""}`}</span>
      </div>
      <div class="card-body" style="padding:8px 14px;">${rows}</div>
    </div>
  `;
}

function renderContactCard(card) {
  const items = card.type === "contact_list" ? card.data : [card.data];
  if (!items || !items.length) return "";

  const contacts = items.slice(0, 6).map(c => {
    const initials = ((c.first_name?.[0] || "") + (c.last_name?.[0] || "")).toUpperCase() || "?";
    return `
      <div class="contact-item">
        <div class="contact-avatar">${esc(initials)}</div>
        <div class="contact-info">
          <div class="contact-name">${esc(c.first_name + " " + (c.last_name || ""))}</div>
          ${c.email ? `<div class="contact-detail">✉ ${esc(c.email)}</div>` : ""}
          ${c.phone ? `<div class="contact-detail">📞 ${esc(c.phone)}</div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="card">
      <div class="card-head">
        <span class="card-head-icon">👤</span>
        <span>${card.action === "created" ? "Contact Saved" : `${items.length} Contact${items.length !== 1 ? "s" : ""}`}</span>
      </div>
      <div class="card-body">
        <div class="contact-card-grid">${contacts}</div>
      </div>
    </div>
  `;
}

function renderEmailDraft(card) {
  const draftId = "draft_" + Math.random().toString(36).slice(2);
  const emailBody = buildEmailBody(card);

  return `
    <div class="card email-draft">
      <div class="card-head">
        <span class="card-head-icon">✉️</span>
        <span>Email Draft</span>
      </div>
      <div class="card-body">
        <div class="email-draft-header">
          <span class="email-draft-label">To:</span>
          <span>${esc(card.to || "(recipient)")}</span>
          <span class="email-draft-label">Subject:</span>
          <span>${esc(card.subject || "(subject)")}</span>
          <span class="email-draft-label">Tone:</span>
          <span style="text-transform:capitalize;">${esc(card.tone || "professional")}</span>
        </div>
        <div class="email-draft-body" id="${draftId}">${esc(emailBody)}</div>
        <div class="email-draft-actions">
          <button class="card-btn" onclick="copyEmailDraft('${draftId}')">📋 Copy</button>
          <button class="card-btn" onclick="window._refineEmail(this)" data-purpose="${esc(card.purpose || "")}">✏️ Refine</button>
        </div>
      </div>
    </div>
  `;
}

function buildEmailBody(card) {
  const greeting = card.to ? `Dear ${card.to.split(" ")[0]},` : "Dear [Name],";
  const sign     = card.from_name ? `\n\nKind regards,\n${card.from_name}` : "\n\nKind regards,\n[Your name]";
  const points   = card.key_points?.length
    ? "\n\n" + card.key_points.map((p, i) => `${i+1}. ${p}`).join("\n")
    : "";
  return `${greeting}\n\n[Re: ${card.purpose}]${points}${sign}`;
}

window.copyEmailDraft = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => toast("ok", "Email draft copied to clipboard")).catch(() => toast("warn", "Could not copy"));
};

window._refineEmail = function(btn) {
  const purpose = btn.getAttribute("data-purpose");
  const textarea = document.getElementById("novaTextarea");
  if (textarea) {
    textarea.value = `Please refine the email draft about: ${purpose}`;
    textarea.focus();
  }
};

function renderNoteCard(card) {
  const items = card.type === "note_list" ? card.data : [card.data];
  if (!items || !items.length) return "";

  const rows = items.slice(0, 3).map(n => `
    <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--line2);">
      <div style="font-size:13px;font-weight:600;margin-bottom:6px;">${esc(n.title)}</div>
      <div class="note-card-content">${esc(n.content.slice(0, 200))}${n.content.length > 200 ? "…" : ""}</div>
      ${n.tags?.length ? `<div class="note-tags">${n.tags.map(t => `<span class="note-tag">${esc(t)}</span>`).join("")}</div>` : ""}
    </div>
  `).join("");

  return `
    <div class="card">
      <div class="card-head">
        <span class="card-head-icon">📄</span>
        <span>${card.action === "created" ? "Note Saved" : `${items.length} Note${items.length !== 1 ? "s" : ""}`}</span>
      </div>
      <div class="card-body">${rows}</div>
    </div>
  `;
}

function renderReminderCard(card) {
  const r = card.data;
  if (!r) return "";
  return `
    <div class="card">
      <div class="card-head">
        <span class="card-head-icon">⏰</span>
        <span>${card.action === "created" ? "Reminder Set" : "Reminder"}</span>
      </div>
      <div class="card-body">
        <div class="reminder-item">
          <span class="reminder-icon">🔔</span>
          <div class="reminder-info">
            <div class="reminder-title">${esc(r.title)}</div>
            <div class="reminder-time">${r.remind_at ? r.remind_at.slice(0, 16).replace("T", " ") : ""}${r.repeat_interval && r.repeat_interval !== "none" ? ` · repeats ${r.repeat_interval}` : ""}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Typing indicator ───────────────────────────────────────────────────────
function showTyping() {
  const chat = document.getElementById("novaChat");
  const el = document.createElement("div");
  el.className = "chat-inner";
  el.id = "typingWrap";
  el.innerHTML = `
    <div class="typing-indicator">
      <div class="msg-avatar nova" style="
        width:34px;height:34px;border-radius:50%;
        background:radial-gradient(circle at 38% 32%,#4a80ff 0%,#1e5cff 40%,#0a1a6e 100%);
        box-shadow:0 0 12px rgba(30,92,255,0.4);
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-size:14px;flex-shrink:0;
      ">✦</div>
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>
  `;
  chat.appendChild(el);
  scrollToBottom();
}

function hideTyping() {
  document.getElementById("typingWrap")?.remove();
}

function scrollToBottom() {
  const chat = document.getElementById("novaChat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}

// ── TTS ────────────────────────────────────────────────────────────────────
function speak(text) {
  if (!ttsEnabled || !synth) return;
  synth.cancel();

  const clean = text
    .replace(/\d+\./g, "")
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

  if (!clean) return;

  utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate  = 0.95;
  utterance.pitch = 1.05;
  utterance.lang  = "en-GB";

  // Prefer a British English voice
  const voices = synth.getVoices();
  const britishVoice = voices.find(v =>
    (v.lang === "en-GB" || v.lang.startsWith("en-GB")) && v.name.toLowerCase().includes("female")
  ) || voices.find(v => v.lang === "en-GB") || voices.find(v => v.lang.startsWith("en"));

  if (britishVoice) utterance.voice = britishVoice;

  utterance.onstart = () => setOrbState("speaking");
  utterance.onend   = () => setOrbState("idle");
  utterance.onerror = () => setOrbState("idle");

  setOrbState("speaking");
  synth.speak(utterance);
}

function stopSpeaking() {
  synth?.cancel();
  setOrbState("idle");
}

// ── Speech Recognition ─────────────────────────────────────────────────────
function initVoice() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    document.getElementById("micBtn").style.display = "none";
    return;
  }

  recognition = new SpeechRec();
  recognition.lang = "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    let interim = "";
    let final   = "";
    for (const res of event.results) {
      if (res.isFinal) final   += res[0].transcript;
      else             interim += res[0].transcript;
    }
    const transcript = document.getElementById("voiceTranscript");
    const text       = document.getElementById("transcriptText");
    if (transcript && text) {
      transcript.classList.add("active");
      text.textContent = final || interim;
    }
    if (final) {
      document.getElementById("novaTextarea").value = final;
    }
  };

  recognition.onend = () => {
    isListening = false;
    document.getElementById("micBtn")?.classList.remove("active");
    setOrbState("idle");
    const transcript = document.getElementById("voiceTranscript");
    const text       = document.getElementById("transcriptText");
    const input      = document.getElementById("novaTextarea");
    if (transcript) transcript.classList.remove("active");
    if (text && text.textContent.trim()) {
      if (input) input.value = text.textContent.trim();
      if (text.textContent.trim()) {
        setTimeout(() => sendMessage(), 100);
      }
    }
  };

  recognition.onerror = (e) => {
    isListening = false;
    document.getElementById("micBtn")?.classList.remove("active");
    setOrbState("idle");
    if (e.error !== "no-speech") toast("warn", `Mic error: ${e.error}`);
  };
}

function toggleVoice() {
  if (!recognition) return;
  if (isListening) {
    recognition.stop();
    isListening = false;
    document.getElementById("micBtn").classList.remove("active");
    setOrbState("idle");
    return;
  }
  stopSpeaking();
  try {
    recognition.start();
    isListening = true;
    document.getElementById("micBtn").classList.add("active");
    setOrbState("listening");
  } catch (e) {
    toast("warn", "Could not start microphone");
  }
}

// ── Send message ───────────────────────────────────────────────────────────
async function sendMessage() {
  const textarea   = document.getElementById("novaTextarea");
  const sendBtn    = document.getElementById("sendBtn");
  const userInput  = (textarea?.value || "").trim();

  if (!userInput) return;
  if (!session)   { toast("bad", "Not signed in"); return; }

  stopSpeaking();
  textarea.value = "";
  textarea.style.height = "24px";
  sendBtn.disabled = true;

  // First message → create conversation
  if (!activeConvId) {
    const title = userInput.slice(0, 60) + (userInput.length > 60 ? "…" : "");
    const conv  = await createConversation(title);
    activeConvId = conv.id;
    renderHistory();
    renderTopbarTitle();
  }

  // Remove empty state
  const emptyEl = document.querySelector(".nova-empty");
  if (emptyEl) emptyEl.closest(".chat-inner")?.remove();

  // Render user bubble
  renderUserMsg(userInput);

  // Add to message history for API
  messages.push({ role: "user", content: userInput });

  // Save to DB
  saveMessage(activeConvId, "user", userInput);

  // Show typing
  setOrbState("thinking");
  showTyping();

  try {
    const res = await fetch("/api/nova/chat", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messages: messages.slice(-20), conversation_id: activeConvId }),
    });

    const data = await res.json();
    hideTyping();

    if (!data.ok || !data.reply) {
      setOrbState("idle");
      toast("bad", data.error || "Nova encountered an error");
      renderNovaMsg("I'm sorry, I encountered an issue processing your request. Please try again.");
      return;
    }

    const reply = data.reply;
    const cards = data.cards || [];

    // Add to message history
    messages.push({ role: "assistant", content: reply });

    // Save to DB
    saveMessage(activeConvId, "assistant", reply, { cards });

    // Update conversation title after first exchange
    if (messages.length === 2) {
      const shortTitle = userInput.slice(0, 60);
      await updateConversationTitle(activeConvId, shortTitle);
    } else if (messages.length <= 4) {
      const conv = conversations.find(c => c.id === activeConvId);
      if (conv) {
        const client = sb();
        await client.from("nova_conversations").update({ updated_at: new Date().toISOString() }).eq("id", activeConvId);
      }
    }

    renderNovaMsg(reply, cards);
    setOrbState("idle");

    // TTS
    speak(reply);

  } catch (e) {
    hideTyping();
    setOrbState("idle");
    toast("bad", "Connection error — please try again");
    renderNovaMsg("I'm having trouble connecting right now. Please check your connection and try again.");
  } finally {
    sendBtn.disabled = false;
    textarea?.focus();
  }
}

// ── Open a conversation ────────────────────────────────────────────────────
async function openConversation(convId) {
  if (activeConvId === convId) return;
  activeConvId = convId;
  messages = [];

  const chat = document.getElementById("novaChat");
  chat.innerHTML = `<div class="chat-inner" style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text3);">Loading…</div>`;

  renderHistory();
  renderTopbarTitle();

  const dbMsgs = await loadConversationMessages(convId);
  chat.innerHTML = "";

  if (!dbMsgs.length) {
    renderEmpty();
    return;
  }

  for (const m of dbMsgs) {
    if (m.role === "user") {
      renderUserMsg(m.content, fmtTime(m.created_at));
    } else {
      const cards = m.metadata?.cards || [];
      renderNovaMsg(m.content, cards, fmtTime(m.created_at));
      messages.push({ role: "assistant", content: m.content });
    }
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content });
    }
  }

  // Rebuild messages array in order
  messages = dbMsgs.map(m => ({ role: m.role, content: m.content }));

  // Close mobile sidebar
  document.getElementById("novaSidebar")?.classList.remove("open");
  document.getElementById("sidebarOverlay")?.classList.remove("open");
}

// ── New chat ───────────────────────────────────────────────────────────────
function startNewChat() {
  activeConvId = null;
  messages     = [];
  const chat = document.getElementById("novaChat");
  chat.innerHTML = "";
  renderEmpty();
  renderHistory();
  renderTopbarTitle();

  document.getElementById("novaSidebar")?.classList.remove("open");
  document.getElementById("sidebarOverlay")?.classList.remove("open");
  document.getElementById("novaTextarea")?.focus();
}

// ── Quick actions ──────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: "📅 Today", prompt: "Give me my daily briefing — what's on today?" },
  { label: "✅ Tasks",  prompt: "Show me my current tasks and to-dos." },
  { label: "📝 Note",   prompt: "I'd like to take a note." },
  { label: "⏰ Remind", prompt: "Set a reminder for me." },
  { label: "👤 Contact",prompt: "I need to add a contact." },
  { label: "🗺️ Map",    prompt: "I need to find a location." },
  { label: "✉️ Email",  prompt: "Draft an email for me." },
  { label: "📊 CRM",    prompt: "Search my CRM data." },
];

function renderQuickActions() {
  const el = document.getElementById("quickGrid");
  if (!el) return;
  el.innerHTML = QUICK_ACTIONS.map(q => `
    <button class="quick-btn" onclick="window._quickAction('${esc(q.prompt)}')">
      <span>${q.label.split(" ")[0]}</span>${q.label.split(" ").slice(1).join(" ")}
    </button>
  `).join("");
}

// ── Textarea auto-resize ───────────────────────────────────────────────────
function initTextarea() {
  const ta = document.getElementById("novaTextarea");
  if (!ta) return;

  ta.addEventListener("input", () => {
    ta.style.height = "24px";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    document.getElementById("sendBtn").disabled = !ta.value.trim();
  });

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// ── Global callbacks ───────────────────────────────────────────────────────
window._suggest     = (el) => {
  const ta = document.getElementById("novaTextarea");
  if (ta) {
    ta.value = el.textContent.replace(/^[^\s]+\s/, "");
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  }
};
window._quickAction = (prompt) => {
  const ta = document.getElementById("novaTextarea");
  if (ta) {
    ta.value = prompt;
    ta.dispatchEvent(new Event("input"));
    sendMessage();
  }
};
window._openConv    = openConversation;
window._delConv     = deleteConversation;

// ── Sidebar user info ──────────────────────────────────────────────────────
function renderSidebarUser() {
  if (!profile) return;
  const name  = document.getElementById("sidebarUserName");
  const role  = document.getElementById("sidebarUserRole");
  const avt   = document.getElementById("sidebarUserAvatar");
  const initials = (profile.full_name || "U").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  if (name)  name.textContent  = profile.full_name || "User";
  if (role)  role.textContent  = profile.role || "Member";
  if (avt)   avt.textContent   = initials;
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  initTheme();

  try {
    await requireAuth();
  } catch (e) {
    return;
  }

  renderSidebarUser();
  renderEmpty();
  renderQuickActions();
  initMobileNav();
  initTextarea();
  initVoice();

  // Load voices for TTS
  if (synth) {
    if (synth.getVoices().length === 0) {
      synth.addEventListener("voiceschanged", () => {}, { once: true });
    }
  }

  await loadConversations();

  // TTS toggle
  const ttsBtn = document.getElementById("ttsBtn");
  if (ttsBtn) {
    ttsBtn.addEventListener("click", () => {
      ttsEnabled = !ttsEnabled;
      ttsBtn.textContent = ttsEnabled ? "🔊" : "🔇";
      if (!ttsEnabled) stopSpeaking();
      toast("ok", ttsEnabled ? "Voice responses on" : "Voice responses off");
    });
  }

  document.getElementById("themeBtn")?.addEventListener("click", toggleTheme);
  document.getElementById("newChatBtn")?.addEventListener("click", startNewChat);
  document.getElementById("micBtn")?.addEventListener("click", toggleVoice);
  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    const client = sb();
    await client.auth.signOut();
  });
}

boot();
