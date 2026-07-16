import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { sb } from "./supabase.js";

const BASE = "/custom/smartfitsinstallationsltd/engineer-audit";

function navLinksFor(tier) {
  if (tier === "engineer") {
    return [
      { id: "my-history", icon: "clipboard-list", label: "My Audit History", href: `${BASE}/index.html` },
    ];
  }
  const links = [
    { id: "home", icon: "layout-dashboard", label: "Audit an Engineer", href: `${BASE}/index.html` },
  ];
  if (tier === "owner_admin") {
    links.push({ id: "managers", icon: "users-round", label: "Manage Assignments", href: `${BASE}/managers.html` });
    links.push({ id: "settings", icon: "settings", label: "Settings", href: `${BASE}/settings.html` });
  }
  return links;
}

export function renderNav(currentPage, profile, tier) {
  const nav = document.getElementById("eiaNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const roleLabel = tier === "owner_admin" ? (profile.role === "owner" ? "Owner" : "Admin")
    : tier === "manager" ? "Engineering Manager" : "Engineer";

  const links = navLinksFor(tier);

  nav.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-dot">SC</div>
      <div class="logo-text">
        <strong>SmartCore</strong>
        <span>Engineer Install Audit</span>
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
          <div class="user-role">${esc(roleLabel)}</div>
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
  const sidebar = document.getElementById("eiaNav");
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
