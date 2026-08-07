// UI helpers for SmartCore Convoy

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

export function daysUntil(d) {
  if (!d) return null;
  const ms = new Date(d + "T00:00:00") - new Date(new Date().toDateString());
  return Math.round(ms / 86400000);
}

export function initials(name) {
  if (!name) return "?";
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

export function mapsUrl(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
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

// ── Integrity / severity badges ─────────────────────────────────────────────

const FLAG_LABELS = {
  too_fast: "Completed unusually fast",
  low_accuracy_start: "Low GPS accuracy (start)",
  low_accuracy_end: "Low GPS accuracy (finish)",
  location_unavailable: "Location unavailable",
  off_site: "Away from vehicle depot",
  photo_locations_inconsistent: "Photo locations don't match",
};

export function flagLabel(flag) {
  return FLAG_LABELS[flag] || flag;
}

export function integrityBadges(flags) {
  if (!flags || !flags.length) {
    return `<span class="badge badge-green"><i data-lucide="shield-check"></i> Verified</span>`;
  }
  return flags.map(f => `<span class="badge badge-yellow" title="${esc(flagLabel(f))}"><i data-lucide="alert-triangle"></i> ${esc(flagLabel(f))}</span>`).join(" ");
}

export function severityBadge(sev) {
  const map = { minor: "badge-yellow", major: "badge-red", off_road: "badge-red" };
  const labels = { minor: "Minor", major: "Major", off_road: "Off Road" };
  return `<span class="badge ${map[sev] || "badge-grey"}">${esc(labels[sev] || sev)}</span>`;
}

export function statusBadge(status) {
  const map = { open: "badge-red", in_progress: "badge-yellow", resolved: "badge-green", active: "badge-green", vor: "badge-red", retired: "badge-grey" };
  const labels = { open: "Open", in_progress: "In Progress", resolved: "Resolved", active: "Active", vor: "VOR", retired: "Retired" };
  return `<span class="badge ${map[status] || "badge-grey"}">${esc(labels[status] || status)}</span>`;
}
