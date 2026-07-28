import { tierHasFeature, hasPermission, isAdmin, logout } from "./auth.js";
import { initials } from "./ui.js";

const NAV_ITEMS = [
  { key: "dashboard", href: "dashboard.html", icon: "▦", label: "Dashboard", feature: "dashboard" },
  { key: "clients", href: "clients.html", icon: "◍", label: "Clients", feature: "clients", perm: "flexi.view_clients" },
  { key: "programs", href: "programs.html", icon: "▤", label: "Programs", feature: "programs", perm: "flexi.manage_programs" },
  { key: "exercises", href: "exercises.html", icon: "◒", label: "Exercise Library", feature: "exercises", perm: "flexi.manage_exercises" },
  { key: "calendar", href: "calendar.html", icon: "▥", label: "Calendar", feature: "bookings", perm: "flexi.manage_bookings" },
  { key: "classes", href: "classes.html", icon: "◫", label: "Classes", feature: "classes", perm: "flexi.manage_classes" },
  { key: "messages", href: "messages.html", icon: "◔", label: "Messages", feature: "messages", perm: "flexi.send_messages" },
  { key: "nutrition", href: "nutrition.html", icon: "◕", label: "Nutrition", feature: "nutrition", perm: "flexi.manage_nutrition" },
  { key: "checkins", href: "checkins.html", icon: "☑", label: "Check-Ins", feature: "checkins", perm: "flexi.manage_checkins" },
  { key: "packages", href: "packages.html", icon: "◈", label: "Packages & Payments", feature: "packages", perm: "flexi.manage_packages" },
  { key: "waivers", href: "waivers.html", icon: "▧", label: "Waivers", feature: "waivers", perm: "flexi.manage_waivers" },
  { key: "community", href: "community.html", icon: "◎", label: "Community", feature: "community", perm: "flexi.manage_community" },
  { key: "reports", href: "reports.html", icon: "▲", label: "Reports", feature: "reports", perm: "flexi.export_reports" },
  { key: "audit", href: "audit-log.html", icon: "▨", label: "Audit Log", feature: "audit_log", perm: "flexi.view_audit_log" },
  { key: "team", href: "team.html", icon: "◐", label: "Team", feature: "team", perm: "flexi.manage_team" },
  { key: "locations", href: "locations.html", icon: "◇", label: "Locations", feature: "locations", perm: "flexi.manage_locations" },
  { key: "settings", href: "settings.html", icon: "⚙", label: "Settings", feature: "settings", perm: "flexi.manage_settings" },
];

export function renderNav({ activeKey, profile, tier }) {
  const container = document.getElementById("fxSidebar");
  if (!container) return;

  const items = NAV_ITEMS.filter(item => {
    if (item.feature && !tierHasFeature(tier, item.feature)) return false;
    if (item.perm && !hasPermission(item.perm)) return false;
    return true;
  });

  container.innerHTML = `
    <div class="fx-side-brand">
      <div class="fx-side-logo">F</div>
      <span>Flexi</span>
    </div>
    <nav class="fx-side-nav">
      ${items.map(item => `
        <a href="${item.href}" class="fx-side-link ${item.key === activeKey ? "active" : ""}">
          <span class="fx-side-icon">${item.icon}</span>${item.label}
        </a>
      `).join("")}
    </nav>
    <div class="fx-side-foot">
      <div class="fx-side-tier">${tier.charAt(0).toUpperCase() + tier.slice(1)} plan</div>
      <div class="fx-side-user">
        <div class="fx-avatar">${initials(profile.full_name)}</div>
        <div class="fx-side-user-info">
          <div class="fx-side-user-name">${profile.full_name || profile.email}</div>
          <div class="fx-side-user-role">${isAdmin(profile) ? "Admin" : "Trainer"}</div>
        </div>
        <button class="fx-icon-btn" id="themeToggle" title="Toggle theme">🌙</button>
      </div>
      <div class="fx-side-actions">
        <a href="/modules/" class="fx-side-back">← Modules</a>
        <button id="logoutBtn" class="fx-side-logout">Sign out</button>
      </div>
    </div>
  `;
}

export function wireMobileNavToggle() {
  const toggle = document.getElementById("fxNavToggle");
  const sidebar = document.getElementById("fxSidebar");
  if (!toggle || !sidebar) return;
  toggle.addEventListener("click", () => sidebar.classList.toggle("fx-side-open"));
  sidebar.addEventListener("click", (e) => {
    if (e.target.closest("a.fx-side-link")) sidebar.classList.remove("fx-side-open");
  });
}
