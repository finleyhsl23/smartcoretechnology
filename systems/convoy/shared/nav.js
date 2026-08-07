import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { sb } from "./supabase.js";
import { hasPermission } from "./auth.js";

const NAV_LINKS = [
  { id: "dashboard",  icon: "layout-dashboard", label: "Dashboard",  href: "/systems/convoy/index.html" },
  { id: "vehicles",   icon: "truck",            label: "Vehicles",   href: "/systems/convoy/vehicles.html", permission: "convoy.view_vehicles" },
  { id: "check",      icon: "camera",           label: "Do a Check", href: "/systems/convoy/check.html", permission: "convoy.perform_checks" },
  { id: "checks",     icon: "clipboard-check",  label: "Check History", href: "/systems/convoy/checks.html", permission: "convoy.view_vehicles" },
  { id: "defects",    icon: "alert-triangle",   label: "Defects",    href: "/systems/convoy/defects.html", permission: "convoy.view_vehicles" },
  { id: "drivers",    icon: "id-card",          label: "Drivers",    href: "/systems/convoy/drivers.html", permission: "convoy.manage_drivers" },
  { id: "checklists", icon: "list-checks",      label: "Checklists", href: "/systems/convoy/checklist-templates.html", permission: "convoy.manage_checklists" },
  { id: "settings",   icon: "settings",         label: "Settings",   href: "/systems/convoy/settings.html", permission: "convoy.manage_settings" },
];

const ADMIN_ROLES = ["owner", "admin", "administrator"];

export function renderNav(currentPage, profile, { admin = false } = {}) {
  const nav = document.getElementById("slNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const role = profile?.role || "employee";
  const isAdminUser = admin || ADMIN_ROLES.includes(role);

  const links = NAV_LINKS.filter(l => !l.permission || isAdminUser || hasPermission(l.permission));

  nav.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-dot">CV</div>
      <div class="logo-text">
        <strong>Convoy</strong>
        <span>by SmartCore</span>
      </div>
    </div>
    <div class="sidebar-nav">
      ${links.map(l => navItem(l, currentPage)).join("")}
    </div>
    <div class="sidebar-footer">
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
  const sidebar = document.getElementById("slNav");
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
