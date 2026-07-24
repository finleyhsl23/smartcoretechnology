import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { sb } from "./supabase.js";
import { hasPermission } from "./auth.js";

const NAV_LINKS = [
  { id: "dashboard",   icon: "layout-dashboard", label: "Dashboard",   href: "/systems/sitelens/index.html" },
  { id: "projects",    icon: "folder-kanban",    label: "Projects",    href: "/systems/sitelens/projects.html", permission: "sitelens.view_projects" },
  { id: "capture",     icon: "camera",           label: "Capture",     href: "/systems/sitelens/capture.html", permission: "sitelens.capture_media" },
  { id: "tasks",       icon: "check-square",     label: "Tasks",       href: "/systems/sitelens/tasks.html", permission: "sitelens.view_projects" },
  { id: "checklists",  icon: "list-checks",      label: "Checklists",  href: "/systems/sitelens/checklists.html", permission: "sitelens.manage_checklists" },
  { id: "team",        icon: "users",            label: "Team",        href: "/systems/sitelens/team.html", permission: "sitelens.manage_team" },
  { id: "settings",    icon: "settings",         label: "Settings",    href: "/systems/sitelens/settings.html", permission: "sitelens.manage_settings" },
];

export function renderNav(currentPage, profile) {
  const nav = document.getElementById("slNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const role = profile?.role || "employee";

  const links = NAV_LINKS.filter(l => !l.permission || hasPermission(l.permission));

  nav.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-dot">SL</div>
      <div class="logo-text">
        <strong>SiteLens</strong>
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
