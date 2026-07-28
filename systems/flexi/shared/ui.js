export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function fmtMoney(pence, currency = "GBP") {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  return symbol + (Number(pence || 0) / 100).toFixed(2);
}

export function fmtDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date)) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Deterministic gradient palette for .fx-tile thumbnail cards (program /
// exercise / package cards) — same seed always resolves to the same
// gradient so a card doesn't change colour on re-render.
const TILE_GRADIENTS = [
  "linear-gradient(135deg,#ff7a45,#ff3d7f)",
  "linear-gradient(135deg,#6366f1,#a855f7)",
  "linear-gradient(135deg,#0ea5b7,#2563eb)",
  "linear-gradient(135deg,#16a34a,#0d9488)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#8b5cf6,#ec4899)",
];
export function tileGradient(seed) {
  const str = String(seed ?? "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return TILE_GRADIENTS[hash % TILE_GRADIENTS.length];
}

export function initials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
}

let _toastTimer = null;
export function toast(message, type = "info") {
  let el = document.getElementById("fxToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "fxToast";
    el.className = "fx-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `fx-toast fx-toast-${type} fx-toast-show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("fx-toast-show"), 3200);
}

export function setLoading(btn, loading, loadingText) {
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.dataset.origText || btn.textContent;
    btn.textContent = loadingText || "Working…";
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.origText || btn.textContent;
    btn.disabled = false;
  }
}

export function showMessage(elId, message, type = "info") {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = message;
  el.className = `fx-form-msg fx-form-msg-${type}`;
}

export function revealApp() {
  const loader = document.getElementById("fxLoader");
  const app = document.getElementById("fxApp");
  if (loader) loader.style.display = "none";
  if (app) app.style.display = "";
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("fx-modal-open");
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("fx-modal-open");
}

export function emptyState(icon, title, sub) {
  return `<div class="fx-empty"><div class="fx-empty-icon">${icon}</div><div class="fx-empty-title">${escapeHtml(title)}</div>${sub ? `<div class="fx-empty-sub">${escapeHtml(sub)}</div>` : ""}</div>`;
}

export function setupThemeToggle(storageKey = "flexiTheme") {
  const saved = localStorage.getItem(storageKey);
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const sync = () => {
    const cur = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    btn.textContent = cur === "dark" ? "☀️" : "🌙";
  };
  sync();
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(storageKey, next);
    sync();
  });
}
