import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { sb } from "./supabase.js";

const BASE = "/custom/smartfitsinstallationsltd/engineer-audit";

function navLinksFor(tier, settings) {
  if (tier === "engineer") {
    return [
      { id: "my-history", icon: "clipboard-list", label: "My Audit History", href: `${BASE}/index.html` },
    ];
  }
  const isOwnerAdmin = tier === "owner_admin";
  const links = [
    { id: "home", icon: "layout-dashboard", label: "Audit an Engineer", href: `${BASE}/index.html` },
  ];
  if (settings?.leaderboard_enabled !== false) {
    links.push({ id: "leaderboard", icon: "trophy", label: "Leaderboard", href: `${BASE}/leaderboard.html` });
  }
  // Always shown so their existence is visible — greyed out (and inert) for
  // anyone who isn't Owner/Admin rather than hidden entirely.
  links.push({ id: "managers", icon: "users-round", label: "Manage Assignments", href: `${BASE}/managers.html`, disabled: !isOwnerAdmin });
  links.push({ id: "settings", icon: "settings", label: "Settings", href: `${BASE}/settings.html`, disabled: !isOwnerAdmin });
  return links;
}

export function renderNav(currentPage, profile, tier, settings) {
  const nav = document.getElementById("eiaNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const roleLabel = tier === "owner_admin" ? (profile.role === "owner" ? "Owner" : "Admin")
    : tier === "manager" ? "Engineering Manager" : "Engineer";

  const links = navLinksFor(tier, settings);

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
        <a href="/systems/core/" class="sidebar-manage-link" title="Manage your profile in Core"><i data-lucide="arrow-up-right"></i></a>
      </div>
    </div>`;

  window.lucide?.createIcons?.();
}

function navItem(link, currentPage) {
  const active = link.id === currentPage;
  const classes = ["nav-link", active ? "active" : "", link.disabled ? "disabled" : ""].filter(Boolean).join(" ");
  return `<a href="${link.href}" class="${classes}" ${link.disabled ? 'title="Owners/Admins only" tabindex="-1"' : ""}>
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
  const topbar = document.querySelector(".eia-topbar");
  if (topbar && !topbar.querySelector(".back-to-modules")) {
    const link = document.createElement("a");
    link.href = "/modules/";
    link.className = "back-to-modules";
    link.title = "Back to Modules";
    link.innerHTML = `<i data-lucide="arrow-left"></i><span>Modules</span>`;
    topbar.insertBefore(link, topbar.firstChild);
    window.lucide?.createIcons?.();
  }

  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    if (confirm("Sign out of SmartCore?")) {
      await sb().auth.signOut();
      window.location.href = "/modules/";
    }
  });
}
