// SmartCore Nova — AI Personal Assistant Frontend

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";
const sb = () => createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ──────────────────────────────────────────────────────────────────
let session     = null;
let profile     = null;
let messages    = [];
let convId      = null;
let ttsEnabled  = true;
let recognition = null;
let isListening = false;
let synth       = window.speechSynthesis;

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
  return `
    <div class="card card-map">
      <div class="card-head"><span>🗺️</span> Location</div>
      <iframe src="${esc(mapUrl)}" loading="lazy" title="Map of ${esc(name)}"></iframe>
      <div class="card-map-info">
        <span>${esc(name.length > 60 ? name.slice(0,60)+"…" : name)}</span>
        <a href="${openUrl}" target="_blank" rel="noopener" class="card-map-link">Open in Maps ↗</a>
      </div>
    </div>`;
}

function renderEventCard(card) {
  const items = card.type === "event_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,5).map(e => `
    <div class="event-row">
      <div class="event-time-block">
        <div class="etime">${esc(e.start_time ? fmtTime(e.start_time) : "All day")}</div>
        <div class="edate">${esc(e.start_time ? fmtDate(e.start_time) : "")}</div>
      </div>
      <div class="event-info">
        <div class="event-title">${esc(e.title)}</div>
        <div class="event-meta">
          ${e.location ? `<span>📍 ${esc(e.location)}</span>` : ""}
          ${e.description ? `<span>${esc(e.description.slice(0,80))}${e.description.length>80?"…":""}</span>` : ""}
        </div>
      </div>
    </div>`).join("");
  return `
    <div class="card">
      <div class="card-head"><span>📅</span> ${card.action==="created"?"Event Created":`${items.length} Event${items.length!==1?"s":""}`}</div>
      <div class="card-body">${rows}</div>
    </div>`;
}

function renderTaskCard(card) {
  const items = card.type === "task_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,8).map(t => `
    <div class="task-row">
      <div class="task-check${t.status==="completed"?" done":""}"></div>
      <span class="task-text${t.status==="completed"?" done":""">${esc(t.title)}</span>
      <span class="task-priority prio-${t.priority||"medium"}">${t.priority||"medium"}</span>
      ${t.due_date?`<span class="task-due">${t.due_date}</span>`:""}
    </div>`).join("");
  return `
    <div class="card">
      <div class="card-head"><span>✅</span> ${card.action==="created"?"Task Created":`${items.length} Task${items.length!==1?"s":""}`}</div>
      <div class="card-body" style="padding:8px 14px;">${rows}</div>
    </div>`;
}

function renderContactCard(card) {
  const items = card.type === "contact_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const contacts = items.slice(0,6).map(c => {
    const initials = ((c.first_name?.[0]||"")+( c.last_name?.[0]||"" )).toUpperCase()||"?";
    return `
      <div class="contact-item">
        <div class="contact-avatar">${esc(initials)}</div>
        <div>
          <div class="contact-name">${esc(c.first_name+" "+(c.last_name||""))}</div>
          ${c.email?`<div class="contact-detail">✉ ${esc(c.email)}</div>`:""}
          ${c.phone?`<div class="contact-detail">📞 ${esc(c.phone)}</div>`:""}
        </div>
      </div>`;
  }).join("");
  return `
    <div class="card">
      <div class="card-head"><span>👤</span> ${card.action==="created"?"Contact Saved":`${items.length} Contact${items.length!==1?"s":""}`}</div>
      <div class="card-body"><div class="contact-card-grid">${contacts}</div></div>
    </div>`;
}

function renderEmailDraft(card) {
  const id   = "draft_" + Math.random().toString(36).slice(2);
  const greeting = card.to ? `Dear ${card.to.split(" ")[0]},` : "Dear [Name],";
  const sign = card.from_name ? `\n\nKind regards,\n${card.from_name}` : "\n\nKind regards,\n[Your name]";
  const points = card.key_points?.length ? "\n\n"+card.key_points.map((p,i)=>`${i+1}. ${p}`).join("\n") : "";
  const body = `${greeting}\n\n[Re: ${card.purpose}]${points}${sign}`;
  return `
    <div class="card">
      <div class="card-head"><span>✉️</span> Email Draft</div>
      <div class="card-body">
        <div class="email-draft-header">
          <span class="email-draft-label">To:</span><span>${esc(card.to||"(recipient)")}</span>
          <span class="email-draft-label">Subject:</span><span>${esc(card.subject||"(subject)")}</span>
        </div>
        <div class="email-draft-body" id="${id}">${esc(body)}</div>
        <div class="email-draft-actions">
          <button class="card-btn" onclick="window._copyDraft('${id}')">📋 Copy</button>
          <button class="card-btn" onclick="window._refineEmail(this)" data-purpose="${esc(card.purpose||"")}">✏️ Refine</button>
        </div>
      </div>
    </div>`;
}

function renderNoteCard(card) {
  const items = card.type === "note_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,3).map(n => `
    <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.04);">
      <div style="font-size:13px;font-weight:600;margin-bottom:5px;">${esc(n.title)}</div>
      <div class="note-card-content">${esc(n.content.slice(0,200))}${n.content.length>200?"…":""}</div>
      ${n.tags?.length?`<div class="note-tags">${n.tags.map(t=>`<span class="note-tag">${esc(t)}</span>`).join("")}</div>`:""}
    </div>`).join("");
  return `
    <div class="card">
      <div class="card-head"><span>📄</span> ${card.action==="created"?"Note Saved":`${items.length} Note${items.length!==1?"s":""}`}</div>
      <div class="card-body">${rows}</div>
    </div>`;
}

function renderReminderCard(card) {
  const r = card.data;
  if (!r) return "";
  return `
    <div class="card">
      <div class="card-head"><span>⏰</span> ${card.action==="created"?"Reminder Set":"Reminder"}</div>
      <div class="card-body">
        <div class="reminder-item">
          <span class="reminder-icon">🔔</span>
          <div>
            <div class="reminder-title">${esc(r.title)}</div>
            <div class="reminder-time">${r.remind_at?r.remind_at.slice(0,16).replace("T"," "):""}${r.repeat_interval&&r.repeat_interval!=="none"?` · repeats ${r.repeat_interval}`:""}</div>
          </div>
        </div>
      </div>
    </div>`;
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
    const bar   = document.getElementById("voiceBar");
    const text  = document.getElementById("transcriptText");
    const input = document.getElementById("novaTextarea");
    bar.classList.remove("active");
    if (text?.textContent.trim()) {
      if (input) input.value = text.textContent.trim();
      setTimeout(() => sendMessage(), 100);
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
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
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

  document.getElementById("themeBtn")?.addEventListener("click", toggleTheme);
  document.getElementById("micBtn")?.addEventListener("click", toggleVoice);
  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await sb().auth.signOut();
    window.location.href = "/app/index.html";
  });
}

boot();
