// UI helpers for the Smartfits Vehicle Installations Database

// Phone cameras routinely shoot 8-15MB, 4000px+ photos — comfortably over
// what the storage bucket accepts, and the "file too large" upload
// failures this caused were exactly that. A wiring/component-location
// photo doesn't need more than ~2000px on its longest edge to zoom in on
// clearly, so every photo gets downscaled to that (and re-encoded as a
// reasonably-compressed JPEG) before it's staged or uploaded — this alone
// gets the overwhelming majority of phone photos down to 1-3MB. Anything
// already small (already-compact image, or a non-JPEG-friendly type like
// GIF) is left alone rather than needlessly re-encoded.
const MAX_IMAGE_DIMENSION = 2000;
const IMAGE_QUALITY = 0.82;
const SKIP_COMPRESSION_UNDER_BYTES = 3 * 1024 * 1024;

export async function compressImage(file) {
  if (!file.type?.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < SKIP_COMPRESSION_UNDER_BYTES) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // compression failing shouldn't block the upload — fall back to the original
  }
}

// Staged photos (add-a-vehicle / suggest-a-change flows) sit in memory as
// File objects until the parent row exists and they can actually be
// uploaded — which on a long multi-photo form can be minutes later, and on
// mobile Safari often involves backgrounding the tab to use the Camera app
// between shots. Safari can silently invalidate a File's underlying handle
// after that, so reading its bytes into a plain in-memory Blob the moment
// it's picked (rather than only when finally uploaded) avoids uploads
// failing with a generic "Load failed" once the user gets to Save/Submit.
// Also runs the file through compressImage() first, so every photo that
// ever gets staged is already a reasonably-sized JPEG by the time it's
// frozen — this is the one place both add-mode and edit-mode's staging
// paths funnel through.
export async function freezeFile(file) {
  const compressed = await compressImage(file);
  const buf = await compressed.arrayBuffer();
  return new File([buf], compressed.name, { type: compressed.type });
}

export function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export function toast(type, title, msg = "") {
  let wrap = document.getElementById("toastwrap");
  if (!wrap) { wrap = document.createElement("div"); wrap.id = "toastwrap"; document.body.appendChild(wrap); }
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<div class="toast-dot ${esc(type)}"></div><div><b>${esc(title)}</b>${msg ? `<p>${esc(msg)}</p>` : ""}</div>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

export function confirmDialog(title, msg, onConfirm, { danger = true, confirmLabel = "Confirm" } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px" role="alertdialog" aria-modal="true" aria-labelledby="confTitle">
      <div class="modal-header"><h3 id="confTitle">${esc(title)}</h3></div>
      <div class="modal-body"><p class="text-muted">${esc(msg)}</p></div>
      <div class="modal-footer">
        <button class="btn" id="confCancel">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confOk">${esc(confirmLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#confCancel").focus();
  overlay.querySelector("#confCancel").onclick = () => overlay.remove();
  overlay.querySelector("#confOk").onclick = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener("keydown", e => { if (e.key === "Escape") overlay.remove(); });
  return overlay;
}

export function modal(html, { size = "" } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay || e.target.closest(".modal-close")) overlay.remove(); });
  overlay.addEventListener("keydown", e => { if (e.key === "Escape") overlay.remove(); });
  return overlay;
}

export function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(d) {
  if (!d) return "—";
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return fmtDate(d);
}

export function initials(name) {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export function loadingState(label = "Loading…") {
  return `<div class="vdb-state" role="status"><div class="vdb-spinner" aria-hidden="true"></div><p>${esc(label)}</p></div>`;
}

export function emptyState({ icon = "inbox", title = "Nothing here yet", message = "", actionHtml = "" } = {}) {
  return `
    <div class="vdb-state">
      <i data-lucide="${esc(icon)}" class="vdb-state-icon" aria-hidden="true"></i>
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${actionHtml}
    </div>`;
}

export function errorState({ title = "Something went wrong", message = "", retryId = "" } = {}) {
  return `
    <div class="vdb-state vdb-state-error" role="alert">
      <i data-lucide="alert-triangle" class="vdb-state-icon" aria-hidden="true"></i>
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${retryId ? `<button class="btn btn-primary" id="${esc(retryId)}">Try again</button>` : ""}
    </div>`;
}

export function permissionDeniedState(message = "You don't have permission to view this page.") {
  return `
    <div class="vdb-state vdb-state-error">
      <i data-lucide="lock" class="vdb-state-icon" aria-hidden="true"></i>
      <h3>Access Restricted</h3>
      <p>${esc(message)}</p>
    </div>`;
}

export function moduleDisabledState() {
  return `
    <div class="vdb-state vdb-state-error">
      <i data-lucide="lock" class="vdb-state-icon" aria-hidden="true"></i>
      <h3>Module Not Enabled</h3>
      <p>This module has not been enabled for your company.</p>
    </div>`;
}

export function setInner(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
  window.lucide?.createIcons?.();
}

export function refreshIcons() {
  window.lucide?.createIcons?.();
}

/**
 * Renders a searchable "type to add" multi-select into `container` — chips
 * for each selected item, a text input, and a filtered suggestion dropdown.
 * `options` is the full candidate list; each item needs an `id` and a label
 * field (default `full_name`, override via `labelKey`/`subLabelKey`).
 */
export function initTagInput(container, { options, selected = [], labelKey = "full_name", subLabelKey = "job_title", placeholder = "Search to add…", onChange }) {
  let selectedIds = [...selected];

  container.innerHTML = `
    <div class="tag-chips" data-role="chips"></div>
    <div class="tag-input" data-role="wrap">
      <input type="text" class="form-input" data-role="search" placeholder="${esc(placeholder)}" autocomplete="off"/>
      <div class="tag-suggestions" data-role="suggestions"></div>
    </div>
  `;

  const chipsEl = container.querySelector('[data-role="chips"]');
  const wrapEl = container.querySelector('[data-role="wrap"]');
  const inputEl = container.querySelector('[data-role="search"]');
  const suggEl = container.querySelector('[data-role="suggestions"]');

  function drawChips() {
    if (!selectedIds.length) {
      chipsEl.innerHTML = `<span class="tag-empty-hint">No one added yet</span>`;
      return;
    }
    chipsEl.innerHTML = selectedIds.map(id => {
      const opt = options.find(o => o.id === id);
      return `<span class="tag-chip" data-id="${esc(id)}">${esc(opt?.[labelKey] || "Unknown")}<button type="button" data-role="remove"><i data-lucide="x"></i></button></span>`;
    }).join("");
    chipsEl.querySelectorAll('[data-role="remove"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-id]").dataset.id;
        selectedIds = selectedIds.filter(x => x !== id);
        drawChips();
        onChange?.(selectedIds);
        window.lucide?.createIcons?.();
      });
    });
    window.lucide?.createIcons?.();
  }

  function closeSuggestions() {
    wrapEl.classList.remove("open");
    suggEl.innerHTML = "";
  }

  function openSuggestions(query) {
    const q = query.trim().toLowerCase();
    const matches = options.filter(o =>
      !selectedIds.includes(o.id)
      && (!q || (o[labelKey] || "").toLowerCase().includes(q) || (o[subLabelKey] || "").toLowerCase().includes(q))
    ).slice(0, 20);

    if (!matches.length) {
      suggEl.innerHTML = `<div class="tag-suggestion-empty">No matches</div>`;
    } else {
      suggEl.innerHTML = matches.map(o => `
        <div class="tag-suggestion-option" data-id="${esc(o.id)}">
          <strong>${esc(o[labelKey])}</strong>
          ${o[subLabelKey] ? `<small>${esc(o[subLabelKey])}</small>` : ""}
        </div>`).join("");
      suggEl.querySelectorAll("[data-id]").forEach(opt => {
        opt.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectedIds.push(opt.dataset.id);
          inputEl.value = "";
          drawChips();
          closeSuggestions();
          onChange?.(selectedIds);
        });
      });
    }
    wrapEl.classList.add("open");
  }

  inputEl.addEventListener("focus", () => openSuggestions(inputEl.value));
  inputEl.addEventListener("input", () => openSuggestions(inputEl.value));
  inputEl.addEventListener("blur", () => setTimeout(closeSuggestions, 150));
  inputEl.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSuggestions(); });

  drawChips();

  return { getSelected: () => selectedIds };
}

/**
 * A single-select dropdown styled to match the app (glass trigger button +
 * floating options panel) instead of a native <select>, which renders
 * inconsistently across browsers and can't pick up the app's own colours/
 * blur. `options` is [{ key, label, icon? }] — icon is an optional Lucide
 * name shown in a small round badge next to the label.
 */
export function initCustomSelect(container, { options, value = "", placeholder = "Select…", onChange }) {
  let selected = value;
  let panelEl = null; // only exists in the DOM while open

  container.classList.add("cbdd");
  container.innerHTML = `
    <button type="button" class="cbdd-trigger" data-role="trigger">
      <span data-role="triggerLabel"></span>
      <i data-lucide="chevron-down"></i>
    </button>
  `;

  const triggerBtn = container.querySelector('[data-role="trigger"]');
  const triggerLabel = container.querySelector('[data-role="triggerLabel"]');

  function drawTrigger() {
    const opt = options.find(o => o.key === selected);
    triggerLabel.innerHTML = opt
      ? `${opt.icon ? `<i data-lucide="${esc(opt.icon)}" style="width:14px;height:14px;margin-right:7px;vertical-align:-3px"></i>` : ""}${esc(opt.label)}`
      : `<span class="cbdd-placeholder">${esc(placeholder)}</span>`;
    window.lucide?.createIcons?.();
  }

  // The panel is appended straight to <body> and positioned with `fixed`
  // coordinates read off the trigger's own bounding box, rather than
  // living inside `container` as an absolutely-positioned child. A field
  // like this one often sits inside a modal, and modals clip their own
  // content with overflow-y so *they* can scroll — any ordinary absolute-
  // positioned dropdown gets silently cut off at that boundary no matter
  // how high its z-index is. Escaping to <body> sidesteps that entirely.
  function positionPanel() {
    if (!panelEl) return;
    const rect = triggerBtn.getBoundingClientRect();
    panelEl.style.left = `${rect.left}px`;
    panelEl.style.top = `${rect.bottom + 8}px`;
    panelEl.style.width = `${rect.width}px`;
  }

  function open() {
    if (panelEl) return;
    container.classList.add("open");
    panelEl = document.createElement("div");
    panelEl.className = "cbdd-panel";
    panelEl.setAttribute("role", "listbox");
    panelEl.innerHTML = options.map(o => `
      <div class="cbdd-option ${o.key === selected ? "selected" : ""}" data-key="${esc(o.key)}" role="option" aria-selected="${o.key === selected}">
        ${o.icon ? `<span class="cbdd-option-icon"><i data-lucide="${esc(o.icon)}"></i></span>` : ""}
        <span>${esc(o.label)}</span>
      </div>`).join("");
    document.body.appendChild(panelEl);
    positionPanel();
    window.lucide?.createIcons?.();

    panelEl.querySelectorAll("[data-key]").forEach(row => {
      row.addEventListener("click", () => {
        selected = row.dataset.key;
        drawTrigger();
        close();
        onChange?.(selected);
      });
    });

    window.addEventListener("scroll", positionPanel, true);
    window.addEventListener("resize", positionPanel);
  }

  function close() {
    container.classList.remove("open");
    panelEl?.remove();
    panelEl = null;
    window.removeEventListener("scroll", positionPanel, true);
    window.removeEventListener("resize", positionPanel);
  }

  triggerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panelEl ? close() : open();
  });
  container.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // A document-level listener closes the panel on an outside click. It's
  // added once per instance rather than torn down explicitly (this
  // component has no close/destroy lifecycle hook) — self-removes the
  // first time it fires after its container has left the DOM (e.g. the
  // modal it lived in was closed), so it can't accumulate indefinitely
  // across repeated opens.
  document.addEventListener("click", function onDocClick(e) {
    if (!document.body.contains(container)) { document.removeEventListener("click", onDocClick); close(); return; }
    if (panelEl && !container.contains(e.target) && !panelEl.contains(e.target)) close();
  });

  drawTrigger();

  return {
    getValue: () => selected,
    setValue: (v) => { selected = v; drawTrigger(); },
  };
}
