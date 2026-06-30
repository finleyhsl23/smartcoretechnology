// Nova — Futuristic AI Assistant

const SUPABASE_URL  = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";
const sb = () => window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ──────────────────────────────────────────────────────────────────
let session      = null;
let profile      = null;
let activeConvId = null;
let messages     = [];
let muteOn       = false;
let recognition  = null;
let isListening  = false;
let synth        = window.speechSynthesis;
let utterance    = null;
let chatStarted  = false;
let ownerMode    = false;

// ── Clock ──────────────────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById("clock");
  if (el) el.textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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

// ── Greeting ───────────────────────────────────────────────────────────────
function setGreeting() {
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const name = profile?.full_name?.split(" ")[0];
  const greet = name ? `Good ${period}, ${name}.` : `Good ${period}.`;
  const el = document.getElementById("greetingText");
  if (el) el.textContent = greet;
}

function setGreetingNoAuth() {
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  const el = document.getElementById("greetingText");
  if (el) el.textContent = `Good ${period}.`;
}

// ── State management ───────────────────────────────────────────────────────
function setStatus(state) {
  const pill  = document.getElementById("statusPill");
  const label = document.getElementById("statusLabel");
  const dot   = document.getElementById("statusDot");
  if (!pill) return;
  pill.className = `status-pill ${state !== "idle" ? state : ""}`;
  const labels = { idle: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
  if (label) label.textContent = labels[state] || "Ready";
}

function showSpeakOverlay(on) {
  document.getElementById("speakOverlay")?.classList.toggle("active", on);
}

// ── Standby / chat switching ───────────────────────────────────────────────
let standbyTimer = null;

function resetStandbyTimer() {
  clearTimeout(standbyTimer);
  standbyTimer = setTimeout(enterStandby, 30000);
}

function enterStandby() {
  if (!chatStarted) return;
  chatStarted = false;
  document.getElementById("welcome")?.classList.remove("hidden");
  document.getElementById("chatArea")?.classList.remove("active");
  stopSpeaking();
  setStatus("idle");
  // Keep messages/session in memory — chat resumes seamlessly
}

function enterChat() {
  if (chatStarted) { resetStandbyTimer(); return; }
  chatStarted = true;
  document.getElementById("welcome")?.classList.add("hidden");
  document.getElementById("chatArea")?.classList.add("active");
  resetStandbyTimer();
}

// ── Chat rendering ─────────────────────────────────────────────────────────
function fmtTime(iso) { return iso ? iso.slice(11, 16) : new Date().toTimeString().slice(0, 5); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""; }
function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function scrollToBottom() {
  const el = document.getElementById("chatScroll");
  if (el) el.scrollTop = el.scrollHeight;
}

function addMessageEl(html) {
  const scroll = document.getElementById("chatScroll");
  const wrap = document.createElement("div");
  wrap.className = "chat-inner";
  wrap.innerHTML = html;
  scroll.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function renderUserMsg(content) {
  const initial = profile?.full_name?.[0]?.toUpperCase() || "U";
  addMessageEl(`
    <div class="msg user">
      <div class="msg-avatar">${esc(initial)}</div>
      <div class="msg-body">
        <div class="msg-bubble">${esc(content)}</div>
        <div class="msg-time">${fmtTime()}</div>
      </div>
    </div>
  `);
}

function renderNovaMsg(content, cards = []) {
  let cardsHtml = "";
  if (cards.length) cardsHtml = `<div class="msg-cards">${cards.map(renderCard).join("")}</div>`;
  addMessageEl(`
    <div class="msg nova">
      <div class="msg-avatar">✦</div>
      <div class="msg-body">
        <div class="msg-bubble">${esc(content)}</div>
        ${cardsHtml}
        <div class="msg-time">${fmtTime()}</div>
      </div>
    </div>
  `);
}

function showTyping() {
  const scroll = document.getElementById("chatScroll");
  const el = document.createElement("div");
  el.className = "chat-inner"; el.id = "typingEl";
  el.innerHTML = `<div class="typing-row">
    <div class="msg-avatar nova" style="width:30px;height:30px;border-radius:50%;background:conic-gradient(from 0deg,#1a3bcc,#2563ff,#60a5fa,#2563ff);box-shadow:0 0 12px rgba(37,99,255,.5);display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;flex-shrink:0">✦</div>
    <div class="typing-dots"><span></span><span></span><span></span></div>
  </div>`;
  scroll.appendChild(el);
  scrollToBottom();
}
function hideTyping() { document.getElementById("typingEl")?.remove(); }

// ── Auth ───────────────────────────────────────────────────────────────────
async function requireAuth() {
  const client = sb();
  const { data, error } = await client.auth.getSession();
  if (error || !data?.session) throw new Error("Not authenticated");
  session = data.session;
  const { data: prof } = await client
    .from("user_profiles").select("user_id,company_id,role,full_name,active")
    .eq("user_id", session.user.id).maybeSingle();
  if (!prof) throw new Error("No profile");
  profile = prof;
}

// ── Conversation ───────────────────────────────────────────────────────────
async function ensureConversation(firstMsg) {
  if (activeConvId) return;
  const client = sb();
  const { data, error } = await client
    .from("nova_conversations")
    .insert({ user_id: session.user.id, company_id: profile.company_id, title: firstMsg.slice(0, 80) })
    .select().single();
  if (error) throw error;
  activeConvId = data.id;
}

async function saveMessage(role, content, metadata = {}) {
  if (!activeConvId) return;
  await sb().from("nova_messages").insert({ conversation_id: activeConvId, role, content, metadata });
}

// ── Captions ───────────────────────────────────────────────────────────────
function clearCaption() {
  const el = document.getElementById("speakCaption");
  if (el) el.innerHTML = "";
}

function mountCaption(text) {
  const el = document.getElementById("speakCaption");
  if (!el) return;
  const words = text.split(/\s+/).filter(Boolean);
  el.innerHTML = words.map((w, i) => `<span class="word" id="cw${i}">${w}</span>`).join(" ");
  return words.length;
}

function syncCaption(audio, wordCount) {
  audio.addEventListener("timeupdate", () => {
    if (!audio.duration || !isFinite(audio.duration)) return;
    const idx = Math.floor((audio.currentTime / audio.duration) * wordCount);
    for (let i = 0; i <= Math.min(idx, wordCount - 1); i++) {
      document.getElementById(`cw${i}`)?.classList.add("lit");
    }
  });
}

// ── TTS ────────────────────────────────────────────────────────────────────
let currentAudio = null;

function stopSpeakingAudio() {
  if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio.src = ""; currentAudio = null; }
  clearCaption();
  setStatus("idle");
  showSpeakOverlay(false);
}

function stopSpeaking() {
  stopSpeakingAudio();
  synth?.cancel();
}

// Stream audio via MediaSource so playback starts on first chunk
function playStream(stream, clean) {
  return new Promise((resolve) => {
    const mime = "audio/mpeg";
    if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(mime)) {
      resolve(null); return;
    }
    const ms = new MediaSource();
    const url = URL.createObjectURL(ms);
    const audio = new Audio(url);

    ms.addEventListener("sourceopen", async () => {
      let sb;
      try { sb = ms.addSourceBuffer(mime); }
      catch { URL.revokeObjectURL(url); resolve(null); return; }

      const reader = stream.getReader();
      const pump = async () => {
        const { done, value } = await reader.read().catch(() => ({ done: true }));
        if (done) {
          if (ms.readyState === "open") {
            if (sb.updating) sb.addEventListener("updateend", () => { if (ms.readyState === "open") ms.endOfStream(); }, { once: true });
            else ms.endOfStream();
          }
          return;
        }
        if (sb.updating) await new Promise(r => sb.addEventListener("updateend", r, { once: true }));
        try { sb.appendBuffer(value); } catch {}
        await new Promise(r => sb.addEventListener("updateend", r, { once: true }));
        pump();
      };
      pump();
      audio._msUrl = url;
      resolve(audio);
    });

    setTimeout(() => resolve(null), 3000); // fallback if sourceopen never fires
  });
}

async function speak(text) {
  if (muteOn) return;
  stopSpeakingAudio();
  synth?.cancel();

  const clean = text.replace(/[*_#`]/g, "").replace(/\s+/g, " ").trim().slice(0, 700);
  if (!clean) return;

  let res;
  try {
    res = await fetch("/api/nova/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session?.access_token}` },
      body: JSON.stringify({ text: clean }),
    });
  } catch (e) {
    console.error("[TTS] fetch:", e);
    return;
  }

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.error("[TTS] error", res.status, err);
    toast("warn", `TTS error ${res.status}`);
    return;
  }

  const wordCount = mountCaption(clean);

  // Try streaming first, fall back to blob
  let audio = await playStream(res.body, clean);
  if (!audio) {
    const blob = await res.blob().catch(() => null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    audio._blobUrl = url;
  }

  currentAudio = audio;
  syncCaption(audio, wordCount);

  return new Promise((resolve) => {
    audio.addEventListener("ended", () => {
      if (audio._msUrl)   URL.revokeObjectURL(audio._msUrl);
      if (audio._blobUrl) URL.revokeObjectURL(audio._blobUrl);
      currentAudio = null;
      stopSpeakingAudio();
      resetStandbyTimer();
      resolve();
    });
    audio.addEventListener("error", () => {
      if (audio._msUrl)   URL.revokeObjectURL(audio._msUrl);
      if (audio._blobUrl) URL.revokeObjectURL(audio._blobUrl);
      currentAudio = null;
      stopSpeakingAudio();
      resolve();
    });

    setStatus("speaking");
    showSpeakOverlay(true);
    resetStandbyTimer();
    audio.play().catch((e) => { console.error("[TTS] play:", e); stopSpeakingAudio(); resolve(); });
  });
}

// ── Voice recognition ──────────────────────────────────────────────────────
function initVoice() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById("micBtn");
  if (!SpeechRec) { if (micBtn) micBtn.style.display="none"; return; }

  recognition = new SpeechRec();
  recognition.lang = "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;

  const tbar  = document.getElementById("transcriptBar");
  const ttext = document.getElementById("transcriptText");
  const ta    = document.getElementById("novaTextarea");

  recognition.onresult = (event) => {
    let interim = "", final = "";
    for (const res of event.results) {
      if (res.isFinal) final += res[0].transcript; else interim += res[0].transcript;
    }
    if (tbar && ttext) { tbar.classList.add("active"); ttext.textContent = final || interim; }
    if (final && ta) ta.value = final;
  };

  recognition.onend = () => {
    isListening = false;
    micBtn?.classList.remove("active");
    setStatus("idle");
    if (tbar) tbar.classList.remove("active");
    const t = ttext?.textContent?.trim();
    if (t && ta) { ta.value = t; setTimeout(() => sendMessage(), 100); }
  };

  recognition.onerror = (e) => {
    isListening = false;
    micBtn?.classList.remove("active");
    setStatus("idle");
    if (tbar) tbar.classList.remove("active");
    if (e.error !== "no-speech") toast("warn", `Mic error: ${e.error}`);
  };
}

function toggleVoice() {
  if (!recognition) return;
  const micBtn = document.getElementById("micBtn");
  if (isListening) {
    recognition.stop(); isListening = false;
    micBtn?.classList.remove("active"); setStatus("idle"); return;
  }
  stopSpeaking();
  try {
    recognition.start(); isListening = true;
    micBtn?.classList.add("active"); setStatus("listening");
  } catch (e) { toast("warn", "Could not start microphone"); }
}

// ── Send ────────────────────────────────────────────────────────────────────
async function sendMessage() {
  const ta      = document.getElementById("novaTextarea");
  const sendBtn = document.getElementById("sendBtn");
  const input   = (ta?.value || "").trim();
  if (!input) return;
  if (!session) { toast("bad", "Not signed in"); return; }

  // Check for owner unlock
  const inputLower = input.toLowerCase();
  if (inputLower.includes('finley hassall') && inputLower.includes('2304')) {
    ownerMode = true;
  }

  // Owner "say" shortcut — bypass AI entirely
  if (ownerMode) {
    const sayMatch = input.match(/^(?:say|speak)\s+(.+)$/i);
    if (sayMatch) {
      stopSpeaking();
      ta.value = ""; ta.style.height = "22px";
      enterChat();
      const sayText = sayMatch[1].trim();
      renderUserMsg(input);
      const replyText = sayText;
      messages.push({ role: "user", content: input });
      messages.push({ role: "assistant", content: replyText });
      await speak(replyText);
      renderNovaMsg(replyText);
      if (sendBtn) sendBtn.disabled = false;
      ta?.focus();
      return;
    }
  }

  stopSpeaking();
  ta.value = ""; ta.style.height = "22px";
  if (sendBtn) sendBtn.disabled = true;

  enterChat();
  renderUserMsg(input);
  messages.push({ role: "user", content: input });

  try {
    await ensureConversation(input);
  } catch (e) {
    toast("bad", "Could not start conversation — " + e.message);
    if (sendBtn) sendBtn.disabled = false;
    return;
  }
  saveMessage("user", input);

  setStatus("thinking");
  showTyping();

  try {
    const res = await fetch("/api/nova/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${session.access_token}` },
      body: JSON.stringify({ messages: messages.slice(-20), conversation_id: activeConvId, owner_mode: ownerMode }),
    });

    const data = await res.json().catch(() => ({}));
    hideTyping();

    if (!data.ok || !data.reply) {
      setStatus("idle");
      const errMsg = data.error || `Server error ${res.status}`;
      toast("bad", errMsg);
      renderNovaMsg("I'm sorry, something went wrong. Please try again.");
      return;
    }

    messages.push({ role: "assistant", content: data.reply });
    saveMessage("assistant", data.reply, { cards: data.cards || [] });
    setStatus("idle");
    await speak(data.reply);
    renderNovaMsg(data.reply, data.cards || []);

  } catch (e) {
    hideTyping();
    setStatus("idle");
    toast("bad", "Connection error — " + e.message);
    renderNovaMsg("I'm having trouble connecting. Please check your connection.");
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    ta?.focus();
  }
}

// ── Card rendering ─────────────────────────────────────────────────────────
function renderCard(card) {
  if (!card) return "";
  switch (card.type) {
    case "map":                      return renderMapCard(card);
    case "event": case "event_list": return renderEventCard(card);
    case "task":  case "task_list":  return renderTaskCard(card);
    case "contact": case "contact_list": return renderContactCard(card);
    case "email_draft":              return renderEmailDraft(card);
    case "note":  case "note_list":  return renderNoteCard(card);
    case "reminder":                 return renderReminderCard(card);
    default: return "";
  }
}

function renderMapCard(card) {
  const lat = card.lat||51.5074, lng = card.lng||-0.1278;
  const name = card.display_name||card.query||"Location";
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-.01},${lat-.007},${lng+.01},${lat+.007}&layer=mapnik&marker=${lat},${lng}`;
  const openUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=14/${lat}/${lng}`;
  return `<div class="card card-map"><div class="card-head"><span class="card-head-icon">🗺️</span><span>Location</span></div>
    <iframe src="${esc(mapUrl)}" loading="lazy" title="${esc(name)}"></iframe>
    <div class="card-map-info"><span>${esc(name.slice(0,55))}</span><a href="${openUrl}" target="_blank" class="card-map-link">Open ↗</a></div></div>`;
}

function renderEventCard(card) {
  const items = card.type==="event_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,5).map(e=>`<div class="event-row">
    <div class="event-time-block"><div class="etime">${esc(e.start_time?fmtTime(e.start_time):"All day")}</div><div class="edate">${esc(fmtDate(e.start_time))}</div></div>
    <div><div class="event-title">${esc(e.title)}</div>${e.location?`<div class="event-meta">📍 ${esc(e.location)}</div>`:""}</div></div>`).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">📅</span><span>${card.action==="created"?"Event Created":`${items.length} Event${items.length!==1?"s":""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderTaskCard(card) {
  const items = card.type==="task_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,8).map(t=>`<div class="task-row">
    <div class="task-check${t.status==="completed"?" done":""}"></div>
    <span class="task-text${t.status==="completed"?" done":""}">${esc(t.title)}</span>
    <span class="task-priority prio-${t.priority||"medium"}">${t.priority||"med"}</span>
    ${t.due_date?`<span class="task-due">${t.due_date}</span>`:""}</div>`).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">✅</span><span>${card.action==="created"?"Task Created":`${items.length} Task${items.length!==1?"s":""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderContactCard(card) {
  const items = card.type==="contact_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,5).map(c=>{
    const i=((c.first_name?.[0]||"")+(c.last_name?.[0]||"")).toUpperCase()||"?";
    return `<div class="contact-item"><div class="contact-avatar">${esc(i)}</div>
      <div><div class="contact-name">${esc(c.first_name+" "+(c.last_name||""))}</div>
      ${c.email?`<div class="contact-detail">${esc(c.email)}</div>`:""}
      ${c.phone?`<div class="contact-detail">${esc(c.phone)}</div>`:""}</div></div>`;
  }).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">👤</span><span>${card.action==="created"?"Contact Saved":`${items.length} Contact${items.length!==1?"s":""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderEmailDraft(card) {
  const id = "draft_"+Math.random().toString(36).slice(2);
  const body = `Dear ${card.to?.split(" ")[0]||"[Name]"},\n\n[Re: ${card.purpose}]\n\nKind regards,\n${card.from_name||"[Your name]"}`;
  return `<div class="card"><div class="card-head"><span class="card-head-icon">✉️</span><span>Email Draft</span></div><div class="card-body">
    <div class="email-draft-header"><span class="email-draft-label">To:</span><span>${esc(card.to||"(recipient)")}</span><span class="email-draft-label">Subject:</span><span>${esc(card.subject||"(subject)")}</span></div>
    <div class="email-draft-body" id="${id}">${esc(body)}</div>
    <div class="email-draft-actions"><button class="card-btn" onclick="window._copyDraft('${id}')">Copy</button></div></div></div>`;
}

function renderNoteCard(card) {
  const items = card.type==="note_list" ? card.data : [card.data];
  if (!items?.length) return "";
  const rows = items.slice(0,3).map(n=>`<div style="margin-bottom:10px">
    <div style="font-size:12px;font-weight:500;margin-bottom:3px;color:rgba(255,255,255,.8)">${esc(n.title)}</div>
    <div class="note-card-content">${esc(n.content.slice(0,150))}${n.content.length>150?"…":""}</div></div>`).join("");
  return `<div class="card"><div class="card-head"><span class="card-head-icon">📄</span><span>${card.action==="created"?"Note Saved":`${items.length} Note${items.length!==1?"s":""}`}</span></div><div class="card-body">${rows}</div></div>`;
}

function renderReminderCard(card) {
  const r = card.data; if (!r) return "";
  return `<div class="card"><div class="card-head"><span class="card-head-icon">⏰</span><span>${card.action==="created"?"Reminder Set":"Reminder"}</span></div>
    <div class="card-body"><div class="reminder-item"><span class="reminder-icon">🔔</span>
    <div><div class="reminder-title">${esc(r.title)}</div><div class="reminder-time">${r.remind_at?r.remind_at.slice(0,16).replace("T"," "):""}</div></div></div></div></div>`;
}

window._copyDraft = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.textContent).then(() => toast("ok","Copied")).catch(() => toast("warn","Could not copy"));
};

// Quick prompt from tiles
window._prompt = (text) => {
  const ta = document.getElementById("novaTextarea");
  if (ta) { ta.value = text; ta.dispatchEvent(new Event("input")); sendMessage(); }
};

// ── Textarea ────────────────────────────────────────────────────────────────
function initTextarea() {
  const ta  = document.getElementById("novaTextarea");
  const btn = document.getElementById("sendBtn");
  if (!ta) return;
  ta.addEventListener("input", () => {
    ta.style.height = "22px";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    if (btn) btn.disabled = !ta.value.trim();
    if (chatStarted) resetStandbyTimer();
  });
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  // Set up UI immediately — don't gate on auth
  updateClock();
  setInterval(updateClock, 60000);
  setGreetingNoAuth();

  initTextarea();
  initVoice();

  document.getElementById("micBtn")?.addEventListener("click", toggleVoice);
  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);

  const muteBtn = document.getElementById("muteBtn");
  if (muteBtn) {
    muteBtn.addEventListener("click", () => {
      muteOn = !muteOn;
      if (muteOn) stopSpeaking();
      muteBtn.classList.toggle("muted", muteOn);
      muteBtn.title = muteOn ? "Unmute" : "Mute";
    });
  }

  document.getElementById("speakOverlay")?.addEventListener("click", stopSpeaking);

  if (synth && synth.getVoices().length === 0) {
    synth.addEventListener("voiceschanged", () => {}, { once: true });
  }

  setStatus("idle");

  // Auth in background — update greeting with name once loaded
  try {
    await requireAuth();
    setGreeting();
  } catch (e) {
    toast("warn", "Please sign in to use Nova");
  }
}

boot();
