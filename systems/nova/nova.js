// Nova — Wall Display AI Assistant

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL  = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";
const sb = () => createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ──────────────────────────────────────────────────────────────────
let session      = null;
let profile      = null;
let activeConvId = null;
let messages     = [];
let ttsEnabled   = true;
let muteOn       = false;
let recognition  = null;
let isListening  = false;
let synth        = window.speechSynthesis;
let utterance    = null;
let msgFadeTimer = null;

// ── Clock ──────────────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById("screenClock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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

// ── Orb / state ───────────────────────────────────────────────────────────
function setState(state) {
  const scene  = document.getElementById("orbScene");
  const status = document.getElementById("orbStatus");
  if (!scene) return;

  scene.className = `orb-scene state-${state}`;

  const labels = { idle: "Nova", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
  if (status) status.textContent = labels[state] || "Nova";
}

// ── Message display ────────────────────────────────────────────────────────
let cardsWrap = null;

function showMessage(text, cards = []) {
  const el = document.getElementById("msgDisplay");
  if (!el) return;

  clearTimeout(msgFadeTimer);
  el.classList.remove("fading");
  el.textContent = text;

  // Render cards in sidebar panel
  if (cards.length) {
    if (!cardsWrap) {
      cardsWrap = document.createElement("div");
      cardsWrap.className = "cards-wrap";
      document.querySelector(".nova-screen").appendChild(cardsWrap);
    }
    cardsWrap.innerHTML = cards.map(renderCard).join("");
    setTimeout(() => {
      if (cardsWrap) { cardsWrap.innerHTML = ""; }
    }, 30000);
  }

  // Fade out after 15s
  msgFadeTimer = setTimeout(() => {
    el.classList.add("fading");
    setTimeout(() => { el.textContent = ""; el.classList.remove("fading"); }, 500);
  }, 15000);
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

// ── Conversation ───────────────────────────────────────────────────────────
async function ensureConversation(firstMessage) {
  if (activeConvId) return;
  const client = sb();
  const { data, error } = await client
    .from("nova_conversations")
    .insert({
      user_id: session.user.id,
      company_id: profile.company_id,
      title: firstMessage.slice(0, 80),
    })
    .select()
    .single();
  if (error) throw error;
  activeConvId = data.id;
}

async function saveMessage(role, content, metadata = {}) {
  if (!activeConvId) return;
  const client = sb();
  await client.from("nova_messages").insert({ conversation_id: activeConvId, role, content, metadata });
}

// ── TTS ────────────────────────────────────────────────────────────────────
function speak(text) {
  if (muteOn || !synth) return;
  synth.cancel();

  const clean = text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, "")
    .replace(/[*_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);

  if (!clean) return;

  utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate  = 1.1;
  utterance.pitch = 1.0;
  utterance.lang  = "en-GB";

  const voices = synth.getVoices();
  const pick = (
    voices.find(v => v.lang === "en-GB" && /neural|enhanced|natural|premium/i.test(v.name)) ||
    voices.find(v => v.lang === "en-GB" && /female|serena|kate/i.test(v.name)) ||
    voices.find(v => v.lang === "en-GB") ||
    voices.find(v => v.lang.startsWith("en") && /neural|enhanced/i.test(v.name)) ||
    voices.find(v => v.lang.startsWith("en"))
  );
  if (pick) utterance.voice = pick;

  utterance.onstart = () => setState("speaking");
  utterance.onend   = () => setState("idle");
  utterance.onerror = () => setState("idle");

  setState("speaking");
  synth.speak(utterance);
}

function stopSpeaking() {
  synth?.cancel();
  setState("idle");
}

// ── Voice recognition ──────────────────────────────────────────────────────
function initVoice() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById("micBtn");
  if (!SpeechRec) { if (micBtn) micBtn.style.display = "none"; return; }

  recognition = new SpeechRec();
  recognition.lang = "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;

  const vbar  = document.getElementById("voiceBar");
  const ttext = document.getElementById("transcriptText");
  const ta    = document.getElementById("novaTextarea");

  recognition.onresult = (event) => {
    let interim = "", final = "";
    for (const res of event.results) {
      if (res.isFinal) final   += res[0].transcript;
      else             interim += res[0].transcript;
    }
    if (vbar && ttext) {
      vbar.classList.add("active");
      ttext.textContent = final || interim;
    }
    if (final && ta) ta.value = final;
  };

  recognition.onend = () => {
    isListening = false;
    micBtn?.classList.remove("active");
    setState("idle");
    if (vbar) vbar.classList.remove("active");
    const transcript = ttext?.textContent?.trim();
    if (transcript && ta) {
      ta.value = transcript;
      setTimeout(() => sendMessage(), 100);
    }
  };

  recognition.onerror = (e) => {
    isListening = false;
    micBtn?.classList.remove("active");
    setState("idle");
    if (vbar) vbar.classList.remove("active");
    if (e.error !== "no-speech") toast("warn", `Mic error: ${e.error}`);
  };
}

function toggleVoice() {
  if (!recognition) return;
  const micBtn = document.getElementById("micBtn");
  if (isListening) {
    recognition.stop();
    isListening = false;
    micBtn?.classList.remove("active");
    setState("idle");
    return;
  }
  stopSpeaking();
  try {
    recognition.start();
    isListening = true;
    micBtn?.classList.add("active");
    setState("listening");
  } catch (e) {
    toast("warn", "Could not start microphone");
  }
}

// ── Send ────────────────────────────────────────────────────────────────────
async function sendMessage() {
  const ta      = document.getElementById("novaTextarea");
  const sendBtn = document.getElementById("sendBtn");
  const input   = (ta?.value || "").trim();

  if (!input) return;
  if (!session) { toast("bad", "Not signed in"); return; }

  stopSpeaking();
  ta.value = "";
  ta.style.height = "22px";
  if (sendBtn) sendBtn.disabled = true;

  // Show user message briefly
  showMessage(`You: ${input}`);

  // Ensure conversation exists in DB
  try {
    await ensureConversation(input);
  } catch (e) {
    toast("bad", "Could not start conversation");
    if (sendBtn) sendBtn.disabled = false;
    return;
  }

  messages.push({ role: "user", content: input });
  saveMessage("user", input);

  setState("thinking");

  try {
    const res = await fetch("/api/nova/chat", {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messages: messages.slice(-20), conversation_id: activeConvId }),
    });

    const data = await res.json();

    if (!data.ok || !data.reply) {
      setState("idle");
      const errMsg = data.error || "Something went wrong";
      toast("bad", errMsg);
      showMessage("I'm sorry, something went wrong. Please try again.");
      return;
    }

    const reply = data.reply;
    const cards = data.cards || [];

    messages.push({ role: "assistant", content: reply });
    saveMessage("assistant", reply, { cards });

    showMessage(reply, cards);
    setState("idle");
    speak(reply);

  } catch (e) {
    setState("idle");
    toast("bad", "Connection error");
    showMessage("I'm having trouble connecting. Please check your connection.");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    ta?.focus();
  }
}

// ── Card rendering ─────────────────────────────────────────────────────────
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtTime(iso) { return iso ? iso.slice(11, 16) : ""; }
function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

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
  const lat = card.lat || 51.5074, lng = card.lng || -0.1278;
  const name = card.display_name || card.query || "Location";
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.01},${lat-0.007},${lng+0.01},${lat+0.007}&layer=mapnik&marker=${lat},${lng}`;
  const openUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;
  return `<div class="card card-map">
    <div class="card-head"><span class="card-head-icon">🗺️</span><span>Location</span></div>
    <iframe src="${esc(mapUrl)}" loading="lazy" title="${esc(name)}"></iframe>
    <div class="card-map-info"><span>${esc(name.slice(0, 50))}</span><a href="${openUrl}" target="_blank" class="card-map-link">Open ↗</a></div>
  </div>`;
}

function renderEventCard(card) {
  const items = card.type === "event_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0, 4).map(e => `
    <div class="event-row">
      <div class="event-time-block"><div class="etime">${esc(e.start_time ? fmtTime(e.start_time) : "All day")}</div><div class="edate">${esc(fmtDate(e.start_time))}</div></div>
      <div class="event-info"><div class="event-title">${esc(e.title)}</div>${e.location ? `<div class="event-meta">📍 ${esc(e.location)}</div>` : ""}</div>
    </div>`).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">📅</span><span>${card.action === "created" ? "Event Created" : `${items.length} Event${items.length !== 1 ? "s" : ""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderTaskCard(card) {
  const items = card.type === "task_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0, 8).map(t => `
    <div class="task-row">
      <div class="task-check${t.status === "completed" ? " done" : ""}"></div>
      <span class="task-text${t.status === "completed" ? " done" : ""}">${esc(t.title)}</span>
      <span class="task-priority prio-${t.priority || "medium"}">${t.priority || "med"}</span>
      ${t.due_date ? `<span class="task-due">${t.due_date}</span>` : ""}
    </div>`).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">✅</span><span>${card.action === "created" ? "Task Created" : `${items.length} Task${items.length !== 1 ? "s" : ""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderContactCard(card) {
  const items = card.type === "contact_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0, 5).map(c => {
    const initials = ((c.first_name?.[0] || "") + (c.last_name?.[0] || "")).toUpperCase() || "?";
    return `<div class="contact-item">
      <div class="contact-avatar">${esc(initials)}</div>
      <div><div class="contact-name">${esc(c.first_name + " " + (c.last_name || ""))}</div>
      ${c.email ? `<div class="contact-detail">${esc(c.email)}</div>` : ""}
      ${c.phone ? `<div class="contact-detail">${esc(c.phone)}</div>` : ""}</div>
    </div>`;
  }).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">👤</span><span>${card.action === "created" ? "Contact Saved" : `${items.length} Contact${items.length !== 1 ? "s" : ""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderEmailDraft(card) {
  const draftId = "draft_" + Math.random().toString(36).slice(2);
  const body = `Dear ${card.to?.split(" ")[0] || "[Name]"},\n\n[Re: ${card.purpose}]\n\nKind regards,\n${card.from_name || "[Your name]"}`;
  return `<div class="card email-draft">
    <div class="card-head"><span class="card-head-icon">✉️</span><span>Email Draft</span></div>
    <div class="card-body">
      <div class="email-draft-header">
        <span class="email-draft-label">To:</span><span>${esc(card.to || "(recipient)")}</span>
        <span class="email-draft-label">Subject:</span><span>${esc(card.subject || "(subject)")}</span>
      </div>
      <div class="email-draft-body" id="${draftId}">${esc(body)}</div>
      <div class="email-draft-actions">
        <button class="card-btn" onclick="window.copyDraft('${draftId}')">Copy</button>
      </div>
    </div>
  </div>`;
}

function renderNoteCard(card) {
  const items = card.type === "note_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0, 3).map(n => `
    <div style="margin-bottom:10px;">
      <div style="font-size:12px;font-weight:500;margin-bottom:3px;color:rgba(255,255,255,0.8)">${esc(n.title)}</div>
      <div class="note-card-content">${esc(n.content.slice(0, 150))}${n.content.length > 150 ? "…" : ""}</div>
    </div>`).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">📄</span><span>${card.action === "created" ? "Note Saved" : `${items.length} Note${items.length !== 1 ? "s" : ""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderReminderCard(card) {
  const r = card.data;
  if (!r) return "";
  return `<div class="card"><div class="card-head"><span class="card-head-icon">⏰</span><span>${card.action === "created" ? "Reminder Set" : "Reminder"}</span></div>
    <div class="card-body"><div class="reminder-item"><span class="reminder-icon">🔔</span>
    <div><div class="reminder-title">${esc(r.title)}</div>
    <div class="reminder-time">${r.remind_at ? r.remind_at.slice(0, 16).replace("T", " ") : ""}</div></div></div></div></div>`;
}

window.copyDraft = function(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => toast("ok", "Copied")).catch(() => toast("warn", "Could not copy"));
};

// ── Textarea auto-resize ───────────────────────────────────────────────────
function initTextarea() {
  const ta  = document.getElementById("novaTextarea");
  const btn = document.getElementById("sendBtn");
  if (!ta) return;

  ta.addEventListener("input", () => {
    ta.style.height = "22px";
    ta.style.height = Math.min(ta.scrollHeight, 100) + "px";
    if (btn) btn.disabled = !ta.value.trim();
  });

  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  // Clock
  updateClock();
  setInterval(updateClock, 30000);

  // Auth
  try {
    await requireAuth();
  } catch (e) {
    toast("warn", "Please sign in to use Nova");
    return;
  }

  // Load voices
  if (synth && synth.getVoices().length === 0) {
    synth.addEventListener("voiceschanged", () => {}, { once: true });
  }

  initTextarea();
  initVoice();

  // Mic button
  document.getElementById("micBtn")?.addEventListener("click", toggleVoice);

  // Send button
  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);

  // Mute button
  const muteBtn = document.getElementById("muteBtn");
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      muteOn = !muteOn;
      if (muteOn) stopSpeaking();
      muteBtn.classList.toggle("muted", muteOn);
      muteBtn.title = muteOn ? "Unmute" : "Mute";
    });
  }

  // Click orb to activate mic
  document.getElementById("novaOrb")?.addEventListener("click", toggleVoice);

  setState("idle");
}

boot();
