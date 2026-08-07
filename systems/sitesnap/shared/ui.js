// UI helpers for SmartCore SiteSnap

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

export function modal(html, { size = "", onClose } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  // Every close path (outside click, Escape, .modal-close, or a caller
  // explicitly calling overlay.close()) funnels through here, so callers
  // with teardown to do (e.g. destroying a map instance) only need to pass
  // onClose once instead of wiring cleanup into every dismissal path.
  overlay.close = () => { onClose?.(); overlay.remove(); };
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.close(); });
  overlay.addEventListener("keydown", e => { if (e.key === "Escape") overlay.close(); });
  overlay.querySelectorAll(".modal-close").forEach(btn => btn.addEventListener("click", () => overlay.close()));
  window.lucide?.createIcons?.();
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

export function fmtTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
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

export function fmtBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function mapsUrl(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function openDirectionsPicker(lat, lng, label) {
  if (lat == null || lng == null) return;
  modal(`
    <div class="modal-header"><h3>Get Directions${label ? ` — ${esc(label)}` : ""}</h3><button class="modal-close" aria-label="Close">&times;</button></div>
    <div class="modal-body sl-directions-options">
      <a class="btn btn-primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener"><i data-lucide="map"></i> Open in Google Maps</a>
      <a class="btn btn-primary" href="https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d" target="_blank" rel="noopener"><i data-lucide="map-pin"></i> Open in Apple Maps</a>
    </div>
  `);
}

// ── Required page states (loading / empty / error / permission-denied /
//    module-disabled / offline) ─────────────────────────────────────────────

export function loadingState(label = "Loading…") {
  return `<div class="sl-state" role="status"><div class="sl-spinner" aria-hidden="true"></div><p>${esc(label)}</p></div>`;
}

export function emptyState({ icon = "inbox", title = "Nothing here yet", message = "", actionHtml = "" } = {}) {
  return `
    <div class="sl-state sl-state-empty">
      <i data-lucide="${esc(icon)}" class="sl-state-icon" aria-hidden="true"></i>
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${actionHtml}
    </div>`;
}

export function errorState({ title = "Something went wrong", message = "", retryId = "" } = {}) {
  return `
    <div class="sl-state sl-state-error" role="alert">
      <i data-lucide="alert-triangle" class="sl-state-icon" aria-hidden="true"></i>
      <h3>${esc(title)}</h3>
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${retryId ? `<button class="btn btn-primary" id="${esc(retryId)}">Try again</button>` : ""}
    </div>`;
}

export function permissionDeniedState(message = "You don't have permission to view this page.") {
  return `
    <div class="sl-state sl-state-error">
      <i data-lucide="lock" class="sl-state-icon" aria-hidden="true"></i>
      <h3>Access Restricted</h3>
      <p>${esc(message)}</p>
    </div>`;
}

export function moduleDisabledState() {
  return `
    <div class="sl-state sl-state-error">
      <i data-lucide="lock" class="sl-state-icon" aria-hidden="true"></i>
      <h3>Module Not Enabled</h3>
      <p>This module has not been enabled for your company.</p>
      <a class="btn btn-primary" href="/shop/index.html">View Plans →</a>
    </div>`;
}

export function offlineBanner() {
  return `<div class="sl-offline-banner" role="status"><i data-lucide="wifi-off"></i> You're offline — data shown may be stale.</div>`;
}

export function staleBadge(lastRefreshed) {
  return `<span class="sl-stale-badge"><i data-lucide="clock"></i> Updated ${esc(timeAgo(lastRefreshed))}</span>`;
}

export function setInner(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
  window.lucide?.createIcons?.();
}

export function refreshIcons() {
  window.lucide?.createIcons?.();
}
