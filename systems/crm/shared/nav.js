import { initials, esc } from "./ui.js";
import { toggleTheme } from "./theme.js";
import { logout } from "./auth.js";
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

// ── Support modal ────────────────────────────────────────────────────────────

let supportMessages = []; // [{role, content}]

export function initSupport() {
  const btn = document.getElementById("supportBtn");
  if (!btn) return;
  btn.addEventListener("click", openSupport);
}

function openSupport() {
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
        <button id="supportAiBtn" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(91,143,255,.1);border:1px solid rgba(91,143,255,.25);border-radius:12px;cursor:pointer;text-align:left;width:100%">
          <span style="font-size:24px">🤖</span>
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text,#f5f5f7)">Chat with AI Support</div>
            <div style="font-size:12px;color:var(--text-dim,#7070a0);margin-top:2px">Instant answers about SmartCore CRM</div>
          </div>
        </button>
        <button id="supportEmailBtn" style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:12px;cursor:pointer;text-align:left;width:100%">
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
          <input id="supportInput" placeholder="Ask a question…" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--line2,rgba(255,255,255,.1));border-radius:10px;padding:9px 12px;font-size:13px;color:var(--text,#f5f5f7);outline:none"/>
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

  document.getElementById("supportAiBtn").onclick = () => {
    document.getElementById("supportPicker").style.display = "none";
    const chat = document.getElementById("supportChat");
    chat.style.display = "flex";
    if (supportMessages.length === 0) appendBubble("assistant", "Hi! I'm the SmartCore CRM assistant. Ask me anything about how to use the CRM and I'll do my best to help.");
    document.getElementById("supportInput").focus();
  };

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

  const thinking = appendBubble("assistant", "…", true);

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

function appendBubble(role, text, isTemp = false) {
  const wrap = document.getElementById("supportMessages");
  if (!wrap) return null;
  const div = document.createElement("div");
  const isUser = role === "user";
  div.style.cssText = `display:flex;justify-content:${isUser ? "flex-end" : "flex-start"}`;
  div.innerHTML = `<div style="max-width:80%;padding:9px 13px;border-radius:${isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px"};background:${isUser ? "#1e5cff" : "rgba(255,255,255,.07)"};color:${isUser ? "#fff" : "var(--text,#f5f5f7)"};font-size:13px;line-height:1.55;white-space:pre-wrap">${esc(text)}</div>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return isTemp ? div : null;
}
