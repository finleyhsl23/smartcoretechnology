import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { sb } from "./supabase.js";
import { hasPermission } from "./auth.js";

const NAV_LINKS = [
  { id: "dashboard",      icon: "layout-dashboard", label: "Dashboard",       href: "/systems/presence-fire-safety/index.html" },
  { id: "employee-signin",icon: "id-card",          label: "Employee Sign In/Out", href: "/systems/presence-fire-safety/employee-signin.html", permission: "presence.sign_self_in_out" },
  { id: "visitors",       icon: "user-round",       label: "Visitors",        href: "/systems/presence-fire-safety/visitors.html", permission: "presence.manage_visitors" },
  { id: "contractors",    icon: "hard-hat",         label: "Contractors",     href: "/systems/presence-fire-safety/contractors.html", permission: "presence.manage_contractors" },
  { id: "live-register",  icon: "users",            label: "Live Register",   href: "/systems/presence-fire-safety/live-register.html", permission: "presence.view_live_register" },
  { id: "evacuation",     icon: "flame",            label: "Evacuation",      href: "/systems/presence-fire-safety/evacuation.html", permission: "evacuation.unlock" },
  { id: "reports",        icon: "bar-chart-3",      label: "Reports",         href: "/systems/presence-fire-safety/reports.html", permission: "presence.export_reports" },
  { id: "settings",       icon: "settings",         label: "Settings",        href: "/systems/presence-fire-safety/settings.html", permission: "presence.manage_settings" },
];

export function renderNav(currentPage, profile) {
  const nav = document.getElementById("pfsNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const role = profile?.role || "employee";

  const links = NAV_LINKS.filter(l => !l.permission || hasPermission(l.permission));

  nav.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-dot">SC</div>
      <div class="logo-text">
        <strong>SmartCore</strong>
        <span>Presence &amp; Fire Safety</span>
      </div>
    </div>
    <div class="sidebar-nav">
      ${links.map(l => navItem(l, currentPage)).join("")}
    </div>
    <div class="sidebar-footer">
      <a href="/systems/presence-fire-safety/evacuation.html" class="pfs-emergency-btn">
        <i data-lucide="flame"></i><span>Emergency Evacuation</span>
      </a>
      <div class="sidebar-user">
        <div class="avatar avatar-sm">${esc(initials(userName))}</div>
        <div class="user-info">
          <div class="user-name">${esc(userName)}</div>
          <div class="user-role">${esc(role)}</div>
        </div>
      </div>
    </div>`;

  window.lucide?.createIcons?.();
}

function navItem(link, currentPage) {
  const active = link.id === currentPage;
  return `<a href="${link.href}" class="nav-link ${active ? "active" : ""}">
    <i data-lucide="${link.icon}" class="nav-icon"></i>
    <span>${link.label}</span>
  </a>`;
}

export function initMobileNav() {
  const hamburger = document.getElementById("hamburger");
  const sidebar = document.getElementById("pfsNav");
  const overlay = document.getElementById("sidebarOverlay");
  if (!hamburger || !sidebar || !overlay) return;

  hamburger.addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("open");
  });
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("open");
    overlay.classList.remove("open");
  });
}

export function initTopbar() {
  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    if (confirm("Sign out of SmartCore?")) {
      await sb().auth.signOut();
      window.location.href = "/modules/";
    }
  });
}

/**
 * Turns `inputEl` into a searchable site combobox — type to filter by name
 * OR location (city/postcode/address), matches appear as you type. Expects
 * `inputEl` to be wrapped in an element carrying `.pfs-site-search-wrap`
 * (for dropdown positioning) with a sibling `.pfs-site-search-dropdown`
 * container immediately after it in the markup.
 */
export function renderSiteSwitcher(inputEl, sitesList, selectedId, onChange) {
  if (!inputEl) return;
  const wrap = inputEl.closest(".pfs-site-search-wrap") || inputEl.parentElement;
  let dropdown = wrap.querySelector(".pfs-site-search-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.className = "pfs-site-search-dropdown";
    wrap.appendChild(dropdown);
  }

  const locationOf = (s) => [s.city, s.postcode, s.address_line_1].filter(Boolean).join(", ");
  const setInputToSelected = () => {
    const site = sitesList.find(s => s.id === selectedId);
    inputEl.value = site ? site.name : "";
  };
  setInputToSelected();

  function closeDropdown() { dropdown.innerHTML = ""; dropdown.style.display = "none"; }

  function openDropdown(query) {
    const q = query.trim().toLowerCase();
    const matches = q
      ? sitesList.filter(s => s.name.toLowerCase().includes(q) || locationOf(s).toLowerCase().includes(q))
      : sitesList;
    if (!matches.length) {
      dropdown.innerHTML = `<div class="pfs-site-search-option text-muted">No sites match "${esc(query)}"</div>`;
      dropdown.style.display = "block";
      return;
    }
    dropdown.innerHTML = matches.map(s => `
      <div class="pfs-site-search-option" data-id="${esc(s.id)}" role="option">
        <strong>${esc(s.name)}</strong>
        ${locationOf(s) ? `<small>${esc(locationOf(s))}</small>` : ""}
      </div>`).join("");
    dropdown.style.display = "block";
    dropdown.querySelectorAll(".pfs-site-search-option[data-id]").forEach(opt => {
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const site = sitesList.find(s => s.id === opt.dataset.id);
        if (site) {
          selectedId = site.id;
          inputEl.value = site.name;
          closeDropdown();
          onChange(site.id);
        }
      });
    });
  }

  inputEl.addEventListener("focus", () => { inputEl.select(); openDropdown(""); });
  inputEl.addEventListener("input", () => openDropdown(inputEl.value));
  inputEl.addEventListener("blur", () => {
    // Delay so a mousedown on an option can register before we discard it.
    setTimeout(() => { closeDropdown(); if (!dropdown.contains(document.activeElement)) setInputToSelected(); }, 150);
  });
  inputEl.addEventListener("keydown", (e) => {
    const opts = [...dropdown.querySelectorAll(".pfs-site-search-option[data-id]")];
    if (!opts.length) return;
    const active = dropdown.querySelector(".pfs-site-search-option.active");
    let idx = opts.indexOf(active);
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, opts.length - 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    else if (e.key === "Enter") { e.preventDefault(); (active || opts[0])?.dispatchEvent(new MouseEvent("mousedown")); return; }
    else if (e.key === "Escape") { closeDropdown(); setInputToSelected(); return; }
    else return;
    opts.forEach(o => o.classList.remove("active"));
    opts[idx]?.classList.add("active");
    opts[idx]?.scrollIntoView({ block: "nearest" });
  });
}
