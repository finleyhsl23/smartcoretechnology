import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { logout } from "./auth.js";

const NAV_LINKS = [
  { id: "dashboard",  icon: "📊", label: "Dashboard",       href: "/systems/crm/dashboard.html" },
  { id: "companies",  icon: "🏢", label: "Companies",       href: "/systems/crm/companies.html" },
  { id: "contacts",   icon: "👥", label: "Contacts",        href: "/systems/crm/contacts.html" },
  { id: "leads",      icon: "🎯", label: "Leads",           href: "/systems/crm/leads.html" },
  { id: "pipeline",   icon: "📋", label: "Pipeline",        href: "/systems/crm/pipeline.html" },
  { id: "tasks",      icon: "✅", label: "Tasks",           href: "/systems/crm/tasks.html" },
  { id: "calendar",   icon: "📅", label: "Calendar",        href: "/systems/crm/calendar.html",   tier: "professional" },
  { id: "quotes",     icon: "💰", label: "Quotes",          href: "/systems/crm/quotes.html",     tier: "professional" },
  { id: "documents",  icon: "📁", label: "Documents",       href: "/systems/crm/documents.html",  tier: "professional" },
  { id: "reports",    icon: "📈", label: "Reports",         href: "/systems/crm/reports.html",    tier: "professional" },
  { id: "portal",     icon: "🌐", label: "Customer Portal", href: "/systems/crm/portal.html",     tier: "business" },
  { id: "messaging",  icon: "💬", label: "Messaging",       href: "/systems/crm/messaging.html",  tier: "business" },
  { id: "projects",   icon: "📋", label: "Projects",        href: "/systems/crm/projects.html",   tier: "business" },
  { id: "reminders",  icon: "🔔", label: "Reminders",       href: "/systems/crm/reminders.html",  system: true },
  { id: "commands",   icon: "⚡", label: "Commands",        href: "/systems/crm/commands.html",   system: true },
  { id: "settings",   icon: "⚙️",  label: "Settings",       href: "/systems/crm/settings.html",   system: true },
];

const TIER_ORDER = { lite: 0, professional: 1, business: 2, enterprise: 3 };
function tierAllows(userTier, requiredTier) {
  if (!requiredTier) return true;
  return (TIER_ORDER[userTier] || 0) >= (TIER_ORDER[requiredTier] || 0);
}

export function renderNav(currentPage, profile, tier) {
  const nav = document.getElementById("crmNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const role = profile?.role || "employee";

  nav.innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-dot">SC</div>
      <div class="logo-text">
        <strong>SmartCore</strong>
        <span>CRM</span>
      </div>
    </div>
    <div class="sidebar-nav">
      <div class="sidebar-section">
        <div class="sidebar-section-label">Main</div>
      </div>
      ${NAV_LINKS.filter(l => !l.tier && !l.system).map(l => navItem(l, currentPage, tier)).join("")}
      <div class="sidebar-section" style="margin-top:8px">
        <div class="sidebar-section-label">Features</div>
      </div>
      ${NAV_LINKS.filter(l => l.tier && l.id !== "settings").map(l => navItem(l, currentPage, tier)).join("")}
      <div class="sidebar-section" style="margin-top:8px">
        <div class="sidebar-section-label">System</div>
      </div>
      ${NAV_LINKS.filter(l => l.system).map(l => navItem(l, currentPage, tier)).join("")}
    </div>
    <div class="sidebar-footer">
      <div class="sidebar-user" onclick="window.location.href='/systems/core'">
        <div class="avatar avatar-sm">${esc(initials(userName))}</div>
        <div class="user-info">
          <div class="user-name">${esc(userName)}</div>
          <div class="user-role">${esc(role)}</div>
        </div>
        <div class="user-chevron">↗</div>
      </div>
    </div>`;
}

function navItem(link, currentPage, tier) {
  if (!link) return "";
  const locked = !tierAllows(tier, link.tier);
  const active = link.id === currentPage;
  const cls = ["nav-link", active ? "active" : "", locked ? "nav-locked" : ""].filter(Boolean).join(" ");

  if (locked) {
    return `<div class="${cls}" title="Requires ${link.tier} plan" style="opacity:.45;cursor:not-allowed">
      <span class="nav-icon">${link.icon}</span>
      <span>${link.label}</span>
      <span class="nav-badge warn">↑</span>
    </div>`;
  }

  return `<a href="${link.href}" class="${cls}">
    <span class="nav-icon">${link.icon}</span>
    <span>${link.label}</span>
  </a>`;
}

export function initMobileNav() {
  const hamburger = document.getElementById("hamburger");
  const sidebar   = document.getElementById("crmNav");
  const overlay   = document.getElementById("sidebarOverlay");
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

export function initTopbar(profile) {
  document.getElementById("themeToggle")?.addEventListener("click", toggleTheme);

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => {
    if (confirm("Sign out of SmartCore CRM?")) logout();
  });
}
