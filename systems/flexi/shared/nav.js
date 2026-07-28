import { tierHasFeature, hasPermission, isAdmin, logout } from "./auth.js";
import { initials } from "./ui.js";

const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  dashboard: `<svg ${ICON_ATTRS}><rect x="3" y="3" width="7" height="10" rx="1.6"/><rect x="14" y="3" width="7" height="6" rx="1.6"/><rect x="14" y="12.5" width="7" height="8.5" rx="1.6"/><rect x="3" y="16.5" width="7" height="4.5" rx="1.6"/></svg>`,
  clients: `<svg ${ICON_ATTRS}><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c0-3.5 2.8-6.3 6.2-6.3s6.2 2.8 6.2 6.3"/><circle cx="17.5" cy="8.5" r="2.5"/><path d="M15.6 13.9c2.5.5 4.4 2.7 4.4 5.4"/></svg>`,
  programs: `<svg ${ICON_ATTRS}><rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M9 3.5v1.6a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3.5"/><line x1="8" y1="11.5" x2="16" y2="11.5"/><line x1="8" y1="15" x2="13.5" y2="15"/></svg>`,
  exercises: `<svg ${ICON_ATTRS}><rect x="2.5" y="9.5" width="3" height="5" rx="1"/><rect x="18.5" y="9.5" width="3" height="5" rx="1"/><line x1="5.5" y1="12" x2="18.5" y2="12"/><line x1="8" y1="8" x2="8" y2="16"/><line x1="16" y1="8" x2="16" y2="16"/></svg>`,
  calendar: `<svg ${ICON_ATTRS}><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="3" x2="8" y2="6.5"/><line x1="16" y1="3" x2="16" y2="6.5"/></svg>`,
  classes: `<svg ${ICON_ATTRS}><circle cx="8.5" cy="8.5" r="3"/><circle cx="16" cy="9" r="2.6"/><path d="M2.8 20.2c0-3.3 2.6-5.9 5.7-5.9s5.7 2.6 5.7 5.9"/><path d="M14.6 15c2.4.4 4.2 2.5 4.2 5"/></svg>`,
  messages: `<svg ${ICON_ATTRS}><path d="M4.5 5.5h15a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9.8l-4.3 3.6V17H4.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"/></svg>`,
  nutrition: `<svg ${ICON_ATTRS}><path d="M12 3c1.2 2 1.2 4-.3 5.6"/><path d="M12 8.4c4 0 7 3 7 7a5.6 5.6 0 0 1-11.2 0M5 15.4A5.6 5.6 0 0 1 12 8.4"/></svg>`,
  checkins: `<svg ${ICON_ATTRS}><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12.3l2.6 2.6L16.5 9"/></svg>`,
  packages: `<svg ${ICON_ATTRS}><path d="M21 7.5 12 3 3 7.5v9L12 21l9-4.5v-9Z"/><path d="M3 7.5 12 12l9-4.5"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`,
  waivers: `<svg ${ICON_ATTRS}><path d="M6.5 3h8l4 4v13a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14.5 3v4h4"/><line x1="8.5" y1="13" x2="15.5" y2="13"/><line x1="8.5" y1="16.7" x2="13" y2="16.7"/></svg>`,
  community: `<svg ${ICON_ATTRS}><path d="M7 4h10v3.5a5 5 0 0 1-10 0V4Z"/><path d="M7 5.5H4.7A2.3 2.3 0 0 0 7 9"/><path d="M17 5.5h2.3A2.3 2.3 0 0 1 17 9"/><path d="M12 12.5v3.3"/><path d="M9 20h6l-.9-3.7a.5.5 0 0 0-.5-.5h-3.2a.5.5 0 0 0-.5.5L9 20Z"/></svg>`,
  reports: `<svg ${ICON_ATTRS}><line x1="4.5" y1="20.5" x2="4.5" y2="11"/><line x1="12" y1="20.5" x2="12" y2="4"/><line x1="19.5" y1="20.5" x2="19.5" y2="14.5"/><line x1="2.5" y1="20.5" x2="21.5" y2="20.5"/></svg>`,
  audit: `<svg ${ICON_ATTRS}><path d="M12 3.5 19 6.5v5.4c0 5-3 8.4-7 9.6-4-1.2-7-4.6-7-9.6V6.5L12 3.5Z"/><path d="M9 12.2l2.1 2.1L15.4 10"/></svg>`,
  team: `<svg ${ICON_ATTRS}><circle cx="9.5" cy="8" r="3.4"/><path d="M3.2 20c0-3.5 2.8-6.3 6.3-6.3s6.3 2.8 6.3 6.3"/><line x1="18.5" y1="7" x2="18.5" y2="13"/><line x1="15.5" y1="10" x2="21.5" y2="10"/></svg>`,
  locations: `<svg ${ICON_ATTRS}><path d="M12 21s7-5.9 7-11.4a7 7 0 1 0-14 0C5 15.1 12 21 12 21Z"/><circle cx="12" cy="9.7" r="2.5"/></svg>`,
  settings: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z"/></svg>`,
  modules: `<svg ${ICON_ATTRS}><path d="M4 12 12 5l8 7-8 7-8-7Z"/></svg>`,
};

const NAV_ITEMS = [
  { key: "dashboard", href: "dashboard.html", icon: "dashboard", label: "Dashboard", feature: "dashboard" },
  { key: "clients", href: "clients.html", icon: "clients", label: "Clients", feature: "clients", perm: "flexi.view_clients" },
  { key: "programs", href: "programs.html", icon: "programs", label: "Programs", feature: "programs", perm: "flexi.manage_programs" },
  { key: "exercises", href: "exercises.html", icon: "exercises", label: "Exercise Library", feature: "exercises", perm: "flexi.manage_exercises" },
  { key: "calendar", href: "calendar.html", icon: "calendar", label: "Calendar", feature: "bookings", perm: "flexi.manage_bookings" },
  { key: "classes", href: "classes.html", icon: "classes", label: "Classes", feature: "classes", perm: "flexi.manage_classes" },
  { key: "messages", href: "messages.html", icon: "messages", label: "Messages", feature: "messages", perm: "flexi.send_messages" },
  { key: "nutrition", href: "nutrition.html", icon: "nutrition", label: "Nutrition", feature: "nutrition", perm: "flexi.manage_nutrition" },
  { key: "checkins", href: "checkins.html", icon: "checkins", label: "Check-Ins", feature: "checkins", perm: "flexi.manage_checkins" },
  { key: "packages", href: "packages.html", icon: "packages", label: "Packages & Payments", feature: "packages", perm: "flexi.manage_packages" },
  { key: "waivers", href: "waivers.html", icon: "waivers", label: "Waivers", feature: "waivers", perm: "flexi.manage_waivers" },
  { key: "community", href: "community.html", icon: "community", label: "Community", feature: "community", perm: "flexi.manage_community" },
  { key: "reports", href: "reports.html", icon: "reports", label: "Reports", feature: "reports", perm: "flexi.export_reports" },
  { key: "audit", href: "audit-log.html", icon: "audit", label: "Audit Log", feature: "audit_log", perm: "flexi.view_audit_log" },
  { key: "team", href: "team.html", icon: "team", label: "Team", feature: "team", perm: "flexi.manage_team" },
  { key: "locations", href: "locations.html", icon: "locations", label: "Locations", feature: "locations", perm: "flexi.manage_locations" },
  { key: "settings", href: "settings.html", icon: "settings", label: "Settings", feature: "settings", perm: "flexi.manage_settings" },
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
          <span class="fx-side-icon">${ICONS[item.icon] || ""}</span>${item.label}
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
        <a href="/modules/" class="fx-side-back">${ICONS.modules} Modules</a>
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
