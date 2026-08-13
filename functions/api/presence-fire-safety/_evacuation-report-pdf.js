// Builds the full evacuation roll-call report as a PDF: everyone snapshotted
// into the session, with their photo where one is on file, "Not marked
// safe" first (missing/unaccounted/other), then everyone "Marked safe"
// below. Shared by notify-evacuation-completed.js (emailed as an
// attachment) and evacuation-report-pdf.js (fetched by the client to open
// the same report right after completing an evacuation, or from history).
//
// Zero-dependency by design, matching the rest of this module's Cloudflare
// Functions (no npm deps configured) — the PDF is hand-assembled with raw
// PDF syntax, the same technique functions/api/payment-complete.js already
// uses for invoices, extended here with JPEG image XObjects (/DCTDecode)
// so photos can be embedded without any image-processing library, plus
// rounded rects, alpha transparency (ExtGState /ca) and axial-gradient
// fills (/Shading) for a modern "glass panel" look — translucent white
// cards with soft shadows floating over a gradient wash. A static PDF
// can't do a real background blur, so that's the closest a hand-rolled
// renderer gets to the "liquid glass" aesthetic without one.
//
// Only JPEG photos can be embedded this way (kiosk visitor/contractor
// captures always are — see shared/camera.js); anything else (e.g. a PNG
// employee avatar) falls back to a gradient initials circle instead of
// failing the report.
import { SUPABASE_URL, sb } from './_auth.js';

export const STATUS_LABEL = {
  unaccounted: 'Unaccounted', safe: 'Safe', missing: 'Missing',
  left_before_roll_call: 'Left before roll call', not_expected: 'Not expected', other: 'Other',
};

export function fmtDuration(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtDT(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Data loading ────────────────────────────────────────────────────────
async function loadEvacuationReportData(env, companyId, sessionId) {
  const [sessionRes, peopleRes] = await Promise.all([
    sb(env, `/presence_fire_safety_evacuation_sessions?id=eq.${sessionId}&company_id=eq.${companyId}` +
      `&select=id,started_at,completed_at,assembly_point,snapshot_count,safe_count,missing_count,unaccounted_count,site_id,sites(name)`),
    sb(env, `/presence_fire_safety_evacuation_people?evacuation_session_id=eq.${sessionId}&company_id=eq.${companyId}` +
      `&select=display_name_snapshot,subject_type,department_snapshot,roll_call_status,notes,` +
      `emp:core_employees!employee_id(profile_picture_url),` +
      `vv:presence_fire_safety_visitor_visits!visitor_visit_id(visitor:presence_fire_safety_visitors(photo_path)),` +
      `cv:presence_fire_safety_contractor_visits!contractor_visit_id(contractor:presence_fire_safety_contractors(photo_path))` +
      `&order=display_name_snapshot`),
  ]);
  const [session] = await sessionRes.json();
  if (!session) throw new Error('Evacuation session not found');
  const people = (await peopleRes.json()) || [];
  return { session, people };
}

function photoSourceFor(p) {
  if (p.subject_type === 'employee' && p.emp?.profile_picture_url) return { kind: 'url', value: p.emp.profile_picture_url };
  if (p.subject_type === 'visitor' && p.vv?.visitor?.photo_path) return { kind: 'storage', value: p.vv.visitor.photo_path };
  if (p.subject_type === 'contractor' && p.cv?.contractor?.photo_path) return { kind: 'storage', value: p.cv.contractor.photo_path };
  return null;
}

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

async function fetchPhotoBytes(env, source) {
  if (!source) return null;
  try {
    const res = source.kind === 'url'
      ? await fetch(source.value)
      : await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/storage/v1/object/presence-fire-safety-photos/${source.value}`, {
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
        });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 3 || buf.length > MAX_PHOTO_BYTES) return null;
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return null; // JPEG only
    return buf;
  } catch {
    return null;
  }
}

// Walks JPEG markers to find the SOF segment for width/height/component
// count — needed to size and colour the PDF image XObject correctly.
function jpegDimensions(bytes) {
  let i = 2;
  const len = bytes.length;
  while (i + 3 < len) {
    if (bytes[i] !== 0xff) { i++; continue; }
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 2 < len) { i++; marker = bytes[i + 1]; }
    i += 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan — no more headers
    if (i + 1 >= len) break;
    const segLen = (bytes[i] << 8) | bytes[i + 1];
    const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (i + 7 >= len) return null;
      return {
        height: (bytes[i + 3] << 8) | bytes[i + 4],
        width: (bytes[i + 5] << 8) | bytes[i + 6],
        components: bytes[i + 7],
      };
    }
    i += segLen;
  }
  return null;
}

// ── Low-level PDF primitives ───────────────────────────────────────────
const PAGE_W = 595.28, PAGE_H = 841.89; // A4, pt
const MARGIN = 36;
const FOOTER_LIMIT = MARGIN + 22;

// ── Palette ─────────────────────────────────────────────────────────────
// A soft "glass" aesthetic — translucent white panels with soft shadows,
// floating over a gentle gradient wash, with colour carried by gradients
// (header band, section banners, avatar fallbacks) rather than flat fills.
const INK = [0.086, 0.106, 0.176];
const INK_SOFT = [0.373, 0.408, 0.482];
const WHITE = [1, 1, 1];
const RED_A = [0.937, 0.267, 0.267];
const AMBER = [0.851, 0.467, 0.024];
const GREEN_A = [0.020, 0.667, 0.475];
const SHADOW = [0.086, 0.106, 0.176];
const GLASS_BORDER = [0.85, 0.87, 0.93];

const STATUS_COLOR = {
  safe: GREEN_A, missing: RED_A, unaccounted: AMBER,
  left_before_roll_call: INK_SOFT, not_expected: INK_SOFT, other: INK_SOFT,
};

// Two-colour axial gradients used throughout the report. `coords` are in a
// local 0..1 unit-square space — each use site clips to its actual target
// rect, transforms that unit square onto it via `cm`, then paints with
// `sh`, so one Shading object per gradient serves every rect it's used on
// regardless of size or position (see opsToStream's 'gradient' case).
const GRADIENT_DEFS = {
  header: { resourceName: 'ShHeader', c0: [0.298, 0.204, 0.706], c1: [0.145, 0.388, 0.922], coords: [0, 0, 1, 1] },
  red: { resourceName: 'ShRed', c0: RED_A, c1: [0.945, 0.443, 0.129], coords: [0, 0, 1, 0] },
  green: { resourceName: 'ShGreen', c0: GREEN_A, c1: [0.024, 0.714, 0.831], coords: [0, 0, 1, 0] },
  avatar: { resourceName: 'ShAvatar', c0: [0.376, 0.306, 0.855], c1: [0.204, 0.514, 0.965], coords: [0, 0, 1, 1] },
  wash: { resourceName: 'ShWash', c0: [0.902, 0.917, 0.984], c1: [0.988, 0.945, 0.976], coords: [0, 0, 1, 1] },
};
// Every alpha (fill translucency) used anywhere in the design — declared
// once so assemblePdf can emit exactly one ExtGState object per level and
// opsToStream can look each one up by value rather than re-deriving them.
const ALPHA_LEVELS = [0.05, 0.06, 0.07, 0.15, 0.9];

function sanitizeText(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // strip combining diacritics (e.g. accented Latin -> plain)
    .replace(/[^\x20-\x7E]/g, '?'); // PDF standard fonts here only cover ASCII
}

function pdfEscape(s) {
  return sanitizeText(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function estimateTextWidth(text, fontSize, bold = false) {
  return sanitizeText(text).length * fontSize * (bold ? 0.56 : 0.5);
}

function truncate(text, availWidth, fontSize, bold = false) {
  const t = sanitizeText(text);
  const charW = fontSize * (bold ? 0.56 : 0.5);
  const maxChars = Math.max(4, Math.floor(availWidth / charW));
  return t.length <= maxChars ? t : t.slice(0, maxChars - 3) + '...';
}

function initials(name) {
  const parts = sanitizeText(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function fmt(n) {
  return (Math.round(n * 100) / 100).toString();
}

function colStr(c) {
  const [r, g, b] = c || INK;
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} rg`;
}

function colStrStroke(c) {
  const [r, g, b] = c || INK;
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} RG`;
}

// Rounded-rect path construction (no fill/stroke operator — callers add
// their own). r is clamped to half the smaller dimension so it degrades
// gracefully into a pill or circle instead of an invalid self-intersecting
// path; a circle is just this with w = h = 2r. The 0.5523 constant is the
// standard cubic-bezier approximation of a 90° circular arc.
function roundedRectOps(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 0.01) return `${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re`;
  const k = 0.5523 * rr;
  return [
    `${fmt(x + rr)} ${fmt(y)} m`,
    `${fmt(x + w - rr)} ${fmt(y)} l`,
    `${fmt(x + w - rr + k)} ${fmt(y)} ${fmt(x + w)} ${fmt(y + rr - k)} ${fmt(x + w)} ${fmt(y + rr)} c`,
    `${fmt(x + w)} ${fmt(y + h - rr)} l`,
    `${fmt(x + w)} ${fmt(y + h - rr + k)} ${fmt(x + w - rr + k)} ${fmt(y + h)} ${fmt(x + w - rr)} ${fmt(y + h)} c`,
    `${fmt(x + rr)} ${fmt(y + h)} l`,
    `${fmt(x + rr - k)} ${fmt(y + h)} ${fmt(x)} ${fmt(y + h - rr + k)} ${fmt(x)} ${fmt(y + h - rr)} c`,
    `${fmt(x)} ${fmt(y + rr)} l`,
    `${fmt(x)} ${fmt(y + rr - k)} ${fmt(x + rr - k)} ${fmt(y)} ${fmt(x + rr)} ${fmt(y)} c`,
    'h',
  ].join('\n');
}

function opsToStream(ops, alphaGsName) {
  let s = '';
  for (const op of ops) {
    if (op.op === 'rect') {
      const gs = op.alpha != null && op.alpha < 1 ? alphaGsName.get(op.alpha) : null;
      s += 'q\n';
      if (gs) s += `/${gs} gs\n`;
      s += `${colStr(op.color)}\n${roundedRectOps(op.x, op.y, op.w, op.h, op.r || 0)}\nf\nQ\n`;
      if (op.border) {
        s += `q\n${colStrStroke(op.border)}\n${fmt(op.borderWidth || 1)} w\n${roundedRectOps(op.x, op.y, op.w, op.h, op.r || 0)}\nS\nQ\n`;
      }
    } else if (op.op === 'gradient') {
      const def = GRADIENT_DEFS[op.grad];
      s += `q\n${roundedRectOps(op.x, op.y, op.w, op.h, op.r || 0)}\nW n\n`;
      s += `${fmt(op.w)} 0 0 ${fmt(op.h)} ${fmt(op.x)} ${fmt(op.y)} cm\n/${def.resourceName} sh\nQ\n`;
    } else if (op.op === 'shadow') {
      // A few stacked, slightly larger, very-low-alpha copies of the same
      // rounded rect, offset downward — the closest a blur-free renderer
      // gets to a soft drop shadow under a glass panel.
      const layers = [
        { grow: 10, dy: -6, alpha: 0.05 },
        { grow: 6, dy: -4, alpha: 0.06 },
        { grow: 3, dy: -2, alpha: 0.07 },
      ];
      for (const l of layers) {
        const gs = alphaGsName.get(l.alpha);
        s += `q\n/${gs} gs\n${colStr(SHADOW)}\n${roundedRectOps(op.x - l.grow / 2, op.y - l.grow / 2 + l.dy, op.w + l.grow, op.h + l.grow, (op.r || 0) + l.grow / 2)}\nf\nQ\n`;
      }
    } else if (op.op === 'text') {
      s += `${colStr(op.color)}\nBT\n/${op.bold ? 'F2' : 'F1'} ${op.size} Tf\n${fmt(op.x)} ${fmt(op.y)} Td\n(${pdfEscape(op.text)}) Tj\nET\n`;
    } else if (op.op === 'image') {
      s += `q\n${fmt(op.w)} 0 0 ${fmt(op.h)} ${fmt(op.x)} ${fmt(op.y)} cm\n/${op.name} Do\nQ\n`;
    } else if (op.op === 'photo-circle') {
      // Clip to a circle, cover-fit the photo inside it, then stroke a
      // thin white ring on top — a real "avatar", not a square thumbnail.
      const circle = roundedRectOps(op.cx - op.r, op.cy - op.r, op.r * 2, op.r * 2, op.r);
      s += `q\n${circle}\nW n\n${fmt(op.dw)} 0 0 ${fmt(op.dh)} ${fmt(op.ix)} ${fmt(op.iy)} cm\n/${op.name} Do\nQ\n`;
      s += `q\n${colStrStroke(WHITE)}\n1.5 w\n${circle}\nS\nQ\n`;
    } else if (op.op === 'avatar-circle') {
      const circle = roundedRectOps(op.cx - op.r, op.cy - op.r, op.r * 2, op.r * 2, op.r);
      s += `q\n${circle}\nW n\n${fmt(op.r * 2)} 0 0 ${fmt(op.r * 2)} ${fmt(op.cx - op.r)} ${fmt(op.cy - op.r)} cm\n/${GRADIENT_DEFS.avatar.resourceName} sh\nQ\n`;
      const offset = op.text.length > 1 ? op.size * 0.6 : op.size * 0.28;
      s += `${colStr(WHITE)}\nBT\n/F2 ${op.size} Tf\n${fmt(op.cx - offset)} ${fmt(op.cy - op.size * 0.36)} Td\n(${pdfEscape(op.text)}) Tj\nET\n`;
    }
  }
  return s;
}

function asciiBytes(str) {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
  return arr;
}

// ── Report layout ───────────────────────────────────────────────────────
function drawPageBackground(ops) {
  ops.push({ op: 'gradient', x: 0, y: 0, w: PAGE_W, h: PAGE_H, r: 0, grad: 'wash' });
}

function newLayoutState() {
  const state = { pages: [], ops: [], y: PAGE_H - MARGIN };
  drawPageBackground(state.ops);
  return state;
}

function newPage(state) {
  state.pages.push(state.ops);
  state.ops = [];
  drawPageBackground(state.ops);
  state.y = PAGE_H - MARGIN;
}

function finishPage(state) {
  state.pages.push(state.ops);
}

function drawSectionBanner(state, label, grad) {
  const h = 26;
  if (state.y - h < FOOTER_LIMIT) newPage(state);
  state.ops.push({ op: 'gradient', x: MARGIN, y: state.y - h, w: PAGE_W - 2 * MARGIN, h, r: h / 2, grad });
  state.ops.push({ op: 'text', x: MARGIN + 14, y: state.y - h + 9, size: 11, bold: true, color: WHITE, text: label });
  state.y -= h + 16;
}

function drawTitleAndSummary(state, session) {
  const siteName = session.sites?.name || 'Site';
  const headerH = 92;
  state.ops.push({ op: 'gradient', x: 0, y: PAGE_H - headerH, w: PAGE_W, h: headerH, r: 0, grad: 'header' });
  state.ops.push({ op: 'text', x: MARGIN, y: PAGE_H - 40, size: 22, bold: true, color: WHITE, text: 'Evacuation Report' });
  state.ops.push({ op: 'text', x: MARGIN, y: PAGE_H - 62, size: 12, bold: false, color: WHITE, text: siteName });
  state.y = PAGE_H - headerH - 24;

  const metaRows = [
    ['Started', fmtDT(session.started_at)],
    ['Completed', fmtDT(session.completed_at)],
    ['Duration', fmtDuration(session.started_at, session.completed_at || new Date().toISOString())],
    ['Assembly point', session.assembly_point || 'Not recorded'],
  ];
  const metaH = metaRows.length * 18 + 16;
  state.ops.push({ op: 'shadow', x: MARGIN, y: state.y - metaH, w: PAGE_W - 2 * MARGIN, h: metaH, r: 14 });
  state.ops.push({ op: 'rect', x: MARGIN, y: state.y - metaH, w: PAGE_W - 2 * MARGIN, h: metaH, r: 14, color: WHITE, alpha: 0.9, border: GLASS_BORDER, borderWidth: 0.75 });
  let my = state.y - 16;
  for (const [k, v] of metaRows) {
    state.ops.push({ op: 'text', x: MARGIN + 16, y: my, size: 10, bold: false, color: INK_SOFT, text: k });
    state.ops.push({ op: 'text', x: MARGIN + 160, y: my, size: 10, bold: true, color: INK, text: String(v) });
    my -= 18;
  }
  state.y -= metaH + 18;

  const counts = [
    ['Snapshotted', session.snapshot_count ?? 0, INK],
    ['Safe', session.safe_count ?? 0, GREEN_A],
    ['Missing', session.missing_count ?? 0, RED_A],
    ['Unaccounted', session.unaccounted_count ?? 0, AMBER],
  ];
  const gap = 10;
  const boxW = (PAGE_W - 2 * MARGIN - 3 * gap) / 4;
  const boxH = 54;
  counts.forEach(([label, val, color], i) => {
    const x = MARGIN + i * (boxW + gap);
    state.ops.push({ op: 'shadow', x, y: state.y - boxH, w: boxW, h: boxH, r: 12 });
    state.ops.push({ op: 'rect', x, y: state.y - boxH, w: boxW, h: boxH, r: 12, color: WHITE, alpha: 0.9, border: GLASS_BORDER, borderWidth: 0.75 });
    state.ops.push({ op: 'text', x: x + 12, y: state.y - 23, size: 18, bold: true, color, text: String(val) });
    state.ops.push({ op: 'text', x: x + 12, y: state.y - 40, size: 8, bold: false, color: INK_SOFT, text: label });
  });
  state.y -= boxH + 26;
}

function drawCard(state, x, yTop, w, h, person, photo) {
  const r = 14, padding = 10, photoR = 26;
  state.ops.push({ op: 'shadow', x, y: yTop - h, w, h, r });
  state.ops.push({ op: 'rect', x, y: yTop - h, w, h, r, color: WHITE, alpha: 0.9, border: GLASS_BORDER, borderWidth: 0.75 });

  const cx = x + padding + photoR, cy = yTop - padding - photoR;
  if (photo) {
    const scale = Math.max((photoR * 2) / photo.width, (photoR * 2) / photo.height); // cover-fit
    const dw = photo.width * scale, dh = photo.height * scale;
    state.ops.push({ op: 'photo-circle', name: `Im${photo.imgIndex}`, cx, cy, r: photoR, ix: cx - dw / 2, iy: cy - dh / 2, dw, dh });
  } else {
    state.ops.push({ op: 'avatar-circle', cx, cy, r: photoR, size: 15, text: initials(person.display_name_snapshot) });
  }

  const textX = x + padding * 2 + photoR * 2;
  const availW = w - (padding * 2 + photoR * 2 + padding);
  let ty = yTop - padding - 9;
  state.ops.push({ op: 'text', x: textX, y: ty, size: 10.5, bold: true, color: INK, text: truncate(person.display_name_snapshot, availW, 10.5, true) });
  ty -= 16;

  const statusLabel = STATUS_LABEL[person.roll_call_status] || person.roll_call_status;
  const statusColor = STATUS_COLOR[person.roll_call_status] || INK_SOFT;
  const pillW = Math.min(estimateTextWidth(statusLabel, 8, true) + 16, availW);
  state.ops.push({ op: 'rect', x: textX, y: ty - 11, w: pillW, h: 14, r: 7, color: statusColor, alpha: 0.15 });
  state.ops.push({ op: 'text', x: textX + 8, y: ty - 7, size: 8, bold: true, color: statusColor, text: statusLabel });
  ty -= 22;

  if (person.department_snapshot) {
    state.ops.push({ op: 'text', x: textX, y: ty, size: 8.5, bold: false, color: INK_SOFT, text: truncate(person.department_snapshot, availW, 8.5) });
  }
}

function layoutPeopleGrid(state, list, onContinuedPage) {
  if (!list.length) {
    state.ops.push({ op: 'text', x: MARGIN, y: state.y, size: 10, bold: false, color: INK_SOFT, text: 'None.' });
    state.y -= 20;
    return;
  }
  const cols = 3, gap = 14, cardH = 96;
  const cardW = (PAGE_W - 2 * MARGIN - (cols - 1) * gap) / cols;
  for (let i = 0; i < list.length; i += cols) {
    if (state.y - cardH < FOOTER_LIMIT) {
      newPage(state);
      onContinuedPage();
    }
    const rowTop = state.y;
    list.slice(i, i + cols).forEach((item, ci) => {
      drawCard(state, MARGIN + ci * (cardW + gap), rowTop, cardW, cardH, item.person, item.photo);
    });
    state.y = rowTop - cardH - gap;
  }
}

function addFooters(pages) {
  pages.forEach((ops, i) => {
    ops.push({ op: 'text', x: MARGIN, y: 20, size: 8, bold: false, color: INK_SOFT, text: `Page ${i + 1} of ${pages.length}` });
  });
}

// ── PDF assembly ────────────────────────────────────────────────────────
function assemblePdf(pages, images) {
  let objNum = 0;
  const CATALOG = ++objNum;
  const PAGES = ++objNum;
  const RES = ++objNum;
  const F1 = ++objNum;
  const F2 = ++objNum;

  const alphaObjNums = new Map();
  ALPHA_LEVELS.forEach((a) => alphaObjNums.set(a, ++objNum));
  const alphaGsName = new Map();
  [...alphaObjNums.keys()].forEach((a, i) => alphaGsName.set(a, `GS${i}`));

  const gradFuncNums = {}, gradShadeNums = {};
  for (const name of Object.keys(GRADIENT_DEFS)) {
    gradFuncNums[name] = ++objNum;
    gradShadeNums[name] = ++objNum;
  }

  const imageObjNums = images.map(() => ++objNum);
  const pageObjNums = pages.map(() => ++objNum);
  const contentObjNums = pages.map(() => ++objNum);
  const totalObjs = objNum;

  const chunks = [];
  let length = 0;
  const offsets = new Array(totalObjs + 1).fill(0);
  function push(bytesOrStr) {
    const b = typeof bytesOrStr === 'string' ? asciiBytes(bytesOrStr) : bytesOrStr;
    chunks.push(b);
    length += b.length;
  }

  push('%PDF-1.4\n');

  offsets[CATALOG] = length;
  push(`${CATALOG} 0 obj\n<< /Type /Catalog /Pages ${PAGES} 0 R >>\nendobj\n`);

  offsets[PAGES] = length;
  push(`${PAGES} 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`);

  const xobjEntries = images.map((_, i) => `/Im${i} ${imageObjNums[i]} 0 R`).join(' ');
  const gsEntries = [...alphaGsName.entries()].map(([a, name]) => `/${name} ${alphaObjNums.get(a)} 0 R`).join(' ');
  const shEntries = Object.entries(GRADIENT_DEFS).map(([name, def]) => `/${def.resourceName} ${gradShadeNums[name]} 0 R`).join(' ');
  offsets[RES] = length;
  push(`${RES} 0 obj\n<< /Font << /F1 ${F1} 0 R /F2 ${F2} 0 R >> /XObject << ${xobjEntries} >> /ExtGState << ${gsEntries} >> /Shading << ${shEntries} >> >>\nendobj\n`);

  offsets[F1] = length;
  push(`${F1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  offsets[F2] = length;
  push(`${F2} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`);

  for (const a of ALPHA_LEVELS) {
    const num = alphaObjNums.get(a);
    offsets[num] = length;
    push(`${num} 0 obj\n<< /Type /ExtGState /ca ${fmt(a)} /CA ${fmt(a)} >>\nendobj\n`);
  }

  for (const [name, def] of Object.entries(GRADIENT_DEFS)) {
    const fNum = gradFuncNums[name], sNum = gradShadeNums[name];
    offsets[fNum] = length;
    push(`${fNum} 0 obj\n<< /FunctionType 2 /Domain [0 1] /C0 [${def.c0.map(fmt).join(' ')}] /C1 [${def.c1.map(fmt).join(' ')}] /N 1 >>\nendobj\n`);
    offsets[sNum] = length;
    push(`${sNum} 0 obj\n<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${def.coords.map(fmt).join(' ')}] /Function ${fNum} 0 R /Extend [true true] >>\nendobj\n`);
  }

  images.forEach((img, i) => {
    const num = imageObjNums[i];
    offsets[num] = length;
    const colorSpace = img.components === 1 ? '/DeviceGray' : '/DeviceRGB';
    push(`${num} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
    push(img.bytes);
    push('\nendstream\nendobj\n');
  });

  pages.forEach((ops, i) => {
    const pageNum = pageObjNums[i], contentNum = contentObjNums[i];
    offsets[pageNum] = length;
    push(`${pageNum} 0 obj\n<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentNum} 0 R /Resources ${RES} 0 R >>\nendobj\n`);

    const streamBytes = asciiBytes(opsToStream(ops, alphaGsName));
    offsets[contentNum] = length;
    push(`${contentNum} 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
    push(streamBytes);
    push('\nendstream\nendobj\n');
  });

  const xrefOffset = length;
  push('xref\n');
  push(`0 ${totalObjs + 1}\n`);
  push('0000000000 65535 f \n');
  for (let n = 1; n <= totalObjs; n++) push(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
  push('trailer\n');
  push(`<< /Size ${totalObjs + 1} /Root ${CATALOG} 0 R >>\n`);
  push('startxref\n');
  push(`${xrefOffset}\n%%EOF`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ── Entry point ─────────────────────────────────────────────────────────
export async function buildEvacuationReportPdf(env, companyId, sessionId) {
  const { session, people } = await loadEvacuationReportData(env, companyId, sessionId);

  const photoBytesList = await Promise.all(people.map((p) => fetchPhotoBytes(env, photoSourceFor(p))));
  const images = [];
  const photoByPerson = photoBytesList.map((bytes) => {
    if (!bytes) return null;
    const dims = jpegDimensions(bytes);
    if (!dims) return null;
    const imgIndex = images.length;
    images.push({ bytes, width: dims.width, height: dims.height, components: dims.components });
    return { imgIndex, width: dims.width, height: dims.height };
  });

  const notSafe = [], safe = [];
  people.forEach((person, i) => (person.roll_call_status === 'safe' ? safe : notSafe).push({ person, photo: photoByPerson[i] }));
  const severity = { missing: 0, unaccounted: 1, other: 2, left_before_roll_call: 3, not_expected: 3 };
  notSafe.sort((a, b) => (severity[a.person.roll_call_status] ?? 9) - (severity[b.person.roll_call_status] ?? 9) ||
    a.person.display_name_snapshot.localeCompare(b.person.display_name_snapshot));
  safe.sort((a, b) => a.person.display_name_snapshot.localeCompare(b.person.display_name_snapshot));

  const state = newLayoutState();
  drawTitleAndSummary(state, session);
  drawSectionBanner(state, `NOT MARKED SAFE (${notSafe.length})`, 'red');
  layoutPeopleGrid(state, notSafe, () => drawSectionBanner(state, 'NOT MARKED SAFE (continued)', 'red'));
  state.y -= 8;
  drawSectionBanner(state, `MARKED SAFE (${safe.length})`, 'green');
  layoutPeopleGrid(state, safe, () => drawSectionBanner(state, 'MARKED SAFE (continued)', 'green'));
  finishPage(state);
  addFooters(state.pages);

  const bytes = assemblePdf(state.pages, images);
  const dateSlug = new Date(session.completed_at || Date.now()).toISOString().slice(0, 10);
  const siteSlug = (session.sites?.name || 'Site').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  const filename = `Evacuation-Report-${siteSlug}-${dateSlug}.pdf`;

  return { bytes, filename, session, people, notSafeCount: notSafe.length, safeCount: safe.length };
}
