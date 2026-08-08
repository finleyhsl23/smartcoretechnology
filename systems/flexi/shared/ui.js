export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fmtMoney(pence, currency = "GBP") {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  return symbol + (Number(pence || 0) / 100).toFixed(2);
}

export function fmtDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Deterministic gradient palette for .fx-tile thumbnail cards (program /
// exercise / package cards) — same seed always resolves to the same
// gradient so a card doesn't change colour on re-render.
const TILE_GRADIENTS = [
  "linear-gradient(135deg,#ff7a45,#ff3d7f)",
  "linear-gradient(135deg,#6366f1,#a855f7)",
  "linear-gradient(135deg,#0ea5b7,#2563eb)",
  "linear-gradient(135deg,#16a34a,#0d9488)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#8b5cf6,#ec4899)",
];
export function tileGradient(seed) {
  const str = String(seed ?? "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return TILE_GRADIENTS[hash % TILE_GRADIENTS.length];
}

// Animates a stat element's text from 0 up to `target`. Pass a `format`
// function to control how each intermediate frame is rendered (defaults to
// a plain integer). Respects prefers-reduced-motion by jumping straight
// to the final value.
export function animateNumber(el, target, { duration = 700, format } = {}) {
  if (!el) return;
  const fmt = format || (n => Math.round(n).toLocaleString("en-GB"));
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !target) { el.textContent = fmt(target || 0); return; }
  const t0 = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(target * eased);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = fmt(target);
  }
  requestAnimationFrame(tick);
}

export function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
}

let _toastTimer = null;
export function toast(message, type = "info") {
  let el = document.getElementById("fxToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "fxToast";
    el.className = "fx-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `fx-toast fx-toast-${type} fx-toast-show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("fx-toast-show"), 3200);
}

export function setLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.dataset.origText || btn.textContent;
    btn.textContent = loadingText || "Working…";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.origText || btn.textContent;
    btn.disabled = false;
  }
}

export function showMessage(elId, message, type = "info") {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = `fx-form-msg fx-form-msg-${type}`;
}

export function revealApp() {
  const loader = document.getElementById("fxLoader");
  const app = document.getElementById("fxApp");
  if (loader) loader.style.display = "none";
  if (app) app.style.display = "";
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("fx-modal-open");
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("fx-modal-open");
}

export function emptyState(icon, title, sub) {
  return `<div class="fx-empty"><div class="fx-empty-icon">${icon}</div><div class="fx-empty-title">${escapeHtml(title)}</div>${sub ? `<div class="fx-empty-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}

// Progressively enhances a plain <select> into a searchable combobox — type
// to filter, click/Enter to choose. The original <select> stays in the DOM
// (hidden) as the single source of truth, so every existing call site that
// reads `.value` / `.selectedOptions` or listens for `change` keeps working
// unmodified; this only needs to be called once after the select's options
// are populated (safe to call again after re-populating — it just refreshes
// the visible label instead of re-wrapping).
export function enhanceSelect(select, { placeholder } = {}) {
  if (!select) return;
  if (select.dataset.fxEnhanced) {
    const input = select.nextElementSibling?.querySelector(".fx-combo-input");
    if (input) input.value = select.selectedOptions[0]?.textContent?.trim() || "";
    return;
  }
  select.dataset.fxEnhanced = "1";
  select.style.display = "none";

  const wrap = document.createElement("div");
  wrap.className = "fx-combo";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "fx-input fx-combo-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = placeholder || select.dataset.placeholder || "Search…";
  const list = document.createElement("div");
  list.className = "fx-combo-list";
  wrap.appendChild(input);
  wrap.appendChild(list);
  select.insertAdjacentElement("afterend", wrap);

  const opts = () => Array.from(select.options).filter(o => o.textContent.trim());
  const sync = () => { input.value = select.selectedOptions[0]?.textContent?.trim() || ""; };
  sync();

  function render(query) {
    const q = (query || "").trim().toLowerCase();
    const matches = opts().filter(o => !q || o.textContent.toLowerCase().includes(q));
    list.innerHTML = !matches.length
      ? `<div class="fx-combo-empty">No matches</div>`
      : matches.map(o => `<div class="fx-combo-opt${o.value === select.value ? " active" : ""}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.textContent.trim())}</div>`).join("");
    list.querySelectorAll("[data-value]").forEach(row => {
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select.value = row.dataset.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        sync();
        close();
      });
    });
  }
  function open() { render(""); list.classList.add("fx-combo-open"); }
  function close() { list.classList.remove("fx-combo-open"); sync(); }

  input.addEventListener("focus", () => { input.value = ""; open(); });
  input.addEventListener("input", () => render(input.value));
  input.addEventListener("blur", () => setTimeout(close, 130));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") input.blur(); });
}

// Wires every theme-toggle button on the page (there may be more than one —
// e.g. a top utility bar and a sidebar footer both offering the control) so
// they all stay in sync, clicking any of them flips the theme for all.
export function setupThemeToggle(storageKey = "flexiTheme") {
  const saved = localStorage.getItem(storageKey);
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  const btns = document.querySelectorAll("#themeToggle, .fx-theme-btn");
  if (!btns.length) return;
  const sync = () => {
    const cur = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    btns.forEach(btn => { btn.textContent = cur === "dark" ? "☀️" : "🌙"; });
  };
  sync();
  btns.forEach(btn => btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(storageKey, next);
    sync();
  }));
}

// Persistent background-music playlist set per-company in Settings — plays
// across every trainer page and every client-portal page. Each page is a
// full reload (not an SPA), so the underlying <video> element (used for
// both audio- and video-source tracks — a hidden <video> plays an
// audio-only file just fine, so one element handles either kind without
// swapping tags) can't literally survive navigation. Instead: which track
// was playing, its position within that track, and the chosen volume are
// all checkpointed to localStorage every few seconds and on page hide,
// then restored on the next page's load — so it sounds continuous and
// keeps your place rather than restarting on every click. With more than
// one track, finishing one advances to the next and wraps back to the
// first after the last (that's the "loop"); with a single track the
// element's native `loop` just repeats it directly. No-ops (and hides the
// toggle) if the company hasn't added any tracks. Expects a
// `#fxMusicWrap` (containing a `#fxMusicToggle` button) already in the
// DOM — builds the skip/volume/track-list popover inside it on demand.
export function setupBackgroundMedia(tracks) {
  const wraps = document.querySelectorAll("#fxMusicWrap");
  if (!tracks || !tracks.length) { wraps.forEach(w => w.style.display = "none"); return; }
  wraps.forEach(w => w.style.display = "");

  const VOLUME_KEY = "flexiMusicVolume";
  const TRACK_KEY = "flexiMusicTrackId";
  const positionKeyFor = track => `flexiMusicPosition:${track.url}`;

  let media = document.getElementById("fxBgMedia");
  if (!media) {
    media = document.createElement("video");
    media.id = "fxBgMedia";
    media.playsInline = true;
    media.style.display = "none";
    document.body.appendChild(media);
  }

  let storedVolume = parseFloat(localStorage.getItem(VOLUME_KEY));
  if (isNaN(storedVolume)) storedVolume = 1;

  const savedTrackId = localStorage.getItem(TRACK_KEY);
  let currentIndex = Math.max(0, tracks.findIndex(t => t.id === savedTrackId));

  const savePosition = () => {
    const track = tracks[currentIndex];
    if (track && !isNaN(media.currentTime)) localStorage.setItem(positionKeyFor(track), String(media.currentTime));
  };

  function renderPanels() {
    wraps.forEach(wrap => {
      const panel = wrap.querySelector(".fx-music-panel");
      if (!panel) return;
      const track = tracks[currentIndex];
      panel.innerHTML = `
        <div class="fx-music-now">${escapeHtml(track?.name || "Untitled")}</div>
        <div class="fx-music-controls">
          <button type="button" class="fx-icon-btn" data-music-prev title="Previous track">⏮</button>
          <button type="button" class="fx-icon-btn" data-music-next title="Next track">⏭</button>
        </div>
        <div class="fx-music-vol">
          <span>🔈</span>
          <input type="range" min="0" max="100" value="${Math.round(storedVolume * 100)}" data-music-volume/>
          <span>🔊</span>
        </div>
        ${tracks.length > 1 ? `<div class="fx-music-list">
          ${tracks.map((t, i) => `<div class="fx-music-track${i === currentIndex ? " active" : ""}" data-music-track="${i}">${escapeHtml(t.name)}</div>`).join("")}
        </div>` : ""}
      `;
      panel.querySelector("[data-music-prev]").addEventListener("click", () => loadTrack(currentIndex - 1));
      panel.querySelector("[data-music-next]").addEventListener("click", () => loadTrack(currentIndex + 1));
      panel.querySelector("[data-music-volume]").addEventListener("input", (e) => {
        storedVolume = parseInt(e.target.value, 10) / 100;
        media.muted = storedVolume === 0;
        media.volume = storedVolume;
        localStorage.setItem(VOLUME_KEY, String(storedVolume));
      });
      panel.querySelectorAll("[data-music-track]").forEach(row => row.addEventListener("click", () => {
        const i = parseInt(row.dataset.musicTrack, 10);
        if (i !== currentIndex) loadTrack(i);
      }));
    });
  }

  function loadTrack(index) {
    savePosition();
    currentIndex = ((index % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[currentIndex];
    localStorage.setItem(TRACK_KEY, track.id);
    media.loop = tracks.length <= 1;
    // Browsers block *starting* playback with sound unless the visitor has
    // already interacted with this page, but don't re-check that once
    // playback is already underway — so always start muted (guaranteed to
    // autoplay), then flip to the chosen volume right after play()
    // actually succeeds. Without this, sound silently never started on a
    // fresh navigation and looked like it kept resetting to muted.
    media.muted = true;
    if (media.getAttribute("src") !== track.url) media.src = track.url;

    const resume = () => {
      const saved = parseFloat(localStorage.getItem(positionKeyFor(track)));
      if (!isNaN(saved) && saved > 0 && (!media.duration || saved < media.duration - 0.5)) {
        try { media.currentTime = saved; } catch {}
      }
      media.play().then(() => {
        media.muted = storedVolume === 0;
        media.volume = storedVolume;
      }).catch(() => {});
      renderPanels();
    };
    if (media.readyState >= 1) resume();
    else media.addEventListener("loadedmetadata", resume, { once: true });
  }

  media.onended = () => { if (tracks.length > 1) loadTrack(currentIndex + 1); };

  clearInterval(media._posInterval);
  media._posInterval = setInterval(savePosition, 3000);
  window.addEventListener("pagehide", savePosition);

  loadTrack(currentIndex);

  wraps.forEach(wrap => {
    if (!wrap.querySelector(".fx-music-panel")) {
      const panel = document.createElement("div");
      panel.className = "fx-music-panel";
      wrap.appendChild(panel);
    }
    const btn = wrap.querySelector("#fxMusicToggle");
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = wrap.classList.toggle("fx-music-open");
        if (open) {
          document.querySelectorAll("#fxMusicWrap.fx-music-open").forEach(w => { if (w !== wrap) w.classList.remove("fx-music-open"); });
        }
      });
    }
  });
  if (!document.body._musicOutsideClickWired) {
    document.body._musicOutsideClickWired = true;
    document.addEventListener("click", (e) => {
      if (e.target.closest("#fxMusicWrap")) return;
      document.querySelectorAll("#fxMusicWrap.fx-music-open").forEach(w => w.classList.remove("fx-music-open"));
    });
  }
  renderPanels();
}
