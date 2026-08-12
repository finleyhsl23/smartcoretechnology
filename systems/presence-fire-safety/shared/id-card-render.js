// ── ID Card renderer ─────────────────────────────────────────────────────
// Renders a saved template (presence_fire_safety_settings.id_card_template)
// plus one employee's data into front/back card HTML. Used by the Settings
// canvas editor (as both the live drag-and-drop surface and its own
// preview) and by the print page, so what you design is exactly what
// prints.
//
// Template shape — everything is a freely positioned/sized element, so the
// editor can offer real drag-and-drop rather than a fixed layout:
//   {
//     orientation: "landscape" | "portrait",
//     border: { enabled, color, width },
//     cornerRadius: number,
//     front: { background: { color }, elements: [Element, ...] },
//     back:  { background: { color }, elements: [Element, ...] },
//   }
// Element (x/y/w/h are % of the card's own width/height; z controls stacking;
// rotation is degrees clockwise around the element's own center, same on
// every element type):
//   photo:      { type:"photo", x,y,w,h,z,rotation, shape:"circle"|"square", borderColor, borderWidth }
//   logo:       { type:"logo", x,y,w,h,z,rotation }
//   text:       { type:"text", x,y,w,h,z,rotation, field:"name"|"jobTitle"|"employeeCode", fontSize, color, bold, align }
//   statictext: { type:"statictext", x,y,w,h,z,rotation, text, fontSize, color, align }
//   shape:      { type:"shape", x,y,w,h,z,rotation, shapeType:"circle"|"rect", color, opacity }
//   qr:         { type:"qr", x,y,w,h,z,rotation }

import qrcode from "./qrcode-lib.js";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const CARD_RATIO = { landscape: 85.6 / 54, portrait: 54 / 85.6 };

const FIELD_MAP = { name: "full_name", jobTitle: "job_title", employeeCode: "employee_id" };

export function initials(name) {
  return (name || "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

/** Generates a QR code as a data: URL (client-side, no network call). */
export function generateQrDataUrl(text, { cellSize = 6, margin = 2 } = {}) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cellSize, margin);
}

export function newElement(type, overrides = {}) {
  const base = { id: `el_${Math.random().toString(36).slice(2, 10)}`, x: 30, y: 30, w: 30, h: 20, z: 1, rotation: 0 };
  const defaults = {
    photo: { w: 28, h: 44, shape: "circle", borderColor: "#ffffff", borderWidth: 3 },
    logo: { w: 20, h: 12 },
    text: { w: 50, h: 14, field: "name", fontSize: 16, color: "#ffffff", bold: true, align: "left" },
    statictext: { w: 60, h: 16, text: "Text", fontSize: 12, color: "#334155", align: "left" },
    shape: { w: 30, h: 30, shapeType: "circle", color: "#1e5cff", opacity: 0.25 },
    qr: { w: 36, h: 36 },
  };
  return { ...base, type, ...(defaults[type] || {}), ...overrides };
}

export function getDefaultTemplate() {
  return {
    orientation: "landscape",
    border: { enabled: true, color: "#1e5cff", width: 3 },
    cornerRadius: 16,
    front: {
      background: { color: "#101828" },
      elements: [
        { id: "shape1", type: "shape", shapeType: "circle", x: 68, y: -18, w: 46, h: 46, color: "#1e5cff", opacity: 0.25, z: 0 },
        { id: "shape2", type: "shape", shapeType: "rect", x: -12, y: 78, w: 42, h: 26, color: "#5b8dff", opacity: 0.18, z: 0 },
        { id: "logo1", type: "logo", x: 6, y: 6, w: 20, h: 13, z: 2 },
        { id: "photo1", type: "photo", x: 8, y: 27, w: 27, h: 44, shape: "circle", borderColor: "#ffffff", borderWidth: 3, z: 1 },
        { id: "name1", type: "text", field: "name", x: 40, y: 33, w: 54, h: 16, fontSize: 16, color: "#ffffff", bold: true, align: "left", z: 2 },
        { id: "jobTitle1", type: "text", field: "jobTitle", x: 40, y: 49, w: 54, h: 12, fontSize: 12, color: "#c7d2e0", bold: false, align: "left", z: 2 },
        { id: "employeeCode1", type: "text", field: "employeeCode", x: 40, y: 61, w: 54, h: 10, fontSize: 11, color: "#8fa0bd", bold: false, align: "left", z: 2 },
      ],
    },
    back: {
      background: { color: "#ffffff" },
      elements: [
        { id: "qr1", type: "qr", x: 32, y: 12, w: 36, h: 36, z: 1 },
        { id: "text1", type: "statictext", text: "If found, please return to reception.", x: 10, y: 55, w: 80, h: 20, fontSize: 11, color: "#475569", align: "center", z: 2 },
      ],
    },
  };
}

/** Returns a valid template, falling back to the default if `saved` is
 *  missing or predates this free-form element model (the earlier
 *  preset-based version — this feature is new enough that there's no
 *  real customer data to migrate, so unrecognised shapes just reset). */
export function normalizeTemplate(saved) {
  if (saved && Array.isArray(saved.front?.elements) && Array.isArray(saved.back?.elements)) {
    return saved;
  }
  return getDefaultTemplate();
}

function alignToJustify(align) {
  return align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
}

function renderElement(el, ctx) {
  const style = `position:absolute;left:${el.x}%;top:${el.y}%;width:${el.w}%;height:${el.h}%;z-index:${el.z ?? 1};box-sizing:border-box;transform:rotate(${el.rotation || 0}deg);`;
  if (el.type === "photo") {
    const shape = el.shape === "square" ? "border-radius:10%" : "border-radius:50%";
    const border = `border:${el.borderWidth ?? 3}px solid ${esc(el.borderColor || "#ffffff")}`;
    const photoUrl = ctx.employee?.profile_picture_url;
    return `<div style="${style}${shape};${border};overflow:hidden;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;">
      ${photoUrl
        ? `<img src="${esc(photoUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;"/>`
        : `<span style="font-weight:800;color:#fff;font-size:${Math.max(el.h * 0.28, 10)}%;">${esc(initials(ctx.employee?.full_name))}</span>`}
    </div>`;
  }
  if (el.type === "logo") {
    return ctx.logoUrl ? `<img src="${esc(ctx.logoUrl)}" alt="" style="${style}object-fit:contain;"/>` : "";
  }
  if (el.type === "text") {
    const value = ctx.employee?.[FIELD_MAP[el.field]] || "";
    return `<div style="${style}display:flex;align-items:center;justify-content:${alignToJustify(el.align)};font-size:${el.fontSize ?? 14}px;color:${esc(el.color || "#fff")};font-weight:${el.bold ? 800 : 500};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:${el.align || "left"};">${esc(value)}</div>`;
  }
  if (el.type === "statictext") {
    return `<div style="${style}display:flex;align-items:center;justify-content:${alignToJustify(el.align)};font-size:${el.fontSize ?? 12}px;color:${esc(el.color || "#334155")};text-align:${el.align || "left"};line-height:1.3;">${esc(el.text || "")}</div>`;
  }
  if (el.type === "shape") {
    const radius = el.shapeType === "rect" ? "border-radius:8px" : "border-radius:50%";
    return `<div style="${style}${radius};background:${esc(el.color || "#1e5cff")};opacity:${el.opacity ?? 0.2};pointer-events:none;"></div>`;
  }
  if (el.type === "qr") {
    return ctx.qrDataUrl ? `<img src="${ctx.qrDataUrl}" alt="QR badge" style="${style}image-rendering:pixelated;"/>` : "";
  }
  return "";
}

/** Renders one face ("front" | "back") of the card to an HTML string. */
export function renderCardFace(template, face, ctx = {}) {
  const t = template || getDefaultTemplate();
  const faceData = t[face] || {};
  const orientation = t.orientation === "portrait" ? "portrait" : "landscape";
  const bg = faceData.background?.color || (face === "back" ? "#ffffff" : "#101828");
  const border = t.border?.enabled !== false
    ? `border:${t.border?.width ?? 3}px solid ${esc(t.border?.color || "#1e5cff")}`
    : "border:none";
  const radius = t.cornerRadius ?? 16;
  const elements = [...(faceData.elements || [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  return `
    <div class="pfs-idcard-face" style="position:relative;overflow:hidden;aspect-ratio:${CARD_RATIO[orientation]};border-radius:${radius}px;background:${esc(bg)};${border};">
      ${elements.map((el) => renderElement(el, ctx)).join("")}
    </div>`;
}

/** @param employee { full_name, job_title, employee_id, profile_picture_url } */
export function renderIdCardFront(template, employee, logoUrl, qrDataUrl = null) {
  return renderCardFace(template, "front", { employee, logoUrl, qrDataUrl });
}

export function renderIdCardBack(template, qrDataUrl, employee = null, logoUrl = null) {
  return renderCardFace(template, "back", { employee, logoUrl, qrDataUrl });
}

// ── Canvas rasterizer ────────────────────────────────────────────────────
// Produces an actual PNG of a card face, at real print resolution, for
// sending to SmartCore's print partner — there's no server-side renderer
// available (Cloudflare Workers has no DOM/canvas), so this runs in the
// browser at order time and the resulting images get uploaded.
//
// The template's px-based values (fontSize, border width) are calibrated
// against the browser's own print output, which renders CSS px at the
// standard 96-per-inch mapping regardless of the mm-sized container. PRINT_DPI
// is the raster resolution the PNG is generated at, so everything sized in
// px needs multiplying by PX_SCALE to land at the same physical size.
const PRINT_DPI = 300;
const PX_PER_MM = PRINT_DPI / 25.4;
const PX_SCALE = PRINT_DPI / 96;

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function drawCover(c, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  c.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function wrapLines(c, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function truncateToWidth(c, text, maxWidth) {
  if (c.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && c.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

async function drawElementOnCanvas(c, el, ctx, W, H) {
  const ex = (el.x / 100) * W, ey = (el.y / 100) * H, ew = (el.w / 100) * W, eh = (el.h / 100) * H;
  const rotation = el.rotation || 0;
  if (rotation) {
    const cx = ex + ew / 2, cy = ey + eh / 2;
    c.save();
    c.translate(cx, cy);
    c.rotate((rotation * Math.PI) / 180);
    c.translate(-cx, -cy);
  }
  await drawElementShape(c, el, ctx, ex, ey, ew, eh);
  if (rotation) c.restore();
}

async function drawElementShape(c, el, ctx, ex, ey, ew, eh) {
  if (el.type === "photo") {
    c.save();
    if (el.shape === "square") roundRectPath(c, ex, ey, ew, eh, Math.min(ew, eh) * 0.1);
    else { c.beginPath(); c.ellipse(ex + ew / 2, ey + eh / 2, ew / 2, eh / 2, 0, 0, Math.PI * 2); }
    c.clip();
    const img = await loadImage(ctx.employee?.profile_picture_url);
    if (img) {
      drawCover(c, img, ex, ey, ew, eh);
    } else {
      c.fillStyle = "rgba(255,255,255,.14)";
      c.fillRect(ex, ey, ew, eh);
      c.fillStyle = "#fff";
      c.font = `800 ${Math.max(eh * 0.28, 10 * PX_SCALE)}px sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(initials(ctx.employee?.full_name), ex + ew / 2, ey + eh / 2);
    }
    c.restore();
    const borderWidth = (el.borderWidth ?? 3) * PX_SCALE;
    if (borderWidth > 0) {
      c.save();
      c.lineWidth = borderWidth;
      c.strokeStyle = el.borderColor || "#ffffff";
      if (el.shape === "square") roundRectPath(c, ex + borderWidth / 2, ey + borderWidth / 2, ew - borderWidth, eh - borderWidth, Math.min(ew, eh) * 0.1);
      else { c.beginPath(); c.ellipse(ex + ew / 2, ey + eh / 2, ew / 2 - borderWidth / 2, eh / 2 - borderWidth / 2, 0, 0, Math.PI * 2); }
      c.stroke();
      c.restore();
    }
    return;
  }

  if (el.type === "logo") {
    const img = await loadImage(ctx.logoUrl);
    if (!img) return;
    const scale = Math.min(ew / img.width, eh / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    c.drawImage(img, ex + (ew - dw) / 2, ey + (eh - dh) / 2, dw, dh);
    return;
  }

  if (el.type === "text" || el.type === "statictext") {
    const value = el.type === "text" ? (ctx.employee?.[FIELD_MAP[el.field]] || "") : (el.text || "");
    const fontSize = (el.fontSize ?? (el.type === "text" ? 14 : 12)) * PX_SCALE;
    const weight = el.type === "text" && el.bold ? 800 : 500;
    c.font = `${weight} ${fontSize}px sans-serif`;
    c.fillStyle = el.color || (el.type === "text" ? "#fff" : "#334155");
    const align = el.align || "left";
    c.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
    const anchorX = align === "center" ? ex + ew / 2 : align === "right" ? ex + ew : ex;

    if (el.type === "text") {
      // Single line, truncated with an ellipsis rather than wrapped —
      // matches the on-screen nowrap/text-overflow:ellipsis rendering.
      c.textBaseline = "middle";
      c.fillText(truncateToWidth(c, value, ew), anchorX, ey + eh / 2);
    } else {
      const lines = wrapLines(c, value, ew);
      const lineHeight = fontSize * 1.3;
      const totalHeight = lines.length * lineHeight;
      let ly = ey + eh / 2 - totalHeight / 2 + lineHeight / 2;
      c.textBaseline = "middle";
      for (const line of lines) { c.fillText(line, anchorX, ly); ly += lineHeight; }
    }
    return;
  }

  if (el.type === "shape") {
    c.save();
    c.globalAlpha = el.opacity ?? 0.2;
    c.fillStyle = el.color || "#1e5cff";
    if (el.shapeType === "rect") roundRectPath(c, ex, ey, ew, eh, 8 * PX_SCALE);
    else { c.beginPath(); c.ellipse(ex + ew / 2, ey + eh / 2, ew / 2, eh / 2, 0, 0, Math.PI * 2); }
    c.fill();
    c.restore();
    return;
  }

  if (el.type === "qr") {
    const img = await loadImage(ctx.qrDataUrl);
    if (!img) return;
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(img, ex, ey, ew, eh);
    c.restore();
  }
}

/** Rasterizes one face to a canvas at print resolution (300dpi). Async
 *  because photo/logo/QR images have to load first. */
export async function renderCardToCanvas(template, face, ctx = {}) {
  const t = template || getDefaultTemplate();
  const faceData = t[face] || {};
  const orientation = t.orientation === "portrait" ? "portrait" : "landscape";
  const W = Math.round((orientation === "portrait" ? 54 : 85.6) * PX_PER_MM);
  const H = Math.round((orientation === "portrait" ? 85.6 : 54) * PX_PER_MM);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d");

  const bg = faceData.background?.color || (face === "back" ? "#ffffff" : "#101828");
  const radius = (t.cornerRadius ?? 16) * PX_SCALE;

  c.save();
  roundRectPath(c, 0, 0, W, H, radius);
  c.fillStyle = bg;
  c.fill();
  c.clip();

  const elements = [...(faceData.elements || [])].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  for (const el of elements) await drawElementOnCanvas(c, el, ctx, W, H);
  c.restore();

  if (t.border?.enabled !== false) {
    const borderWidth = (t.border?.width ?? 3) * PX_SCALE;
    c.save();
    c.lineWidth = borderWidth;
    c.strokeStyle = t.border?.color || "#1e5cff";
    roundRectPath(c, borderWidth / 2, borderWidth / 2, W - borderWidth, H - borderWidth, radius);
    c.stroke();
    c.restore();
  }

  return canvas;
}

/** Renders both faces of a card as PNG data: URLs (print resolution). */
export async function renderCardImagePair(template, ctx = {}) {
  const [frontCanvas, backCanvas] = await Promise.all([
    renderCardToCanvas(template, "front", ctx),
    renderCardToCanvas(template, "back", ctx),
  ]);
  return { front: frontCanvas.toDataURL("image/png"), back: backCanvas.toDataURL("image/png") };
}
