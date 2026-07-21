// ── ID Card renderer ─────────────────────────────────────────────────────
// Turns a saved template (presence_fire_safety_settings.id_card_template)
// plus one employee's data into front/back card HTML. Used by BOTH the
// Settings template designer (live preview) and the print page, so the
// preview and the printed result always match exactly.
//
// Sizes are all expressed as % of the card's own dimensions so the same
// template renders correctly at any physical scale — a small on-screen
// preview or a real 85.6mm x 54mm print.

import qrcode from "./qrcode-lib.js";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const CARD_RATIO = { landscape: 85.6 / 54, portrait: 54 / 85.6 };

const SHAPE_SIZE = { sm: 16, md: 26, lg: 38 }; // % of the card's shorter side
const PHOTO_SIZE = { sm: 26, md: 34, lg: 44 }; // % of card height
const LOGO_SIZE = { sm: 14, md: 20, lg: 28 }; // % of card width
const QR_SIZE = { sm: 34, md: 46, lg: 60 }; // % of the back card's shorter side

const CORNER_POS = {
  "top-left": "top:0;left:0;transform:translate(-35%,-35%)",
  "top-right": "top:0;right:0;transform:translate(35%,-35%)",
  "bottom-left": "bottom:0;left:0;transform:translate(-35%,35%)",
  "bottom-right": "bottom:0;right:0;transform:translate(35%,35%)",
};

const LOGO_POS = {
  "top-left": "top:6%;left:6%",
  "top-right": "top:6%;right:6%",
  "bottom-left": "bottom:6%;left:6%",
  "bottom-right": "bottom:6%;right:6%",
};

function renderShapes(shapes = []) {
  return (shapes || []).filter((s) => s.enabled !== false).map((s) => {
    const size = SHAPE_SIZE[s.size] ?? SHAPE_SIZE.md;
    const pos = CORNER_POS[s.corner] || CORNER_POS["top-right"];
    const isCircle = s.type !== "rect";
    const dims = isCircle
      ? `height:${size}%;aspect-ratio:1;border-radius:50%`
      : `height:${size}%;aspect-ratio:2/1;border-radius:8px`;
    return `<div style="position:absolute;${pos};${dims};background:${esc(s.color || "#1e5cff")};opacity:${s.opacity ?? 0.2};pointer-events:none;"></div>`;
  }).join("");
}

/** Generates a QR code as a data: URL (client-side, no network call). */
export function generateQrDataUrl(text, { cellSize = 6, margin = 2 } = {}) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, margin);
}

/** @param employee { full_name, job_title, employee_id, profile_picture_url } */
export function renderIdCardFront(template, employee = {}, logoUrl) {
  const t = template || {};
  const orientation = t.orientation === "portrait" ? "portrait" : "landscape";
  const bg = t.background?.color || "#101828";
  const border = t.border?.enabled !== false
    ? `border:${t.border?.width ?? 3}px solid ${esc(t.border?.color || "#1e5cff")}`
    : "border:none";
  const radius = t.cornerRadius ?? 16;

  const photo = t.photo || {};
  const photoSize = PHOTO_SIZE[photo.size] ?? PHOTO_SIZE.md;
  const photoShape = photo.shape === "square" ? "border-radius:10%" : "border-radius:50%";
  const photoBorder = `border:${photo.borderWidth ?? 3}px solid ${esc(photo.borderColor || "#ffffff")}`;
  const photoPos = photo.position === "right" ? "right" : photo.position === "top-center" ? "top-center" : "left";

  const photoHtml = `
    <div style="flex-shrink:0;height:${photoSize}%;aspect-ratio:1;${photoShape};${photoBorder};overflow:hidden;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;">
      ${employee.profile_picture_url
        ? `<img src="${esc(employee.profile_picture_url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;"/>`
        : `<span style="font-weight:800;color:#fff;font-size:${Math.max(photoSize * 0.28, 12)}px;">${esc(initials(employee.full_name))}</span>`}
    </div>`;

  const f = t.fields || {};
  const fieldsHtml = `
    <div style="display:flex;flex-direction:column;gap:4px;min-width:0;${photoPos === "top-center" ? "align-items:center;text-align:center" : photoPos === "right" ? "align-items:flex-end;text-align:right" : "align-items:flex-start;text-align:left"}">
      ${f.name?.show !== false ? `<div style="font-size:${f.name?.fontSize ?? 16}px;color:${esc(f.name?.color || "#fff")};font-weight:${f.name?.bold !== false ? 800 : 500};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${esc(employee.full_name || "")}</div>` : ""}
      ${f.jobTitle?.show !== false ? `<div style="font-size:${f.jobTitle?.fontSize ?? 12}px;color:${esc(f.jobTitle?.color || "#c7d2e0")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;">${esc(employee.job_title || "")}</div>` : ""}
      ${f.employeeCode?.show !== false ? `<div style="font-size:${f.employeeCode?.fontSize ?? 11}px;color:${esc(f.employeeCode?.color || "#8fa0bd")};font-family:monospace;">${esc(employee.employee_id || "")}</div>` : ""}
    </div>`;

  const bodyDirection = photoPos === "top-center" ? "column" : photoPos === "right" ? "row-reverse" : "row";
  const bodyAlign = photoPos === "top-center" ? "center" : "center";

  const logo = t.logo || {};
  const logoSize = LOGO_SIZE[logo.size] ?? LOGO_SIZE.sm;
  const logoPos = LOGO_POS[logo.position] || LOGO_POS["top-left"];
  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="" style="position:absolute;${logoPos};width:${logoSize}%;height:auto;object-fit:contain;"/>`
    : "";

  return `
    <div class="pfs-idcard-face" style="position:relative;overflow:hidden;aspect-ratio:${CARD_RATIO[orientation]};border-radius:${radius}px;background:${esc(bg)};${border};box-sizing:border-box;">
      ${renderShapes(t.shapes)}
      ${logoHtml}
      <div style="position:relative;height:100%;display:flex;flex-direction:${bodyDirection};align-items:${bodyAlign};justify-content:center;gap:${photoPos === "top-center" ? "6" : "14"}%;padding:8%;box-sizing:border-box;">
        ${photoHtml}
        ${fieldsHtml}
      </div>
    </div>`;
}

export function renderIdCardBack(template, qrDataUrl) {
  const t = template || {};
  const orientation = t.orientation === "portrait" ? "portrait" : "landscape";
  const back = t.back || {};
  const bg = back.background?.color || "#ffffff";
  const border = t.border?.enabled !== false
    ? `border:${t.border?.width ?? 3}px solid ${esc(t.border?.color || "#1e5cff")}`
    : "border:none";
  const radius = t.cornerRadius ?? 16;
  const qrSize = QR_SIZE[back.qr?.size] ?? QR_SIZE.md;

  return `
    <div class="pfs-idcard-face" style="position:relative;overflow:hidden;aspect-ratio:${CARD_RATIO[orientation]};border-radius:${radius}px;background:${esc(bg)};${border};box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6%;padding:8%;">
      ${back.qr?.show !== false && qrDataUrl ? `<img src="${esc(qrDataUrl)}" alt="QR badge" style="height:${qrSize}%;aspect-ratio:1;image-rendering:pixelated;"/>` : ""}
      ${back.text ? `<div style="font-size:11px;color:#475569;text-align:center;max-width:90%;">${esc(back.text)}</div>` : ""}
    </div>`;
}

function initials(name) {
  return (name || "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}
