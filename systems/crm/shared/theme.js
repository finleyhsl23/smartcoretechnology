// Dark / light theme for SmartCore CRM

const STORAGE_KEY = "smartcore-crm-theme";

export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY) || "dark";
  applyTheme(saved);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem(STORAGE_KEY, next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
}

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}
