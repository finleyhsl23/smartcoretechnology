import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { sb } from "./supabase.js";

const BASE = "/custom/smartfitsinstallationsltd/vehicle-database";

function navLinksFor(tier) {
  const isManagerOrAbove = tier === "owner_admin" || tier === "manager";
  const links = [
    { id: "home", icon: "search", label: "Search Vehicles", href: `${BASE}/index.html` },
    { id: "leaderboard", icon: "trophy", label: "Top Contributors", href: `${BASE}/leaderboard.html` },
  ];
  if (tier === "employee") {
    links.push({ id: "my-requests", icon: "send", label: "My Suggested Changes", href: `${BASE}/my-requests.html` });
  }
  // Manager/Admin-only pages — normal employees don't get these at all,
  // not even greyed out, rather than showing them something they can never
  // use.
  if (isManagerOrAbove) {
    links.push({ id: "edit-requests", icon: "list-checks", label: "Review Change Requests", href: `${BASE}/edit-requests.html` });
    links.push({ id: "settings", icon: "settings", label: "Settings", href: `${BASE}/settings.html`, disabled: tier !== "owner_admin" });
  }
  return links;
}

export function renderNav(currentPage, profile, tier) {
  const nav = document.getElementById("vdbNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const roleLabel = tier === "owner_admin" ? (profile.role === "owner" ? "Owner" : "Admin")
    : tier === "manager" ? "Senior Regional Engineering Manager" : "Employee";

  const links = navLinksFor(tier);

  nav.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-dot"><span class="logo-mark"></span></div>
      <div class="logo-text">
        <strong>SmartCore</strong>
        <span>Vehicle Installations DB</span>
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
  return `<a href="${link.href}" class="${classes}" ${link.disabled ? 'title="Managers/Admins only" tabindex="-1"' : ""}>
    <i data-lucide="${link.icon}" class="nav-icon"></i>
    <span>${link.label}</span>
  </a>`;
}

export function initMobileNav() {
  const hamburger = document.getElementById("hamburger");
  const sidebar = document.getElementById("vdbNav");
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
  const topbar = document.querySelector(".vdb-topbar");
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
