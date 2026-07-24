// Dark / light theme for SiteLens (matches SmartCore convention)

const STORAGE_KEY = "smartcore-sitelens-theme";

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
  if (btn) btn.innerHTML = theme === "dark"
    ? '<i data-lucide="sun"></i>'
    : '<i data-lucide="moon"></i>';
  window.lucide?.createIcons?.();
}

export function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "dark";
}
