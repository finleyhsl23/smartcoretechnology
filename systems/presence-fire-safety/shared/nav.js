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
  // Leaving Check is deliberately NOT in the sidebar — it's reached via the
  // "Open Leaving Check" prompt after a kiosk sign-out (employee-signin.html),
  // not something to browse to normally. Page itself is untouched, still
  // reachable directly and still permission-gated.
  { id: "timesheets",     icon: "clock",            label: "Timesheets",      href: "/systems/presence-fire-safety/timesheets.html", permission: "presence.view_timesheets" },
  { id: "reports",        icon: "bar-chart-3",      label: "Reports",         href: "/systems/presence-fire-safety/reports.html", permission: "presence.export_reports" },
  { id: "id-cards",       icon: "badge-check",      label: "ID Cards",        href: "/systems/presence-fire-safety/id-cards.html", permission: "presence.manage_badges" },
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

  // Back-to-modules link, top-left of the topbar — same placement/label as
  // every other SmartCore module. Hidden in kiosk mode (see
  // body.pfs-kiosk-mode-active .topbar-back-btn in the shared stylesheet).
  const topbar = document.querySelector(".pfs-topbar");
  if (topbar && !topbar.querySelector(".topbar-back-btn")) {
    const backBtn = document.createElement("a");
    backBtn.href = "/modules/";
    backBtn.className = "topbar-back-btn";
    backBtn.innerHTML = `← Modules`;
    const hamburger = topbar.querySelector(".hamburger");
    if (hamburger) hamburger.after(backBtn);
    else topbar.prepend(backBtn);
  }

  initTopbarMoreControls(topbar);
}

/**
 * Mobile/tablet only (checked once, at load — this app isn't used with a
 * dynamically resized window, so a one-time check is enough). Relocates
 * whichever of refresh/site-switcher/theme-toggle exist on this page out
 * of the cramped topbar row and into a single collapsed "more controls"
 * button + dropdown panel — moving the real elements, not cloning them,
 * so every existing click handler and the site-switcher's own wiring
 * keep working with zero changes. Desktop never runs this at all, so the
 * existing desktop topbar is completely untouched.
 */
function initTopbarMoreControls(topbar) {
  if (!topbar || !window.matchMedia("(max-width: 900px)").matches) return;

  const refreshBtn = document.getElementById("refreshBtn");
  const siteWrap = topbar.querySelector(".pfs-site-search-wrap");
  const themeBtn = document.getElementById("themeToggle");
  const movable = [
    refreshBtn && { el: refreshBtn, label: "Refresh" },
    siteWrap && { el: siteWrap, label: "Site" },
    themeBtn && { el: themeBtn, label: "Theme" },
  ].filter(Boolean);
  if (!movable.length) return;

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "icon-btn topbar-more-btn";
  moreBtn.setAttribute("aria-label", "More controls");
  moreBtn.setAttribute("aria-expanded", "false");
  moreBtn.innerHTML = `<i data-lucide="sliders-horizontal"></i>`;

  const panel = document.createElement("div");
  panel.className = "topbar-more-panel";

  movable.forEach(({ el, label }) => {
    // Icon-only buttons (refresh/theme) get a text label appended so the
    // panel reads as a menu, not a row of unlabelled icons — hidden by
    // default, shown only inside .topbar-more-panel (see stylesheet).
    if (el.tagName === "BUTTON") {
      if (!el.querySelector(".topbar-more-row-text")) {
        const span = document.createElement("span");
        span.className = "topbar-more-row-text";
        span.textContent = label;
        el.appendChild(span);
      }
      el.classList.add("topbar-more-row");
    } else {
      // Not a button (the site-switcher wrap) — precede it with a plain
      // label instead of appending text inside it.
      const labelEl = document.createElement("span");
      labelEl.className = "topbar-more-label";
      labelEl.textContent = label;
      panel.appendChild(labelEl);
    }
    panel.appendChild(el);
  });

  topbar.appendChild(panel);
  const anchor = topbar.querySelector(".topbar-back-btn") || topbar.querySelector(".hamburger");
  (anchor || topbar.firstElementChild)?.after(moreBtn);

  // Hiding the title on mobile (see stylesheet) removed the flex:1 spacer
  // that used to push trailing controls to the right edge, so without
  // this, more-controls + logout end up stranded on the left next to the
  // back button instead. Pull them to the far right explicitly, and make
  // sure logout sits directly after more-controls regardless of where it
  // originally was in the markup.
  moreBtn.classList.add("topbar-push-right");
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) moreBtn.after(logoutBtn);

  window.lucide?.createIcons?.();

  const closePanel = () => { panel.classList.remove("open"); moreBtn.setAttribute("aria-expanded", "false"); };
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = panel.classList.toggle("open");
    moreBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (panel.classList.contains("open") && !panel.contains(e.target) && e.target !== moreBtn) closePanel();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });
}

/**
 * Turns `inputEl` into a searchable site combobox — type to filter by name
 * OR location (city/postcode/address), matches appear as you type. Expects
 * `inputEl` to be wrapped in an element carrying `.pfs-site-search-wrap`
 * (for dropdown positioning) with a sibling `.pfs-site-search-dropdown`
 * container immediately after it in the markup.
 */
export function renderSiteSwitcher(inputEl, sitesList, selectedId, onChange) {
  if (!inputEl) return;
  const wrap = inputEl.closest(".pfs-site-search-wrap") || inputEl.parentElement;
  let dropdown = wrap.querySelector(".pfs-site-search-dropdown");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.className = "pfs-site-search-dropdown";
    wrap.appendChild(dropdown);
  }

  const locationOf = (s) => [s.city, s.postcode, s.address_line_1].filter(Boolean).join(", ");
  const setInputToSelected = () => {
    const site = sitesList.find(s => s.id === selectedId);
    inputEl.value = site ? site.name : "";
  };
  setInputToSelected();

  function closeDropdown() { dropdown.innerHTML = ""; dropdown.style.display = "none"; }

  function openDropdown(query) {
    const q = query.trim().toLowerCase();
    const matches = q
      ? sitesList.filter(s => s.name.toLowerCase().includes(q) || locationOf(s).toLowerCase().includes(q))
      : sitesList;
    if (!matches.length) {
      dropdown.innerHTML = `<div class="pfs-site-search-option text-muted">No sites match "${esc(query)}"</div>`;
      dropdown.style.display = "block";
      return;
    }
    dropdown.innerHTML = matches.map(s => `
      <div class="pfs-site-search-option" data-id="${esc(s.id)}" role="option">
        <strong>${esc(s.name)}</strong>
        ${locationOf(s) ? `<small>${esc(locationOf(s))}</small>` : ""}
      </div>`).join("");
    dropdown.style.display = "block";
    dropdown.querySelectorAll(".pfs-site-search-option[data-id]").forEach(opt => {
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const site = sitesList.find(s => s.id === opt.dataset.id);
        if (site) {
          selectedId = site.id;
          inputEl.value = site.name;
          closeDropdown();
          onChange(site.id);
        }
      });
    });
  }

  inputEl.addEventListener("focus", () => { inputEl.select(); openDropdown(""); });
  inputEl.addEventListener("input", () => openDropdown(inputEl.value));
  inputEl.addEventListener("blur", () => {
    // Delay so a mousedown on an option can register before we discard it.
    setTimeout(() => { closeDropdown(); if (!dropdown.contains(document.activeElement)) setInputToSelected(); }, 150);
  });
  inputEl.addEventListener("keydown", (e) => {
    const opts = [...dropdown.querySelectorAll(".pfs-site-search-option[data-id]")];
    if (!opts.length) return;
    const active = dropdown.querySelector(".pfs-site-search-option.active");
    let idx = opts.indexOf(active);
    if (e.key === "ArrowDown") { e.preventDefault(); idx = Math.min(idx + 1, opts.length - 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); idx = Math.max(idx - 1, 0); }
    else if (e.key === "Enter") { e.preventDefault(); (active || opts[0])?.dispatchEvent(new MouseEvent("mousedown")); return; }
    else if (e.key === "Escape") { closeDropdown(); setInputToSelected(); return; }
    else return;
    opts.forEach(o => o.classList.remove("active"));
    opts[idx]?.classList.add("active");
    opts[idx]?.scrollIntoView({ block: "nearest" });
  });
}

// ── Navigation loading feedback ──────────────────────────────────────────
// This is a classic multi-page app, not an SPA — every internal link is a
// full browser navigation. On a slow connection the OLD page stays fully
// interactive for however long the new page takes to start loading, with
// nothing on screen to show a tap actually registered — which is exactly
// what leads to someone tapping the same link over and over. Shows a
// full-screen overlay the instant a qualifying link is tapped, and blocks
// any further taps until the browser actually navigates away (which tears
// this whole page — overlay included — down naturally).
//
// Runs as soon as this module is first imported, which every page already
// does for renderNav/initTopbar/etc., so every page gets this for free
// with no per-page wiring.
let _pfsNavigating = false;

function showNavLoadingOverlay() {
  let overlay = document.getElementById("pfsNavLoading");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "pfsNavLoading";
    overlay.className = "pfs-nav-loading-overlay";
    overlay.innerHTML = `<div class="pfs-nav-loading-box"><div class="pfs-nav-loading-spinner"></div><span>Loading…</span></div>`;
    document.body.appendChild(overlay);
  }
  // Two rAFs so the browser actually paints the overlay before whatever
  // else runs on this tick — a single requestAnimationFrame can still get
  // batched into the current, about-to-be-superseded frame on some engines.
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add("visible")));
}

function qualifyingNavLink(target) {
  const a = target.closest?.("a[href]");
  if (!a) return null;
  if (a.target === "_blank" || a.hasAttribute("download")) return null;
  const href = a.getAttribute("href") || "";
  if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  let url;
  try { url = new URL(href, location.href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null; // already here
  return a;
}

document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!qualifyingNavLink(e.target)) return;
  if (_pfsNavigating) { e.preventDefault(); return; } // a tap is already in flight — ignore repeats
  _pfsNavigating = true;
  showNavLoadingOverlay();
});

// Restoring this exact page from the back/forward cache shouldn't leave a
// stale "Loading…" overlay stuck on screen.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    _pfsNavigating = false;
    document.getElementById("pfsNavLoading")?.classList.remove("visible");
  }
});
