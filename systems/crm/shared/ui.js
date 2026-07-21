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
  overlay.querySelectorAll(".modal-close").forEach(btn => btn.addEventListener("click", () => overlay.remove()));
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

export function leadBadge(status, stages = []) {
  const map = {
    new:           ["badge-blue",   "New"],
    contacted:     ["badge-yellow", "Contacted"],
    qualified:     ["badge-purple", "Qualified"],
    proposal_sent: ["badge-blue",   "Proposal Sent"],
    negotiation:   ["badge-pink",   "Negotiation"],
    won:           ["badge-green",  "Won"],
    lost:          ["badge-red",    "Lost"],
  };
  if (map[status]) {
    const [cls, label] = map[status];
    return `<span class="badge ${cls}">${label}</span>`;
  }
  // Fall back to dynamic pipeline stages
  const stage = stages.find(s => s.key === status);
  const label = stage?.name || status;
  return `<span class="badge badge-grey">${label}</span>`;
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

/**
 * makeCombo — turns an <input> into a searchable combobox.
 *
 * @param {HTMLInputElement} input   - The text input element
 * @param {Array}            items   - Array of { id, label, sublabel? }
 * @param {object}           opts
 *   opts.onSelect(item)  - called when user picks an item
 *   opts.initialId       - pre-select by id on first render
 *   opts.placeholder     - input placeholder
 *
 * Returns { getValue, setValue, setItems }
 */
export function makeCombo(input, items, { onSelect, initialId, placeholder } = {}) {
  if (placeholder) input.placeholder = placeholder;
  input.setAttribute("autocomplete", "off");

  let _items = items || [];
  let _selected = null;
  let _dropdown = null;

  // Pre-select if initialId provided
  if (initialId) {
    const match = _items.find(i => i.id === initialId);
    if (match) { input.value = match.label; _selected = match; }
  }

  function buildDropdown(filter) {
    removeDropdown();
    const q = filter.toLowerCase();
    const visible = q ? _items.filter(i =>
      i.label.toLowerCase().includes(q) || i.sublabel?.toLowerCase().includes(q)
    ) : _items;
    if (!visible.length) return;

    _dropdown = document.createElement("div");
    _dropdown.className = "combo-dropdown";
    Object.assign(_dropdown.style, {
      position: "absolute", zIndex: "9999",
      background: "var(--card)", border: "1px solid var(--line1)",
      borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,.25)",
      maxHeight: "220px", overflowY: "auto", minWidth: input.offsetWidth + "px",
    });

    const rect = input.getBoundingClientRect();
    Object.assign(_dropdown.style, {
      top:  (rect.bottom + window.scrollY + 4) + "px",
      left: (rect.left   + window.scrollX)     + "px",
      width: rect.width + "px",
    });

    visible.slice(0, 40).forEach(item => {
      const row = document.createElement("div");
      row.className = "combo-option";
      Object.assign(row.style, {
        padding: "9px 14px", cursor: "pointer", fontSize: "13px",
        color: "var(--text1)", display: "flex", flexDirection: "column", gap: "1px",
      });
      row.innerHTML = `<span>${esc(item.label)}</span>${item.sublabel ? `<span style="font-size:11px;color:var(--text3)">${esc(item.sublabel)}</span>` : ""}`;
      row.addEventListener("mousedown", e => {
        e.preventDefault();
        input.value = item.label;
        _selected = item;
        removeDropdown();
        onSelect?.(item);
      });
      row.addEventListener("mouseenter", () => row.style.background = "var(--card2)");
      row.addEventListener("mouseleave", () => row.style.background = "");
      _dropdown.appendChild(row);
    });

    document.body.appendChild(_dropdown);
  }

  function removeDropdown() {
    _dropdown?.remove();
    _dropdown = null;
  }

  input.addEventListener("input",  () => buildDropdown(input.value));
  input.addEventListener("focus",  () => buildDropdown(input.value));
  input.addEventListener("blur",   () => setTimeout(removeDropdown, 150));
  input.addEventListener("keydown", e => {
    if (!_dropdown) return;
    const opts = [..._dropdown.querySelectorAll(".combo-option")];
    const active = _dropdown.querySelector(".combo-option.combo-active");
    let idx = opts.indexOf(active);
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, opts.length - 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    else if (e.key === "Enter" && active) { e.preventDefault(); active.dispatchEvent(new MouseEvent("mousedown")); return; }
    else if (e.key === "Escape") { removeDropdown(); return; }
    else return;
    opts.forEach(o => { o.classList.remove("combo-active"); o.style.background = ""; });
    if (opts[idx]) { opts[idx].classList.add("combo-active"); opts[idx].style.background = "var(--card2)"; opts[idx].scrollIntoView({ block: "nearest" }); }
  });

  return {
    getValue()         { return _selected?.id ?? null; },
    getLabel()         { return _selected?.label ?? input.value; },
    setValue(id)       {
      const match = _items.find(i => i.id === id);
      if (match) { input.value = match.label; _selected = match; }
      else { input.value = ""; _selected = null; }
    },
    setItems(newItems) { _items = newItems; },
    clear()            { input.value = ""; _selected = null; },
  };
}

export function setInner(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
