// UI helpers for the Smartfits Vehicle Installations Database

// Staged photos (add-a-vehicle / suggest-a-change flows) sit in memory as
// File objects until the parent row exists and they can actually be
// uploaded — which on a long multi-photo form can be minutes later, and on
// mobile Safari often involves backgrounding the tab to use the Camera app
// between shots. Safari can silently invalidate a File's underlying handle
// after that, so reading its bytes into a plain in-memory Blob the moment
// it's picked (rather than only when finally uploaded) avoids uploads
// failing with a generic "Load failed" once the user gets to Save/Submit.
export async function freezeFile(file) {
  const buf = await file.arrayBuffer();
  return new File([buf], file.name, { type: file.type });
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
