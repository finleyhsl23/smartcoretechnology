// UI helpers for SmartCore CRM

export function toast(type, title, msg = "") {
  let wrap = document.getElementById("toastwrap");
  if (!wrap) { wrap = document.createElement("div"); wrap.id = "toastwrap"; document.body.appendChild(wrap); }
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="toast-dot ${type}"></div><div><b>${esc(title)}</b>${msg ? `<p>${esc(msg)}</p>` : ""}</div>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

export function confirm(title, msg, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header"><h3>${esc(title)}</h3></div>
      <div class="modal-body"><p class="text-muted">${esc(msg)}</p></div>
      <div class="modal-footer">
        <button class="btn" id="confCancel">Cancel</button>
        <button class="btn btn-danger" id="confOk">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#confCancel").onclick = () => overlay.remove();
  overlay.querySelector("#confOk").onclick = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

export function modal(html, { size = "" } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `<div class="modal ${size}">${html}</div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector(".modal-close")?.addEventListener("click", () => overlay.remove());
  return overlay;
}

export function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export function fmt(n) {
  if (n == null || n === "") return "—";
  return "£" + Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (s < 60)  return "just now";
  if (s < 3600) return Math.floor(s/60) + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  if (s < 604800) return Math.floor(s/86400) + "d ago";
  return fmtDate(d);
}

export function initials(name) {
  if (!name) return "?";
  return name.split(" ").slice(0,2).map(w => w[0]).join("").toUpperCase();
}

export function leadBadge(status) {
  const map = {
    new:           ["badge-blue",   "New"],
    contacted:     ["badge-yellow", "Contacted"],
    qualified:     ["badge-purple", "Qualified"],
    proposal_sent: ["badge-blue",   "Proposal Sent"],
    negotiation:   ["badge-pink",   "Negotiation"],
    won:           ["badge-green",  "Won"],
    lost:          ["badge-red",    "Lost"],
  };
  const [cls, label] = map[status] || ["badge-grey", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function companyStatusBadge(status) {
  const map = {
    prospect: ["badge-yellow", "Prospect"],
    active:   ["badge-green",  "Active"],
    inactive: ["badge-grey",   "Inactive"],
    churned:  ["badge-red",    "Churned"],
  };
  const [cls, label] = map[status] || ["badge-grey", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function taskPriorityBadge(priority) {
  const map = {
    low:    ["badge-grey",   "Low"],
    medium: ["badge-blue",   "Medium"],
    high:   ["badge-yellow", "High"],
    urgent: ["badge-red",    "Urgent"],
  };
  const [cls, label] = map[priority] || ["badge-grey", priority];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function taskStatusBadge(status) {
  const map = {
    todo:        ["badge-grey",   "To Do"],
    in_progress: ["badge-blue",   "In Progress"],
    completed:   ["badge-green",  "Completed"],
    overdue:     ["badge-red",    "Overdue"],
  };
  const [cls, label] = map[status] || ["badge-grey", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function quoteBadge(status) {
  const map = {
    draft:    ["badge-grey",   "Draft"],
    sent:     ["badge-blue",   "Sent"],
    accepted: ["badge-green",  "Accepted"],
    rejected: ["badge-red",    "Rejected"],
    expired:  ["badge-yellow", "Expired"],
  };
  const [cls, label] = map[status] || ["badge-grey", status];
  return `<span class="badge ${cls}">${label}</span>`;
}

export function tierGate(feature) {
  return `
    <div class="tier-gate">
      <div class="tier-gate-icon">🔒</div>
      <h2>Upgrade Required</h2>
      <p>This feature requires a higher SmartCore CRM plan. Contact your administrator to upgrade.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:4px">
        <a href="/shop/index.html" class="btn btn-primary upgrade-btn">View Plans →</a>
        <a href="/systems/crm/settings.html#tiers" class="btn upgrade-btn">Compare Tiers</a>
      </div>
    </div>`;
}

export function loading() {
  return `<div class="loading-spinner"><div class="spinner"></div></div>`;
}

export function setInner(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
