import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { sb } from "./supabase.js";
import { hasPermission } from "./auth.js";

const NAV_LINKS = [
  { id: "dashboard",   icon: "layout-dashboard", label: "Dashboard",   href: "/systems/sitesnap/index.html" },
  { id: "projects",    icon: "folder-kanban",    label: "Projects",    href: "/systems/sitesnap/projects.html", permission: "sitesnap.view_projects" },
  { id: "capture",     icon: "camera",           label: "Capture",     href: "/systems/sitesnap/capture.html", permission: "sitesnap.capture_media" },
  { id: "tasks",       icon: "check-square",     label: "Tasks",       href: "/systems/sitesnap/tasks.html", permission: "sitesnap.view_projects" },
  { id: "checklists",  icon: "list-checks",      label: "Checklists",  href: "/systems/sitesnap/checklists.html", permission: "sitesnap.manage_checklists" },
  { id: "floor-plans", icon: "layout",           label: "Floor Plans", href: "/systems/sitesnap/floor-plans.html", adminOnly: true },
  { id: "hours",       icon: "clock",            label: "Hours",       href: "/systems/sitesnap/hours.html", adminOnly: true },
  { id: "map",         icon: "map",              label: "Live Map",    href: "/systems/sitesnap/map.html", adminOnly: true },
  { id: "settings",    icon: "settings",         label: "Settings",    href: "/systems/sitesnap/settings.html", permission: "sitesnap.manage_settings" },
];

const ADMIN_ROLES = ["owner", "admin", "administrator"];

// Locked non-admin users (clocked into one project) only ever land on
// project-detail.html and capture.html — everywhere else redirects them
// there — so their nav is reduced to just those two, since Dashboard/
// Projects/Tasks/etc. would just immediately bounce them straight back.
function lockedNavLinks(shift) {
  return [
    { id: "projects",    icon: "folder-kanban", label: "My Project",  href: `/systems/sitesnap/project-detail.html?id=${encodeURIComponent(shift.project_id)}` },
    { id: "capture",     icon: "camera",        label: "Capture",     href: "/systems/sitesnap/capture.html" },
    { id: "floor-plans", icon: "layout",        label: "Floor Plan",  href: `/systems/sitesnap/floor-plans.html?project=${encodeURIComponent(shift.project_id)}` },
    { id: "my-hours",    icon: "clock",         label: "My Hours",    href: "/systems/sitesnap/my-hours.html" },
  ];
}

export function renderNav(currentPage, profile, { admin = false, shift = null } = {}) {
  const nav = document.getElementById("slNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const role = profile?.role || "employee";
  const isAdminUser = admin || ADMIN_ROLES.includes(role);

  const links = (!isAdminUser && shift)
    ? lockedNavLinks(shift)
    : NAV_LINKS.filter(l => (l.adminOnly ? isAdminUser : (!l.permission || hasPermission(l.permission))));

  nav.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-dot">SS</div>
      <div class="logo-text">
        <strong>SiteSnap</strong>
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
