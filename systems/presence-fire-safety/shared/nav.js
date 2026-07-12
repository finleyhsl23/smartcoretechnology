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

/** Populates a <select> with the company's sites and wires change -> reload. */
export async function renderSiteSwitcher(selectEl, sitesList, selectedId, onChange) {
  if (!selectEl) return;
  selectEl.innerHTML = sitesList.map(s => `<option value="${s.id}" ${s.id === selectedId ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  selectEl.addEventListener("change", () => onChange(selectEl.value));
}
