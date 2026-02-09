// /app/shared/ui.js
export function $(id) {
  return document.getElementById(id);
}

export function toast(type, title, message) {
  const wrap = document.getElementById("toastwrap");
  if (!wrap) return;

  const el = document.createElement("div");
  el.className = "toast";

  const dot = document.createElement("div");
  dot.className = `tDot ${type || ""}`;

  const box = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = title;

  const p = document.createElement("p");
  p.textContent = message;

  box.appendChild(b);
  box.appendChild(p);

  el.appendChild(dot);
  el.appendChild(box);

  wrap.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(6px)";
  }, 3600);

  setTimeout(() => el.remove(), 4300);
}

export function fmtDateTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export function downloadCSV(filename, rows) {
  const safe = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const headers = Object.keys(rows[0] || {});
  const csv = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => safe(r[h])).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export async function sha256Hex(str) {
  const enc = new TextEncoder().encode(String(str));
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

