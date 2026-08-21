// SmartCore Nova — AI Personal Assistant Frontend

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";
const sb = () => createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ──────────────────────────────────────────────────────────────────
let session          = null;
let profile          = null;
let messages         = [];
let convId           = null;
let ttsEnabled       = true;
let recognition      = null;
let isListening      = false;
let synth            = window.speechSynthesis;
let idleTimer        = null;
let connectedServices = new Set();
let activeSettingsTab = "profile";

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem("nova_theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
  document.getElementById("themeBtn").textContent = saved === "dark" ? "☀️" : "🌙";
}

function toggleTheme() {
  const cur  = document.documentElement.getAttribute("data-theme");
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

// ── Orb state ──────────────────────────────────────────────────────────────
function setOrbState(state) {
  const orb = document.getElementById("novaOrb");
  if (!orb) return;
  orb.className = "orb-dot" + (state !== "idle" ? ` ${state}` : "");
}

// ── Greeting ───────────────────────────────────────────────────────────────
function renderGreeting() {
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const firstName = profile?.full_name?.split(" ")[0] || "";
  const greeting  = `Good ${period}${firstName ? `, ${firstName}` : ""}`;
  const el = document.getElementById("greetingText");
  if (el) el.textContent = greeting;
}

// ── Auth ───────────────────────────────────────────────────────────────────
async function requireAuth() {
  const client = sb();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session) {
    window.location.href = "/app/index.html";
    throw new Error("Not authenticated");
  }
  session = data.session;

  const { data: prof, error: profErr } = await client
    .from("user_profiles")
    .select("user_id, company_id, role, full_name, active")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (profErr || !prof) {
    window.location.href = "/app/index.html";
    throw new Error("No profile");
  }
  profile = prof;
}

// ── Conversation ───────────────────────────────────────────────────────────
async function ensureConversation(firstMsg) {
  if (convId) return;
  const client = sb();
  const { data, error } = await client
    .from("nova_conversations")
    .insert({
      user_id:    session.user.id,
      company_id: profile.company_id,
      title:      firstMsg.slice(0, 80),
    })
    .select()
    .single();
  if (error) throw error;
  convId = data.id;
}

async function saveMessage(role, content, metadata = {}) {
  if (!convId) return;
  const client = sb();
  await client.from("nova_messages").insert({ conversation_id: convId, role, content, metadata });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmtTime(iso) {
  if (!iso) return "";
  return iso.slice(11, 16);
}
function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function scrollToBottom() {
  const chat = document.getElementById("novaChat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}
function removeGreeting() {
  document.getElementById("novaGreeting")?.remove();
}

function showIdleScreen() {
  const screen = document.getElementById("idleScreen");
  if (!screen) return;
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const firstName = profile?.full_name?.split(" ")[0] || "";
  const text = `Good ${period}${firstName ? `, ${firstName}` : ""}`;
  const el = document.getElementById("idleGreetingText");
  if (el) el.textContent = text;
  screen.classList.add("active");
}

function resetIdle() {
  const screen = document.getElementById("idleScreen");
  screen?.classList.remove("active");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showIdleScreen, 45000);
}

// ── Render messages ────────────────────────────────────────────────────────
function renderUserMsg(content) {
  const chat = document.getElementById("novaChat");
  const el   = document.createElement("div");
  el.className = "msg user";
  el.innerHTML = `
    <div class="msg-avatar">${(profile?.full_name?.[0] || "U").toUpperCase()}</div>
    <div class="msg-body">
      <div class="msg-bubble">${esc(content)}</div>
      <div class="msg-time">${fmtTime(new Date().toISOString())}</div>
    </div>
  `;
  chat.appendChild(el);
  scrollToBottom();
}

function renderNovaMsg(content, cards = []) {
  const chat = document.getElementById("novaChat");
  const el   = document.createElement("div");
  el.className = "msg nova";
  let cardsHtml = "";
  if (cards?.length) {
    cardsHtml = `<div class="msg-cards">${cards.map(renderCard).join("")}</div>`;
  }
  el.innerHTML = `
    <div class="msg-avatar">✦</div>
    <div class="msg-body">
      <div class="msg-bubble">${esc(content)}</div>
      ${cardsHtml}
      <div class="msg-time">${fmtTime(new Date().toISOString())}</div>
    </div>
  `;
  chat.appendChild(el);
  scrollToBottom();
}

// ── Typing indicator ───────────────────────────────────────────────────────
function showTyping() {
  const chat = document.getElementById("novaChat");
  const el   = document.createElement("div");
  el.className = "typing-indicator";
  el.id = "typingWrap";
  el.innerHTML = `
    <div class="msg-avatar nova" style="width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 38% 32%,#4a80ff 0%,#1e5cff 45%,#0a1a6e 100%);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;flex-shrink:0;">✦</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>
  `;
  chat.appendChild(el);
  scrollToBottom();
}
function hideTyping() { document.getElementById("typingWrap")?.remove(); }

// ── Rich cards ─────────────────────────────────────────────────────────────
function renderCard(card) {
  if (!card) return "";
  switch (card.type) {
    case "map":          return renderMapCard(card);
    case "event":
    case "event_list":   return renderEventCard(card);
    case "task":
    case "task_list":    return renderTaskCard(card);
    case "contact":
    case "contact_list": return renderContactCard(card);
    case "email_draft":  return renderEmailDraft(card);
    case "note":
    case "note_list":    return renderNoteCard(card);
    case "reminder":     return renderReminderCard(card);
    default: return "";
  }
}

function renderMapCard(card) {
  const lat  = card.lat  || 51.5074;
  const lng  = card.lng  || -0.1278;
  const name = card.display_name || card.query || "Location";
  const mapUrl  = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.01},${lat-0.007},${lng+0.01},${lat+0.007}&layer=mapnik&marker=${lat},${lng}`;
  const openUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;
  const shortName = name.length > 60 ? name.slice(0,60)+"…" : name;
  return `
    <div class="card card-map">
      <div class="card-head"><span>🗺️</span> Location</div>
      <iframe src="${esc(mapUrl)}" loading="lazy" title="Map"></iframe>
      <div class="card-map-info">
        <span>${esc(shortName)}</span>
        <a href="${openUrl}" target="_blank" rel="noopener" class="card-map-link">Open in Maps ↗</a>
      </div>
    </div>`;
}

function renderEventCard(card) {
  const items = card.type === "event_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,5).map(e => {
    const timeStr = e.start_time ? fmtTime(e.start_time) : "All day";
    const dateStr = e.start_time ? fmtDate(e.start_time) : "";
    const locHtml = e.location ? `<span>📍 ${esc(e.location)}</span>` : "";
    const desc    = e.description ? e.description.slice(0,80) + (e.description.length>80?"…":"") : "";
    const descHtml = desc ? `<span>${esc(desc)}</span>` : "";
    return `<div class="event-row"><div class="event-time-block"><div class="etime">${esc(timeStr)}</div><div class="edate">${esc(dateStr)}</div></div><div class="event-info"><div class="event-title">${esc(e.title)}</div><div class="event-meta">${locHtml}${descHtml}</div></div></div>`;
  }).join("");
  const label = card.action==="created" ? "Event Created" : items.length + " Event" + (items.length!==1?"s":"");
  return `<div class="card"><div class="card-head"><span>📅</span> ${label}</div><div class="card-body">${rows}</div></div>`;
}

function renderTaskCard(card) {
  const items = card.type === "task_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,8).map(t => {
    const doneClass = t.status === "completed" ? " done" : "";
    const prioStr   = t.priority || "medium";
    const dueHtml   = t.due_date ? `<span class="task-due">${t.due_date}</span>` : "";
    return `<div class="task-row"><div class="task-check${doneClass}"></div><span class="task-text${doneClass}">${esc(t.title)}</span><span class="task-priority prio-${prioStr}">${prioStr}</span>${dueHtml}</div>`;
  }).join("");
  const label = card.action==="created" ? "Task Created" : items.length + " Task" + (items.length!==1?"s":"");
  return `<div class="card"><div class="card-head"><span>✅</span> ${label}</div><div class="card-body" style="padding:8px 14px;">${rows}</div></div>`;
}

function renderContactCard(card) {
  const items = card.type === "contact_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const contacts = items.slice(0,6).map(c => {
    const initials  = ((c.first_name?.[0]||"")+( c.last_name?.[0]||"")).toUpperCase()||"?";
    const emailHtml = c.email ? `<div class="contact-detail">✉ ${esc(c.email)}</div>` : "";
    const phoneHtml = c.phone ? `<div class="contact-detail">📞 ${esc(c.phone)}</div>` : "";
    return `<div class="contact-item"><div class="contact-avatar">${esc(initials)}</div><div><div class="contact-name">${esc(c.first_name+" "+(c.last_name||""))}</div>${emailHtml}${phoneHtml}</div></div>`;
  }).join("");
  const label = card.action==="created" ? "Contact Saved" : items.length + " Contact" + (items.length!==1?"s":"");
  return `<div class="card"><div class="card-head"><span>👤</span> ${label}</div><div class="card-body"><div class="contact-card-grid">${contacts}</div></div></div>`;
}

function renderEmailDraft(card) {
  const id       = "draft_" + Math.random().toString(36).slice(2);
  const toName   = card.to ? card.to.split(" ")[0] : "[Name]";
  const greeting = card.to ? `Dear ${toName},` : "Dear [Name],";
  const sign     = card.from_name ? `\n\nKind regards,\n${card.from_name}` : "\n\nKind regards,\n[Your name]";
  const points   = card.key_points?.length ? "\n\n"+card.key_points.map((p,i)=>`${i+1}. ${p}`).join("\n") : "";
  const body     = `${greeting}\n\n[Re: ${card.purpose}]${points}${sign}`;
  const purpose  = esc(card.purpose||"");
  return `<div class="card"><div class="card-head"><span>✉️</span> Email Draft</div><div class="card-body"><div class="email-draft-header"><span class="email-draft-label">To:</span><span>${esc(card.to||"(recipient)")}</span><span class="email-draft-label">Subject:</span><span>${esc(card.subject||"(subject)")}</span></div><div class="email-draft-body" id="${id}">${esc(body)}</div><div class="email-draft-actions"><button class="card-btn" onclick="window._copyDraft('${id}')">📋 Copy</button><button class="card-btn" onclick="window._refineEmail(this)" data-purpose="${purpose}">✏️ Refine</button></div></div></div>`;
}

function renderNoteCard(card) {
  const items = card.type === "note_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,3).map(n => {
    const preview  = n.content.slice(0,200) + (n.content.length>200?"…":"");
    const tagsHtml = n.tags?.length ? `<div class="note-tags">${n.tags.map(t=>`<span class="note-tag">${esc(t)}</span>`).join("")}</div>` : "";
    return `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.04);"><div style="font-size:13px;font-weight:600;margin-bottom:5px;">${esc(n.title)}</div><div class="note-card-content">${esc(preview)}</div>${tagsHtml}</div>`;
  }).join("");
  const label = card.action==="created" ? "Note Saved" : items.length + " Note" + (items.length!==1?"s":"");
  return `<div class="card"><div class="card-head"><span>📄</span> ${label}</div><div class="card-body">${rows}</div></div>`;
}

function renderReminderCard(card) {
  const r = card.data;
  if (!r) return "";
  const label  = card.action==="created" ? "Reminder Set" : "Reminder";
  const timeStr = r.remind_at ? r.remind_at.slice(0,16).replace("T"," ") : "";
  const repeat  = r.repeat_interval && r.repeat_interval!=="none" ? ` · repeats ${r.repeat_interval}` : "";
  return `<div class="card"><div class="card-head"><span>⏰</span> ${label}</div><div class="card-body"><div class="reminder-item"><span class="reminder-icon">🔔</span><div><div class="reminder-title">${esc(r.title)}</div><div class="reminder-time">${timeStr}${repeat}</div></div></div></div></div>`;
}

window._copyDraft = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent)
    .then(() => toast("ok", "Copied to clipboard"))
    .catch(() => toast("warn", "Could not copy"));
};
window._refineEmail = function(btn) {
  const ta = document.getElementById("novaTextarea");
  if (ta) {
    ta.value = `Please refine the email draft about: ${btn.getAttribute("data-purpose")}`;
    ta.focus();
  }
};

// ── TTS ────────────────────────────────────────────────────────────────────
function speak(text) {
  if (!ttsEnabled || !synth) return;
  synth.cancel();
  const clean = text.replace(/\d+\./g,"").replace(/[\u{1F300}-\u{1F9FF}]/gu,"").replace(/\s+/g," ").trim().slice(0,500);
  if (!clean) return;
  const utt = new SpeechSynthesisUtterance(clean);
  utt.rate  = 0.95;
  utt.pitch = 1.05;
  utt.lang  = "en-GB";
  const voices = synth.getVoices();
  const v = voices.find(v => v.lang==="en-GB" && v.name.toLowerCase().includes("female"))
         || voices.find(v => v.lang==="en-GB")
         || voices.find(v => v.lang.startsWith("en"));
  if (v) utt.voice = v;
  utt.onstart = () => setOrbState("speaking");
  utt.onend   = () => setOrbState("idle");
  utt.onerror = () => setOrbState("idle");
  setOrbState("speaking");
  synth.speak(utt);
}

function stopSpeaking() {
  synth?.cancel();
  setOrbState("idle");
}

// ── Wake word ──────────────────────────────────────────────────────────────
function initWakeWord() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;
  let wake = new SpeechRec();
  wake.continuous = true;
  wake.interimResults = true;
  wake.lang = "en-GB";
  let restarting = false;
  wake.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript.toLowerCase().trim();
      if (text.includes("nova")) {
        wake.stop();
        setTimeout(() => { if (!isListening) toggleVoice(); }, 250);
        return;
      }
    }
  };
  wake.onend = () => {
    if (!isListening && !restarting) {
      restarting = true;
      setTimeout(() => { restarting = false; try { wake.start(); } catch(e) {} }, 500);
    }
  };
  wake.onerror = () => {
    if (!isListening && !restarting) {
      restarting = true;
      setTimeout(() => { restarting = false; try { wake.start(); } catch(e) {} }, 1000);
    }
  };
  try { wake.start(); } catch(e) {}
}

// ── Speech Recognition ─────────────────────────────────────────────────────
function initVoice() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) { document.getElementById("micBtn").style.display = "none"; return; }
  recognition = new SpeechRec();
  recognition.lang = "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onresult = (event) => {
    let interim = "", final = "";
    for (const res of event.results) {
      if (res.isFinal) final   += res[0].transcript;
      else             interim += res[0].transcript;
    }
    const bar  = document.getElementById("voiceBar");
    const text = document.getElementById("transcriptText");
    bar.classList.add("active");
    text.textContent = final || interim;
    if (final) document.getElementById("novaTextarea").value = final;
  };

  recognition.onend = () => {
    isListening = false;
    document.getElementById("micBtn")?.classList.remove("active");
    setOrbState("idle");
    document.getElementById("voiceBar")?.classList.remove("active");
    const input = document.getElementById("novaTextarea");
    if (input?.value.trim()) setTimeout(() => sendMessage(), 100);
  };

  recognition.onerror = (e) => {
    isListening = false;
    document.getElementById("micBtn")?.classList.remove("active");
    setOrbState("idle");
    if (e.error !== "no-speech" && e.error !== "aborted") toast("warn", `Mic error: ${e.error}`);
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
    const transcriptEl = document.getElementById("transcriptText");
    if (transcriptEl) transcriptEl.textContent = "";
    recognition.start();
    isListening = true;
    document.getElementById("micBtn").classList.add("active");
    setOrbState("listening");
    resetIdle();
  } catch (e) {
    toast("warn", "Could not start microphone");
  }
}

// ── Send ───────────────────────────────────────────────────────────────────
async function sendMessage() {
  const textarea  = document.getElementById("novaTextarea");
  const sendBtn   = document.getElementById("sendBtn");
  const userInput = (textarea?.value || "").trim();
  if (!userInput) return;
  if (!session)   { toast("bad", "Not signed in"); return; }

  stopSpeaking();
  textarea.value = "";
  textarea.style.height = "24px";
  sendBtn.disabled = true;
  removeGreeting();
  await ensureConversation(userInput);
  renderUserMsg(userInput);
  messages.push({ role: "user", content: userInput });
  saveMessage("user", userInput);
  setOrbState("thinking");
  showTyping();

  try {
    const res = await fetch("/api/nova/chat", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
      body: JSON.stringify({ messages: messages.slice(-20), conversation_id: convId }),
    });
    const data = await res.json();
    hideTyping();
    if (!data.ok || !data.reply) {
      setOrbState("idle");
      toast("bad", data.error || "Something went wrong");
      renderNovaMsg("I'm sorry, I encountered an issue. Please try again.");
      return;
    }
    messages.push({ role: "assistant", content: data.reply });
    saveMessage("assistant", data.reply, { cards: data.cards || [] });
    renderNovaMsg(data.reply, data.cards || []);
    setOrbState("idle");
    speak(data.reply);
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

// ── OAuth ──────────────────────────────────────────────────────────────────
function base64urlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generatePKCE() {
  const verifier  = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const hash      = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64urlEncode(hash);
  return { verifier, challenge };
}

const INT_OAUTH = {
  spotify: {
    authUrl:    "https://accounts.spotify.com/authorize",
    tokenUrl:   "https://accounts.spotify.com/api/token",
    scope:      "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private user-library-read",
    setupLink:  "https://developer.spotify.com/dashboard",
    setupSteps: [
      "Go to developer.spotify.com/dashboard and log in",
      "Click \"Create app\" — name it anything, e.g. \"Nova\"",
      "In app settings, add the Redirect URI shown below",
      "Copy your Client ID and paste it here",
    ],
  },
  gcal: {
    authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl:   "https://oauth2.googleapis.com/token",
    scope:      "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
    extra:      { access_type: "offline", prompt: "consent" },
    setupLink:  "https://console.cloud.google.com/",
    setupSteps: [
      "Go to Google Cloud Console and create or select a project",
      "Enable the Google Calendar API under APIs & Services",
      "Create OAuth credentials — Web application type",
      "Add the Redirect URI shown below to Authorised redirect URIs",
      "Copy your Client ID and paste it here",
    ],
  },
  nest_cam: {
    authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl:   "https://oauth2.googleapis.com/token",
    scope:      "https://www.googleapis.com/auth/sdm.service",
    extra:      { access_type: "offline", prompt: "consent" },
    setupLink:  "https://console.cloud.google.com/",
    setupSteps: [
      "Go to Google Cloud Console and create or select a project",
      "Enable the Smart Device Management API",
      "Create OAuth credentials — Web application type",
      "Add the Redirect URI shown below to Authorised redirect URIs",
      "Copy your Client ID and paste it here",
    ],
  },
  google_home: {
    authUrl:    "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl:   "https://oauth2.googleapis.com/token",
    scope:      "https://www.googleapis.com/auth/homegraph",
    extra:      { access_type: "offline", prompt: "consent" },
    setupLink:  "https://console.cloud.google.com/",
    setupSteps: [
      "Go to Google Cloud Console and create or select a project",
      "Enable the HomeGraph API",
      "Create OAuth credentials — Web application type",
      "Add the Redirect URI shown below to Authorised redirect URIs",
      "Copy your Client ID and paste it here",
    ],
  },
  outlook: {
    authUrl:    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl:   "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope:      "https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.ReadWrite offline_access",
    setupLink:  "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    setupSteps: [
      "Go to Azure Portal → App registrations → New registration",
      "Set platform to Single-page application (SPA)",
      "Add the Redirect URI shown below",
      "Under API permissions add Microsoft Graph: Calendars.ReadWrite, Mail.ReadWrite",
      "Copy your Application (client) ID and paste it here",
    ],
  },
  teams: {
    authUrl:    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl:   "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope:      "https://graph.microsoft.com/Team.ReadBasic.All https://graph.microsoft.com/Chat.ReadWrite offline_access",
    setupLink:  "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    setupSteps: [
      "Go to Azure Portal → App registrations → New registration",
      "Set platform to Single-page application (SPA)",
      "Add the Redirect URI shown below",
      "Under API permissions add Microsoft Graph: Team.ReadBasic.All, Chat.ReadWrite",
      "Copy your Application (client) ID and paste it here",
    ],
  },
  fitbit: {
    authUrl:    "https://www.fitbit.com/oauth2/authorize",
    tokenUrl:   "https://api.fitbit.com/oauth2/token",
    scope:      "activity heartrate sleep profile settings",
    setupLink:  "https://dev.fitbit.com/apps/new",
    setupSteps: [
      "Go to dev.fitbit.com/apps and log in",
      "Click Register a new app, set OAuth 2.0 Application Type to Personal",
      "Add the Redirect URL shown below",
      "Copy your Client ID and paste it here",
    ],
  },
};

const INT_NO_API = {
  apple_music: "Apple Music requires a paid Apple Developer account and MusicKit JS. Server-side integration coming soon.",
  life360:     "Life360 does not currently offer a public developer API.",
  geotab:      "Geotab integration requires an enterprise SDK licence. Contact support for setup.",
  ring:        "Ring (Amazon) does not provide a public OAuth API for third-party apps.",
  hik_connect: "Hik Connect requires an enterprise API agreement with Hikvision.",
  arlo:        "Arlo does not provide a public developer OAuth API.",
  alexa:       "Amazon Alexa integration requires a Smart Home Skill setup — server-side coming soon.",
  homekit:     "Apple HomeKit is only accessible through iOS/macOS apps. No web API is available.",
  philips_hue: "Philips Hue OAuth requires a client secret — server-side integration coming soon.",
  notion:      "Notion OAuth requires a client secret — server-side integration coming soon.",
  slack:       "Slack OAuth requires a client secret — server-side integration coming soon.",
  apple_health:"Apple Health is iOS-only via HealthKit. No web API exists.",
  garmin:      "Garmin uses OAuth 1.0 which requires server-side signing — coming soon.",
};

async function loadConnectedServices() {
  if (!session) return;
  try {
    const { data } = await sb()
      .from("nova_oauth_tokens")
      .select("service")
      .eq("user_id", session.user.id);
    connectedServices = new Set((data || []).map(r => r.service));
  } catch {
    connectedServices = new Set();
  }
}

async function saveOAuthToken(service, tokenData) {
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;
  await sb().from("nova_oauth_tokens").upsert({
    user_id:       session.user.id,
    service,
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token || null,
    expires_at:    expiresAt,
    scope:         tokenData.scope || null,
    updated_at:    new Date().toISOString(),
  }, { onConflict: "user_id,service" });
  connectedServices.add(service);
}

async function deleteOAuthToken(service) {
  await sb().from("nova_oauth_tokens").delete()
    .eq("user_id", session.user.id).eq("service", service);
  connectedServices.delete(service);
}

function getStoredClientId(service) {
  return localStorage.getItem("nova_cid_" + service) || "";
}

async function initiateOAuth(service, clientId) {
  const cfg = INT_OAUTH[service];
  if (!cfg) return;
  localStorage.setItem("nova_cid_" + service, clientId);
  const { verifier, challenge } = await generatePKCE();
  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(12)));
  localStorage.setItem("nova_pkce_" + state, JSON.stringify({ verifier, service, clientId }));
  const redirectUri = window.location.origin + "/systems/nova/oauth-callback.html";
  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         "code",
    redirect_uri:          redirectUri,
    scope:                 cfg.scope,
    state,
    code_challenge:        challenge,
    code_challenge_method: "S256",
    ...(cfg.extra || {}),
  });
  const popup = window.open(cfg.authUrl + "?" + params.toString(), "nova_oauth", "width=540,height=660,left=200,top=80");
  if (!popup) toast("warn", "Pop-up blocked — please allow pop-ups and try again");
}

async function handleOAuthMessage(event) {
  if (event.origin !== window.location.origin) return;
  const msg = event.data || {};
  if (msg.type !== "nova_oauth_callback") return;
  const { code, state, error } = msg;
  if (error) { toast("bad", "OAuth error: " + error); return; }
  if (!code || !state) return;
  const stored = localStorage.getItem("nova_pkce_" + state);
  if (!stored) { toast("bad", "OAuth state mismatch — please try again"); return; }
  localStorage.removeItem("nova_pkce_" + state);
  const { verifier, service, clientId } = JSON.parse(stored);
  const cfg = INT_OAUTH[service];
  if (!cfg) return;
  const redirectUri = window.location.origin + "/systems/nova/oauth-callback.html";
  try {
    const body = new URLSearchParams({
      client_id:     clientId,
      grant_type:    "authorization_code",
      code,
      redirect_uri:  redirectUri,
      code_verifier: verifier,
    });
    const res = await fetch(cfg.tokenUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokenData = await res.json();
    if (!tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || "No access token returned");
    await saveOAuthToken(service, tokenData);
    toast("ok", "Connected successfully!");
    if (activeSettingsTab === "integrations") renderSettingsTab("integrations");
  } catch (e) {
    toast("bad", "Could not connect: " + (e.message || "unknown error"));
  }
}

function showOAuthModal(service) {
  const intItem = INTEGRATIONS.flatMap(g => g.items).find(i => i.id === service);
  const name    = intItem?.name || service;
  const icon    = intItem?.icon || "🔗";
  const cfg     = INT_OAUTH[service];
  const noApi   = INT_NO_API[service];

  document.getElementById("oauthModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "oauthModal";
  modal.style.cssText = "position:fixed;inset:0;z-index:600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);";

  if (noApi) {
    modal.innerHTML = buildNoApiModalHtml(name, icon, noApi);
  } else if (cfg) {
    const storedId    = getStoredClientId(service);
    const redirectUri = window.location.origin + "/systems/nova/oauth-callback.html";
    modal.innerHTML   = buildSetupModalHtml(name, icon, service, cfg, storedId, redirectUri);
  } else {
    return;
  }

  document.body.appendChild(modal);
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.getElementById("oauthModalClose")?.addEventListener("click", () => modal.remove());
  document.getElementById("oauthStartBtn")?.addEventListener("click", async () => {
    const clientId = document.getElementById("oauthClientId")?.value.trim();
    if (!clientId) { toast("warn", "Please enter your Client ID"); return; }
    modal.remove();
    await initiateOAuth(service, clientId);
  });
}

function buildNoApiModalHtml(name, icon, reason) {
  return `<div style="background:rgba(8,12,30,0.97);border:1px solid rgba(255,255,255,0.1);border-radius:20px;width:380px;max-width:90vw;padding:28px 24px;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;"><span style="font-size:24px">${icon}</span><span style="font-size:16px;font-weight:600;color:#e9f0ff">${esc(name)}</span><button id="oauthModalClose" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.35);cursor:pointer;font-size:20px;line-height:1;">✕</button></div><div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.18);border-radius:12px;padding:14px;color:#fcd34d;font-size:13px;line-height:1.65;">ℹ️ ${esc(reason)}</div></div>`;
}

function buildSetupModalHtml(name, icon, service, cfg, storedId, redirectUri) {
  const stepsHtml = cfg.setupSteps.map((s, i) => {
    const num = i + 1;
    return `<div style="display:flex;gap:10px;margin-bottom:9px;font-size:13px;line-height:1.55;color:rgba(233,240,255,0.72);"><span style="background:rgba(30,92,255,0.18);color:#93c5fd;min-width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:700;">${num}</span><span>${esc(s)}</span></div>`;
  }).join("");
  return `<div style="background:rgba(8,12,30,0.97);border:1px solid rgba(255,255,255,0.1);border-radius:20px;width:430px;max-width:92vw;padding:28px 24px;max-height:90vh;overflow-y:auto;"><div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;"><span style="font-size:24px">${icon}</span><span style="font-size:16px;font-weight:600;color:#e9f0ff">Connect ${esc(name)}</span><button id="oauthModalClose" style="margin-left:auto;background:none;border:none;color:rgba(255,255,255,0.35);cursor:pointer;font-size:20px;line-height:1;">✕</button></div><div style="margin-bottom:18px;">${stepsHtml}</div><div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;margin-bottom:16px;"><div style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:rgba(233,240,255,0.3);margin-bottom:5px;">Redirect URI — add this to your app</div><div style="font-size:12px;color:#93c5fd;word-break:break-all;font-family:monospace;">${esc(redirectUri)}</div></div><div style="margin-bottom:16px;"><div style="font-size:11px;color:rgba(233,240,255,0.45);margin-bottom:6px;">Client ID</div><input id="oauthClientId" type="text" value="${esc(storedId)}" placeholder="Paste your Client ID here" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 13px;color:#e9f0ff;font-family:inherit;font-size:13px;outline:none;"></div><div style="display:flex;gap:8px;"><a href="${esc(cfg.setupLink)}" target="_blank" rel="noopener" style="flex:1;text-align:center;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);color:rgba(233,240,255,0.55);font-size:13px;text-decoration:none;display:flex;align-items:center;justify-content:center;">Open Developer Console ↗</a><button id="oauthStartBtn" style="flex:1;padding:10px;border-radius:10px;background:#1e5cff;border:none;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Authorise →</button></div></div>`;
}

// ── Settings ────────────────────────────────────────────────────────────────
const INTEGRATIONS = [
  { category: "Music", items: [
    { id: "spotify",     icon: "🎵", name: "Spotify",     desc: "Stream music & control playback" },
    { id: "apple_music", icon: "🎶", name: "Apple Music", desc: "Access your Apple Music library" },
  ]},
  { category: "Location & Tracking", items: [
    { id: "life360", icon: "📍", name: "Life360", desc: "Family location sharing & safety" },
    { id: "geotab",  icon: "🚗", name: "Geotab",  desc: "Fleet & vehicle tracking" },
  ]},
  { category: "Cameras", items: [
    { id: "ring",        icon: "🔔", name: "Ring",        desc: "Doorbell & security cameras" },
    { id: "hik_connect", icon: "📷", name: "Hik Connect", desc: "Hikvision IP camera system" },
    { id: "nest_cam",    icon: "🏠", name: "Nest Cam",    desc: "Google Nest indoor & outdoor cams" },
    { id: "arlo",        icon: "📹", name: "Arlo",        desc: "Wire-free smart home cameras" },
  ]},
  { category: "Smart Home", items: [
    { id: "alexa",       icon: "🔵", name: "Amazon Alexa",  desc: "Voice control & smart home hub" },
    { id: "google_home", icon: "🏡", name: "Google Home",   desc: "Cast, control & automate devices" },
    { id: "homekit",     icon: "🍎", name: "Apple HomeKit", desc: "Secure home automation" },
    { id: "philips_hue", icon: "💡", name: "Philips Hue",   desc: "Smart lighting control" },
  ]},
  { category: "Calendar & Email", items: [
    { id: "gcal",    icon: "📅", name: "Google Calendar",   desc: "Sync events & reminders" },
    { id: "outlook", icon: "📧", name: "Microsoft Outlook", desc: "Email & calendar integration" },
  ]},
  { category: "Productivity", items: [
    { id: "notion", icon: "📝", name: "Notion",          desc: "Pages, databases & tasks" },
    { id: "slack",  icon: "💬", name: "Slack",           desc: "Team messages & channels" },
    { id: "teams",  icon: "👥", name: "Microsoft Teams", desc: "Meetings & collaboration" },
  ]},
  { category: "Health & Fitness", items: [
    { id: "apple_health", icon: "❤️", name: "Apple Health", desc: "Activity, sleep & vitals" },
    { id: "fitbit",       icon: "💪", name: "Fitbit",       desc: "Fitness tracking & heart rate" },
    { id: "garmin",       icon: "⌚", name: "Garmin",       desc: "GPS sports watches & data" },
  ]},
];

function getIntState(id) { return connectedServices.has(id); }

async function openSettings() {
  document.getElementById("settingsOverlay")?.classList.add("active");
  document.getElementById("settingsPanel")?.classList.add("active");
  await loadConnectedServices();
  renderSettingsTab(activeSettingsTab);
}
function closeSettings() {
  document.getElementById("settingsOverlay")?.classList.remove("active");
  document.getElementById("settingsPanel")?.classList.remove("active");
}

function renderSettingsTab(tab) {
  activeSettingsTab = tab;
  document.querySelectorAll(".snav-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const body = document.getElementById("settingsBody");
  if (!body) return;
  if (tab === "profile")            body.innerHTML = renderProfileTab();
  else if (tab === "voice")         body.innerHTML = renderVoiceTab();
  else if (tab === "appearance")    body.innerHTML = renderAppearanceTab();
  else if (tab === "integrations")  body.innerHTML = renderIntegrationsTab();
  else if (tab === "notifications") body.innerHTML = renderNotificationsTab();
  else if (tab === "privacy")       body.innerHTML = renderPrivacyTab();
  attachSettingsEvents(tab);
}

function renderProfileTab() {
  const initial  = (profile?.full_name?.[0] || "U").toUpperCase();
  const fullName = esc(profile?.full_name || "User");
  const email    = esc(session?.user?.email || "");
  const role     = esc(profile?.role || "user");
  return `<div class="profile-avatar-row"><div class="profile-avatar-large">${initial}</div><div><div class="profile-name">${fullName}</div><div class="profile-email">${email}</div><span class="profile-role">${role}</span></div></div><div class="settings-section"><div class="settings-section-label">Account</div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Sign out</div><div class="settings-row-sub">Sign out of Nova on this device</div></div><button class="int-connect-btn" id="settingsSignOut" style="color:#fca5a5;border-color:rgba(239,68,68,0.2);background:rgba(239,68,68,0.06)">Sign out</button></div></div>`;
}

function renderVoiceTab() {
  const wakeChecked = localStorage.getItem("nova_wake") !== "0" ? "checked" : "";
  const ttsChecked  = ttsEnabled ? "checked" : "";
  const autoChecked = localStorage.getItem("nova_autosend") !== "0" ? "checked" : "";
  return `<div class="settings-section"><div class="settings-section-label">Wake Word</div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Wake word detection</div><div class="settings-row-sub">Say "Nova" to activate hands-free</div></div><input type="checkbox" class="toggle" id="toggleWake" ${wakeChecked}></div></div><div class="settings-section"><div class="settings-section-label">Text to Speech</div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Read responses aloud</div><div class="settings-row-sub">Nova will speak her replies</div></div><input type="checkbox" class="toggle" id="toggleTTS" ${ttsChecked}></div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Auto-send voice input</div><div class="settings-row-sub">Send automatically after speaking</div></div><input type="checkbox" class="toggle" id="toggleAutoSend" ${autoChecked}></div></div>`;
}

function renderAppearanceTab() {
  const isDark    = document.documentElement.getAttribute("data-theme") !== "light";
  const curAccent = localStorage.getItem("nova_accent") || "blue";
  const swatches  = [
    { key: "blue",   color: "#1e5cff", label: "Blue" },
    { key: "purple", color: "#8b5cf6", label: "Purple" },
    { key: "teal",   color: "#06b6d4", label: "Teal" },
    { key: "green",  color: "#10b981", label: "Green" },
    { key: "rose",   color: "#f43f5e", label: "Rose" },
    { key: "amber",  color: "#f59e0b", label: "Amber" },
  ];
  const swatchHtml = swatches.map(s => {
    const sel = s.key === curAccent ? " selected" : "";
    return `<div class="accent-swatch${sel}" data-accent="${s.key}" style="background:${s.color}" title="${s.label}"></div>`;
  }).join("");
  return `<div class="settings-section"><div class="settings-section-label">Theme</div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Dark mode</div><div class="settings-row-sub">Deep space interface</div></div><input type="checkbox" class="toggle" id="toggleTheme" ${isDark ? "checked" : ""}></div></div><div class="settings-section"><div class="settings-section-label">Accent Colour</div><div class="settings-row" style="flex-direction:column;align-items:flex-start;gap:12px;"><div class="settings-row-label">Choose your colour</div><div class="accent-picker">${swatchHtml}</div></div></div>`;
}

function renderIntegrationsTab() {
  let html = "";
  for (const group of INTEGRATIONS) {
    html += `<div class="settings-section"><div class="settings-section-label">${esc(group.category)}</div>`;
    for (const item of group.items) {
      const connected = connectedServices.has(item.id);
      const hasOAuth  = !!INT_OAUTH[item.id];
      const hasNoApi  = !!INT_NO_API[item.id];
      const cardClass = connected ? " connected" : "";
      let actionHtml;
      if (connected) {
        actionHtml = `<div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;flex-shrink:0;"><span class="int-badge connected">Connected</span><button class="int-disconnect-btn" data-int="${esc(item.id)}">Disconnect</button></div>`;
      } else if (hasOAuth) {
        actionHtml = `<button class="int-connect-btn" data-int="${esc(item.id)}">Connect</button>`;
      } else if (hasNoApi) {
        actionHtml = `<button class="int-info-btn" data-int="${esc(item.id)}">Info</button>`;
      } else {
        actionHtml = `<span class="int-soon">Soon</span>`;
      }
      html += `<div class="int-card${cardClass}"><div class="int-icon">${item.icon}</div><div class="int-info"><div class="int-name">${esc(item.name)}</div><div class="int-desc">${esc(item.desc)}</div></div>${actionHtml}</div>`;
    }
    html += "</div>";
  }
  return html;
}

function renderNotificationsTab() {
  const pushChecked   = localStorage.getItem("nova_notif_push")   !== "0" ? "checked" : "";
  const emailChecked  = localStorage.getItem("nova_notif_email")  === "1" ? "checked" : "";
  const remindChecked = localStorage.getItem("nova_notif_remind") !== "0" ? "checked" : "";
  return `<div class="settings-section"><div class="settings-section-label">Notifications</div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Push notifications</div><div class="settings-row-sub">Reminders and alerts on this device</div></div><input type="checkbox" class="toggle" id="togglePush" ${pushChecked}></div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Email digest</div><div class="settings-row-sub">Daily summary of tasks and events</div></div><input type="checkbox" class="toggle" id="toggleEmail" ${emailChecked}></div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Reminder alerts</div><div class="settings-row-sub">Get notified when reminders are due</div></div><input type="checkbox" class="toggle" id="toggleRemind" ${remindChecked}></div></div>`;
}

function renderPrivacyTab() {
  const histChecked   = localStorage.getItem("nova_privacy_history")   !== "0" ? "checked" : "";
  const analytChecked = localStorage.getItem("nova_privacy_analytics") !== "0" ? "checked" : "";
  return `<div class="settings-section"><div class="settings-section-label">Data & Privacy</div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Save conversation history</div><div class="settings-row-sub">Store chats in your account</div></div><input type="checkbox" class="toggle" id="toggleHistory" ${histChecked}></div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Usage analytics</div><div class="settings-row-sub">Help improve Nova with anonymous data</div></div><input type="checkbox" class="toggle" id="toggleAnalytics" ${analytChecked}></div></div><div class="settings-section"><div class="settings-section-label">Data</div><div class="settings-row"><div class="settings-row-info"><div class="settings-row-label">Clear conversation history</div><div class="settings-row-sub">Delete all stored chats permanently</div></div><button class="int-connect-btn" id="clearHistoryBtn" style="color:#fca5a5;border-color:rgba(239,68,68,0.2);background:rgba(239,68,68,0.06)">Clear</button></div></div>`;
}

function attachSettingsEvents(tab) {
  if (tab === "profile") {
    document.getElementById("settingsSignOut")?.addEventListener("click", async () => {
      await sb().auth.signOut();
      window.location.href = "/app/index.html";
    });
  }
  if (tab === "voice") {
    document.getElementById("toggleTTS")?.addEventListener("change", (e) => {
      ttsEnabled = e.target.checked;
      document.getElementById("ttsBtn").textContent = ttsEnabled ? "🔊" : "🔇";
      if (!ttsEnabled) stopSpeaking();
    });
    document.getElementById("toggleWake")?.addEventListener("change", (e) => {
      localStorage.setItem("nova_wake", e.target.checked ? "1" : "0");
      toast("ok", e.target.checked ? "Wake word on" : "Wake word off");
    });
    document.getElementById("toggleAutoSend")?.addEventListener("change", (e) => {
      localStorage.setItem("nova_autosend", e.target.checked ? "1" : "0");
    });
  }
  if (tab === "appearance") {
    document.getElementById("toggleTheme")?.addEventListener("change", (e) => {
      const next = e.target.checked ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("nova_theme", next);
      document.getElementById("themeBtn").textContent = next === "dark" ? "☀️" : "🌙";
    });
    document.querySelectorAll(".accent-swatch").forEach(sw => {
      sw.addEventListener("click", () => {
        document.querySelectorAll(".accent-swatch").forEach(s => s.classList.remove("selected"));
        sw.classList.add("selected");
        localStorage.setItem("nova_accent", sw.dataset.accent);
        toast("ok", sw.title + " accent selected");
      });
    });
  }
  if (tab === "integrations") {
    document.querySelectorAll(".int-connect-btn[data-int]").forEach(btn => {
      btn.addEventListener("click", () => showOAuthModal(btn.dataset.int));
    });
    document.querySelectorAll(".int-info-btn[data-int]").forEach(btn => {
      btn.addEventListener("click", () => showOAuthModal(btn.dataset.int));
    });
    document.querySelectorAll(".int-disconnect-btn[data-int]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await deleteOAuthToken(btn.dataset.int);
        toast("ok", "Disconnected");
        renderSettingsTab("integrations");
      });
    });
  }
  if (tab === "notifications") {
    document.getElementById("togglePush")?.addEventListener("change", (e) => {
      localStorage.setItem("nova_notif_push", e.target.checked ? "1" : "0");
    });
    document.getElementById("toggleEmail")?.addEventListener("change", (e) => {
      localStorage.setItem("nova_notif_email", e.target.checked ? "1" : "0");
    });
    document.getElementById("toggleRemind")?.addEventListener("change", (e) => {
      localStorage.setItem("nova_notif_remind", e.target.checked ? "1" : "0");
    });
  }
  if (tab === "privacy") {
    document.getElementById("toggleHistory")?.addEventListener("change", (e) => {
      localStorage.setItem("nova_privacy_history", e.target.checked ? "1" : "0");
    });
    document.getElementById("toggleAnalytics")?.addEventListener("change", (e) => {
      localStorage.setItem("nova_privacy_analytics", e.target.checked ? "1" : "0");
    });
    document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
      toast("ok", "Conversation history cleared");
    });
  }
}

function initSettings() {
  document.getElementById("settingsBtn")?.addEventListener("click", openSettings);
  document.getElementById("settingsClose")?.addEventListener("click", closeSettings);
  document.getElementById("settingsOverlay")?.addEventListener("click", closeSettings);
  document.querySelectorAll(".snav-btn").forEach(btn => {
    btn.addEventListener("click", () => renderSettingsTab(btn.dataset.tab));
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  initTheme();

  try {
    await requireAuth();
  } catch {
    return;
  }

  renderGreeting();
  initVoice();
  initWakeWord();
  initSettings();
  resetIdle();

  window.addEventListener("message", handleOAuthMessage);

  document.addEventListener("mousemove", resetIdle, { passive: true });
  document.addEventListener("keydown",   resetIdle, { passive: true });
  document.addEventListener("touchstart",resetIdle, { passive: true });
  document.getElementById("idleScreen")?.addEventListener("click", resetIdle);

  if (synth && synth.getVoices().length === 0) {
    synth.addEventListener("voiceschanged", () => {}, { once: true });
  }

  const ta = document.getElementById("novaTextarea");
  ta?.addEventListener("input", () => {
    ta.style.height = "24px";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    document.getElementById("sendBtn").disabled = !ta.value.trim();
  });
  ta?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  const ttsBtn = document.getElementById("ttsBtn");
  ttsBtn?.addEventListener("click", () => {
    ttsEnabled = !ttsEnabled;
    ttsBtn.textContent = ttsEnabled ? "🔊" : "🔇";
    if (!ttsEnabled) stopSpeaking();
    toast("ok", ttsEnabled ? "Voice on" : "Voice off");
  });

  document.querySelectorAll(".quick-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ta = document.getElementById("novaTextarea");
      if (ta) {
        ta.value = btn.dataset.prompt;
        ta.dispatchEvent(new Event("input"));
        sendMessage();
      }
    });
  });

  document.getElementById("themeBtn")?.addEventListener("click", toggleTheme);
  document.getElementById("micBtn")?.addEventListener("click", toggleVoice);
  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await sb().auth.signOut();
    window.location.href = "/app/index.html";
  });
}

boot();
