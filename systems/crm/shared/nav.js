import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { logout, tierHasFeature, getCRMSettings } from "./auth.js";
import { sb } from "./supabase.js";

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
  { id: "tickets",      icon: "🎫", label: "Tickets",          href: "/systems/crm/tickets.html",      tier: "professional" },
  { id: "newsletter",  icon: "📧", label: "Newsletter",      href: "/systems/crm/newsletter.html",   tier: "professional" },
  { id: "portal",      icon: "🌐", label: "Customer Portal", href: "/systems/crm/portal.html",       tier: "business" },
  { id: "messaging",  icon: "💬", label: "Messaging",       href: "/systems/crm/messaging.html",  tier: "business" },
  { id: "projects",     icon: "📋", label: "Projects",      href: "/systems/crm/projects.html",     tier: "business" },
  { id: "leaderboard", icon: "🏆", label: "Leaderboard",   href: "/systems/crm/leaderboard.html",  tier: "professional", featureFlag: "leaderboard" },
  { id: "reminders",  icon: "🔔", label: "Reminders",       href: "/systems/crm/reminders.html",  system: true },
  { id: "commands",   icon: "⚡", label: "Commands",        href: "/systems/crm/commands.html",   system: true },
  { id: "settings",   icon: "⚙️",  label: "Settings",       href: "/systems/crm/settings.html",   system: true },
];

const TIER_ORDER = { lite: 0, professional: 1, business: 2, enterprise: 3 };
let _badgeInterval = null;
function tierAllows(userTier, requiredTier) {
  if (!requiredTier) return true;
  return (TIER_ORDER[userTier] || 0) >= (TIER_ORDER[requiredTier] || 0);
}

export function renderNav(currentPage, profile, tier, crmSettings) {
  const nav = document.getElementById("crmNav");
  if (!nav) return;

  const userName = profile?.full_name || profile?.email || "User";
  const role = profile?.role || "employee";

  function linkVisible(l) {
    if (l.featureFlag === "leaderboard" && crmSettings?.leaderboard_enabled === false) return false;
    return true;
  }

  // When crmSettings not provided, fetch it and patch nav if leaderboard needs hiding
  if (crmSettings === undefined && tierHasFeature(tier, "leaderboard")) {
    getCRMSettings().then(s => {
      if (s?.leaderboard_enabled === false) {
        nav.querySelectorAll('a[href*="leaderboard"]').forEach(el => el.remove());
      }
    }).catch(() => {});
  }

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
      ${NAV_LINKS.filter(l => !l.tier && !l.system && linkVisible(l)).map(l => navItem(l, currentPage, tier)).join("")}
      <div class="sidebar-section" style="margin-top:8px">
        <div class="sidebar-section-label">Features</div>
      </div>
      ${NAV_LINKS.filter(l => l.tier && l.id !== "settings" && linkVisible(l)).map(l => navItem(l, currentPage, tier)).join("")}
      <div class="sidebar-section" style="margin-top:8px">
        <div class="sidebar-section-label">System</div>
      </div>
      ${NAV_LINKS.filter(l => l.system).map(l => navItem(l, currentPage, tier)).join("")}
    </div>
    <div class="sidebar-footer">
      <button id="supportBtn" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;background:rgba(91,143,255,.08);border:1px solid rgba(91,143,255,.2);border-radius:10px;cursor:pointer;color:var(--text-dim);font-size:13px;font-weight:600;margin-bottom:8px;transition:background .15s">
        <span style="font-size:16px">🎧</span>
        <span>Support</span>
      </button>
      <div class="sidebar-user" onclick="window.location.href='/systems/core'">
        <div class="avatar avatar-sm">${esc(initials(userName))}</div>
        <div class="user-info">
          <div class="user-name">${esc(userName)}</div>
          <div class="user-role">${esc(role)}</div>
        </div>
        <div class="user-chevron">↗</div>
      </div>
    </div>`;

  document.getElementById("supportBtn")?.addEventListener("click", () => openSupport(tier));

  // Start unread badge polling
  if (profile?.company_id) {
    if (_badgeInterval) clearInterval(_badgeInterval);
    const pollBadges = async () => {
      try {
        const [msgRes, ticketRes] = await Promise.all([
          sb().from("crm_messages").select("id", { count: "exact", head: true })
            .eq("tenant_id", profile.company_id).eq("sender_type","customer").is("read_at", null),
          sb().from("crm_tickets").select("id", { count: "exact", head: true })
            .eq("tenant_id", profile.company_id).eq("status","open"),
        ]);
        setNavBadge('a[href*="messaging.html"]', msgRes.count || 0);
        setNavBadge('a[href*="tickets.html"]', ticketRes.count || 0);
      } catch {}
    };
    pollBadges();
    _badgeInterval = setInterval(pollBadges, 5000);
  }
}

function setNavBadge(selector, count) {
  const link = document.querySelector(selector);
  if (!link) return;
  let badge = link.querySelector(".nav-count-badge");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-count-badge";
      badge.style.cssText = "margin-left:auto;background:#ef4444;color:#fff;font-size:10px;font-weight:700;min-width:18px;height:18px;padding:0 5px;border-radius:99px;display:flex;align-items:center;justify-content:center;flex-shrink:0";
      link.appendChild(badge);
    }
    badge.textContent = count > 9 ? "9+" : String(count);
  } else {
    badge?.remove();
  }
}

function navItem(link, currentPage, tier) {
  if (!link) return "";
  const locked = !tierAllows(tier, link.tier);
  const active = link.id === currentPage;
  const cls = ["nav-link", active ? "active" : "", locked ? "nav-locked" : ""].filter(Boolean).join(" ");

  if (locked) {
    const tierLabel = link.tier ? link.tier.charAt(0).toUpperCase() + link.tier.slice(1) : "";
    return `<div class="${cls}" title="Requires ${tierLabel} plan or above" style="opacity:.4;cursor:not-allowed;pointer-events:none">
      <span class="nav-icon">${link.icon}</span>
      <span style="flex:1">${link.label}</span>
      <span style="font-size:9px;font-weight:700;letter-spacing:.04em;background:rgba(255,180,0,.15);color:#f59e0b;border:1px solid rgba(255,180,0,.25);border-radius:4px;padding:1px 5px;white-space:nowrap">${tierLabel}+</span>
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
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    if (confirm("Sign out of SmartCore CRM?")) {
      await sb().auth.signOut();
      window.location.href = "https://www.smartcoretechnology.co.uk";
    }
  });

  // Inject back button into the topbar
  const topbar = document.querySelector(".crm-topbar");
  if (topbar) {
    const backBtn = document.createElement("a");
    backBtn.href = "https://www.smartcoretechnology.co.uk/modules";
    backBtn.className = "topbar-back-btn";
    backBtn.innerHTML = `← Modules`;

    const hamburger = topbar.querySelector(".hamburger");
    if (hamburger) hamburger.after(backBtn);
    else topbar.prepend(backBtn);
  }

  initGlobalSearch();
}

export function initGlobalSearch() {
  const input = document.getElementById("globalSearch");
  if (!input) return;

  // Create dropdown
  const drop = document.createElement("div");
  drop.id = "globalSearchDrop";
  drop.style.cssText = "display:none;position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--card,#111);border:1px solid var(--line,rgba(255,255,255,.12));border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.6);z-index:9000;max-height:420px;overflow-y:auto;min-width:340px";
  const wrap = input.closest(".topbar-search");
  if (wrap) { wrap.style.position = "relative"; wrap.appendChild(drop); }
  else { document.body.appendChild(drop); }

  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { drop.style.display = "none"; return; }
    timer = setTimeout(() => runSearch(q, drop), 300);
  });

  input.addEventListener("keydown", e => { if (e.key === "Escape") { drop.style.display = "none"; input.value = ""; } });

  document.addEventListener("click", e => {
    if (!wrap?.contains(e.target) && !drop.contains(e.target)) drop.style.display = "none";
  });
}

async function runSearch(q, drop) {
  drop.style.display = "block";
  drop.innerHTML = `<div style="padding:14px 16px;color:var(--text-dim,#7070a0);font-size:13px">Searching…</div>`;

  try {
    const client = sb();
    const ql = `%${q}%`;
    const [companies, contacts, leadsRes, tasks] = await Promise.all([
      client.from("crm_companies").select("id,name,status").ilike("name", ql).limit(4),
      client.from("crm_contacts").select("id,first_name,last_name,email").or(`first_name.ilike.${ql},last_name.ilike.${ql},email.ilike.${ql}`).limit(4),
      client.from("crm_leads").select("id,title,status").ilike("title", ql).limit(4),
      client.from("crm_tasks").select("id,title,status").ilike("title", ql).limit(4),
    ]);

    const sections = [
      { label: "Companies", icon: "🏢", items: companies.data || [], href: r => `/systems/crm/company-detail.html?id=${r.id}`, name: r => r.name, sub: r => r.status },
      { label: "Contacts",  icon: "👥", items: contacts.data  || [], href: r => `/systems/crm/contacts.html?search=${encodeURIComponent(r.first_name+" "+r.last_name)}`, name: r => r.first_name+" "+r.last_name, sub: r => r.email },
      { label: "Leads",     icon: "🎯", items: leadsRes.data  || [], href: r => `/systems/crm/leads.html?search=${encodeURIComponent(r.title)}`, name: r => r.title, sub: r => r.status },
      { label: "Tasks",     icon: "✅", items: tasks.data     || [], href: r => `/systems/crm/tasks.html?search=${encodeURIComponent(r.title)}`, name: r => r.title, sub: r => r.status },
    ].filter(s => s.items.length > 0);

    if (!sections.length) {
      drop.innerHTML = `<div style="padding:20px 16px;text-align:center;color:var(--text-dim,#7070a0);font-size:13px">No results for "${esc(q)}"</div>`;
      return;
    }

    drop.innerHTML = sections.map(s => `
      <div style="padding:10px 14px 4px;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--text-dim,#7070a0);text-transform:uppercase">${s.icon} ${esc(s.label)}</div>
      ${s.items.map(r => `
        <a href="${esc(s.href(r))}" style="display:flex;align-items:center;gap:10px;padding:9px 14px;text-decoration:none;transition:background .12s;border-radius:8px;margin:0 4px" class="gsearch-item">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text,#f5f5f7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name(r))}</div>
            ${s.sub(r) ? `<div style="font-size:11px;color:var(--text-dim,#7070a0)">${esc(s.sub(r))}</div>` : ""}
          </div>
          <span style="font-size:11px;color:var(--text-dim,#7070a0)">→</span>
        </a>`).join("")}
    `).join("<div style='height:1px;background:var(--line,rgba(255,255,255,.08));margin:4px 14px'></div>");

    // Hover styles
    drop.querySelectorAll(".gsearch-item").forEach(a => {
      a.addEventListener("mouseenter", () => a.style.background = "var(--sb-hover)");
      a.addEventListener("mouseleave", () => a.style.background = "");
    });
  } catch(e) {
    drop.innerHTML = `<div style="padding:14px 16px;color:var(--bad,#ef4444);font-size:13px">Search error: ${esc(e.message)}</div>`;
  }
}

// ── Support modal ────────────────────────────────────────────────────────────

let supportMessages = []; // [{role, content}]

export function initSupport(tier) {
  const btn = document.getElementById("supportBtn");
  if (!btn) return;
  btn.addEventListener("click", () => openSupport(tier));
}

function openSupport(tier) {
  if (document.getElementById("supportModal")) return;

  const modal = document.createElement("div");
  modal.id = "supportModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:flex-start;padding:16px";

  modal.innerHTML = `
    <div id="supportPanel" style="background:var(--card,#111);border:1px solid var(--line,rgba(255,255,255,.1));border-radius:18px;width:360px;max-height:560px;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,.6);overflow:hidden">
      <!-- Header -->
      <div style="display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid var(--line,rgba(255,255,255,.08))">
        <span style="font-size:20px">🎧</span>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px;color:var(--text,#f5f5f7)">SmartCore Support</div>
          <div style="font-size:11px;color:var(--text-dim,#7070a0)">How can we help?</div>
        </div>
        <button id="supportClose" style="background:none;border:none;font-size:18px;color:var(--text-dim,#7070a0);cursor:pointer;line-height:1">✕</button>
      </div>

      <!-- Mode picker -->
      <div id="supportPicker" style="padding:20px;display:flex;flex-direction:column;gap:12px">
        ${tierHasFeature(tier || "lite", "ai_support") ? `
        <button id="supportAiBtn" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(91,143,255,.1);border:1px solid rgba(91,143,255,.25);border-radius:12px;cursor:pointer;text-align:left;width:100%">
          <span style="font-size:24px">🤖</span>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text,#f5f5f7)">Chat with AI Support</div>
            <div style="font-size:12px;color:var(--text-dim,#7070a0);margin-top:2px">Instant answers about SmartCore CRM</div>
          </div>
        </button>` : `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--card2);border:1px solid var(--line);border-radius:12px;opacity:.5;cursor:not-allowed">
          <span style="font-size:24px">🤖</span>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text,#f5f5f7)">Chat with AI Support</div>
            <div style="font-size:12px;color:var(--text-dim,#7070a0);margin-top:2px">Enterprise plan required ↑</div>
          </div>
        </div>`}
        <button id="supportEmailBtn" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--card2);border:1px solid var(--line);border-radius:12px;cursor:pointer;text-align:left;width:100%">
          <span style="font-size:24px">✉️</span>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text,#f5f5f7)">Email the team</div>
            <div style="font-size:12px;color:var(--text-dim,#7070a0);margin-top:2px">support@smartcoretechnology.co.uk</div>
          </div>
        </button>
      </div>

      <!-- Chat view (hidden initially) -->
      <div id="supportChat" style="display:none;flex-direction:column;flex:1;min-height:0">
        <div id="supportMessages" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-height:200px;max-height:340px"></div>
        <div style="padding:10px 12px;border-top:1px solid var(--line,rgba(255,255,255,.08));display:flex;gap:8px">
          <input id="supportInput" placeholder="Ask a question…" style="flex:1;background:var(--bg);border:1px solid var(--line2);border-radius:10px;padding:9px 12px;font-size:13px;color:var(--text);outline:none"/>
          <button id="supportSend" style="background:#1e5cff;border:none;border-radius:10px;padding:9px 14px;color:#fff;font-size:13px;font-weight:700;cursor:pointer">↑</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  document.getElementById("supportClose").onclick = () => { modal.remove(); supportMessages = []; };
  modal.addEventListener("click", e => { if (e.target === modal) { modal.remove(); supportMessages = []; } });

  document.getElementById("supportEmailBtn").onclick = () => {
    window.location.href = "mailto:support@smartcoretechnology.co.uk?subject=SmartCore CRM Support";
  };

  document.getElementById("supportAiBtn")?.addEventListener("click", () => {
    // Show loading screen
    const picker = document.getElementById("supportPicker");
    picker.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px;gap:20px">
        <div id="supportOrb" style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#1e5cff,#7b5fff,#1a7aff);position:relative;animation:orbPulse 1.8s ease-in-out infinite">
          <div style="position:absolute;inset:0;border-radius:50%;background:linear-gradient(135deg,#1e5cff,#7b5fff);filter:blur(12px);opacity:.6;animation:orbGlow 1.8s ease-in-out infinite"></div>
          <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px">🤖</span>
        </div>
        <div style="text-align:center">
          <div style="font-weight:700;font-size:14px;color:var(--text,#f5f5f7);margin-bottom:6px">Starting AI Support</div>
          <div id="supportLoadingDots" style="font-size:12px;color:var(--text-dim,#7070a0)">Connecting<span id="loadDot">.</span></div>
        </div>
      </div>
      <style>
        @keyframes orbPulse { 0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(30,92,255,.4)} 50%{transform:scale(1.08);box-shadow:0 0 0 14px rgba(30,92,255,0)} }
        @keyframes orbGlow { 0%,100%{opacity:.4} 50%{opacity:.8} }
      </style>`;

    // Animate the dots
    const dots = ['.','..',  '...'];
    let di = 0;
    const dotInterval = setInterval(() => {
      const el = document.getElementById("loadDot");
      if (el) { di = (di + 1) % dots.length; el.textContent = dots[di]; }
      else clearInterval(dotInterval);
    }, 400);

    // After 1.4s transition to chat
    setTimeout(() => {
      clearInterval(dotInterval);
      picker.style.display = "none";
      const chat = document.getElementById("supportChat");
      chat.style.display = "flex";
      if (supportMessages.length === 0) appendBubble("assistant", "Hi! I'm the SmartCore CRM assistant. Ask me anything about the CRM and I'll help you out.");
      document.getElementById("supportInput").focus();
    }, 1400);
  });

  document.getElementById("supportSend").onclick = sendSupportMessage;
  document.getElementById("supportInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendSupportMessage(); } });
}

async function sendSupportMessage() {
  const input = document.getElementById("supportInput");
  const text = input?.value.trim();
  if (!text) return;
  input.value = "";

  supportMessages.push({ role: "user", content: text });
  appendBubble("user", text);

  const thinking = appendTyping();

  try {
    const { data: { session } } = await sb().auth.getSession();
    const res = await fetch("/api/crm/support-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ messages: supportMessages }),
    });
    const json = await res.json();
    thinking.remove();
    if (json.ok && json.reply) {
      supportMessages.push({ role: "assistant", content: json.reply });
      appendBubble("assistant", json.reply);
    } else {
      appendBubble("assistant", "Sorry, I couldn't get a response. Please try emailing support@smartcoretechnology.co.uk.");
    }
  } catch {
    thinking?.remove();
    appendBubble("assistant", "Sorry, something went wrong. Please try emailing support@smartcoretechnology.co.uk.");
  }
}

function appendTyping() {
  const wrap = document.getElementById("supportMessages");
  if (!wrap) return null;
  const div = document.createElement("div");
  div.style.cssText = "display:flex;justify-content:flex-start";
  div.innerHTML = `
    <div style="padding:10px 14px;border-radius:14px 14px 14px 4px;background:var(--card2)">
      <div style="display:flex;gap:5px;align-items:center;height:16px">
        <span style="width:7px;height:7px;border-radius:50%;background:#5b8fff;display:block;animation:typingBounce 1.2s ease-in-out infinite"></span>
        <span style="width:7px;height:7px;border-radius:50%;background:#5b8fff;display:block;animation:typingBounce 1.2s ease-in-out .2s infinite"></span>
        <span style="width:7px;height:7px;border-radius:50%;background:#5b8fff;display:block;animation:typingBounce 1.2s ease-in-out .4s infinite"></span>
      </div>
    </div>
    <style>@keyframes typingBounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}</style>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function renderMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function appendBubble(role, text, isTemp = false) {
  const wrap = document.getElementById("supportMessages");
  if (!wrap) return null;
  const div = document.createElement("div");
  const isUser = role === "user";
  div.style.cssText = `display:flex;justify-content:${isUser ? "flex-end" : "flex-start"}`;
  div.innerHTML = `<div style="max-width:80%;padding:9px 13px;border-radius:${isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px"};background:${isUser ? "#1e5cff" : "var(--card2)"};color:${isUser ? "#fff" : "var(--text)"};font-size:13px;line-height:1.55">${isUser ? esc(text) : renderMarkdown(text)}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return isTemp ? div : null;
}
