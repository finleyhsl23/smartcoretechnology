// Self-contained SVG floor plan canvas for one level: walls, doors, windows
// (line segments) and rooms (rectangles), with live dimensions computed
// from a configurable pixels-per-meter scale. Draw-new and select+delete
// only — dragging/resizing an already-placed element isn't supported here
// (redraw to replace it instead), which keeps the interaction model simple
// and reliable rather than building full CAD-style manipulation.
//
// A reference image can be shown as a low-opacity backdrop to trace over —
// this is NOT automatic sketch-to-floorplan conversion (no vision model is
// wired up for that here), just a manual tracing aid.

const TOOL_STYLES = {
  wall:   { stroke: "#e9f0ff", width: 7, dash: null },
  door:   { stroke: "#f59e0b", width: 4, dash: "2,3" },
  window: { stroke: "#5b8fff", width: 4, dash: "6,3" },
};

const ROOM_COLORS = {
  none:   { fill: "rgba(255,255,255,0.06)", stroke: "rgba(255,255,255,0.25)" },
  red:    { fill: "rgba(239,68,68,0.22)",   stroke: "#ef4444" },
  amber:  { fill: "rgba(245,158,11,0.22)",  stroke: "#f59e0b" },
  green:  { fill: "rgba(34,197,94,0.22)",   stroke: "#22c55e" },
};

const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * @param {HTMLElement} containerEl
 * @param {object} opts
 *   opts.elements        - array of {id, element_type, geometry, label}
 *   opts.pixelsPerMeter
 *   opts.referenceImageUrl
 *   opts.referenceImageRect - {x,y,width,height} in canvas space where the
 *     image is drawn (letterboxed, not cropped) — see fitImageRect() below.
 *     Required alongside referenceImageUrl so it displays at the exact
 *     position/scale any AI-detected coordinates were mapped against.
 *   opts.readOnly         - employees: no toolbar, click a room only
 *   opts.roomStats(roomId) -> {done, total, color} | null - for room fill color
 *   opts.onCreate({element_type, geometry, label}) -> Promise<created element w/ id>
 *   opts.onDelete(id) -> Promise
 *   opts.onRoomClick(roomElement)
 */
export const CANVAS_W = 900, CANVAS_H = 600;

// Computes the letterboxed (not cropped) rect an image of naturalW x naturalH
// occupies when fit inside the CANVAS_W x CANVAS_H canvas, centered. Exported
// so callers can map AI-detected normalized (0-1) image coordinates into the
// same canvas space the image is actually displayed in.
export function fitImageRect(naturalW, naturalH) {
  const scale = Math.min(CANVAS_W / naturalW, CANVAS_H / naturalH);
  const width = naturalW * scale, height = naturalH * scale;
  return { x: (CANVAS_W - width) / 2, y: (CANVAS_H - height) / 2, width, height };
}

export function mountFloorPlanEditor(containerEl, opts) {
  const { pixelsPerMeter, referenceImageUrl, referenceImageRect, readOnly, roomStats, onCreate, onDelete, onRoomClick } = opts;
  const W = CANVAS_W, H = CANVAS_H;
  let _tool = "select";
  let _selectedId = null;
  let _drawing = null; // {type, startX, startY, previewEl}
  const _elements = new Map(); // id -> {data, node}

  containerEl.innerHTML = "";
  if (!readOnly) {
    const toolbar = document.createElement("div");
    toolbar.className = "sl-fp-toolbar";
    toolbar.innerHTML = `
      <button type="button" class="btn sl-fp-tool active" data-tool="select"><i data-lucide="mouse-pointer-2"></i> Select</button>
      <button type="button" class="btn sl-fp-tool" data-tool="wall"><i data-lucide="minus"></i> Wall</button>
      <button type="button" class="btn sl-fp-tool" data-tool="door"><i data-lucide="door-open"></i> Door</button>
      <button type="button" class="btn sl-fp-tool" data-tool="window"><i data-lucide="rectangle-horizontal"></i> Window</button>
      <button type="button" class="btn sl-fp-tool" data-tool="room"><i data-lucide="square"></i> Room</button>
      <button type="button" class="btn btn-danger" id="fpDeleteBtn" style="display:none"><i data-lucide="trash-2"></i> Delete Selected</button>
    `;
    containerEl.appendChild(toolbar);
    toolbar.querySelectorAll("[data-tool]").forEach(btn => btn.addEventListener("click", () => setTool(btn.dataset.tool)));
    toolbar.querySelector("#fpDeleteBtn").addEventListener("click", () => deleteSelected());
    window.lucide?.createIcons?.();
  }

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", class: "sl-fp-canvas" });
  svg.style.touchAction = "none";
  const defs = svgEl("defs");
  const pattern = svgEl("pattern", { id: "fpGrid", width: 25, height: 25, patternUnits: "userSpaceOnUse" });
  pattern.appendChild(svgEl("path", { d: "M25 0 L0 0 0 25", fill: "none", stroke: "rgba(255,255,255,0.06)", "stroke-width": 1 }));
  defs.appendChild(pattern);
  svg.appendChild(defs);
  svg.appendChild(svgEl("rect", { width: W, height: H, fill: "url(#fpGrid)" }));
  if (referenceImageUrl && referenceImageRect) {
    svg.appendChild(svgEl("image", {
      href: referenceImageUrl, x: referenceImageRect.x, y: referenceImageRect.y,
      width: referenceImageRect.width, height: referenceImageRect.height,
      opacity: 0.35, preserveAspectRatio: "none",
    }));
  }
  const roomsLayer = svgEl("g"); const wallsLayer = svgEl("g"); const doorsLayer = svgEl("g"); const windowsLayer = svgEl("g"); const previewLayer = svgEl("g");
  svg.appendChild(roomsLayer); svg.appendChild(wallsLayer); svg.appendChild(doorsLayer); svg.appendChild(windowsLayer); svg.appendChild(previewLayer);
  containerEl.appendChild(svg);

  for (const el of opts.elements) renderElement(el);

  function setTool(tool) {
    _tool = tool;
    _selectedId = null;
    updateSelectionUI();
    containerEl.querySelectorAll(".sl-fp-tool").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
  }

  function layerFor(type) {
    return type === "room" ? roomsLayer : type === "wall" ? wallsLayer : type === "door" ? doorsLayer : windowsLayer;
  }

  function distanceMeters(x1, y1, x2, y2) {
    return (Math.hypot(x2 - x1, y2 - y1) / pixelsPerMeter).toFixed(1);
  }

  function renderElement(el) {
    const g = svgEl("g", { class: "sl-fp-element", "data-id": el.id, "data-type": el.element_type });
    if (el.element_type === "room") {
      const { x, y, width, height } = el.geometry;
      const stats = roomStats?.(el.id);
      const color = ROOM_COLORS[stats?.color || "none"];
      g.appendChild(svgEl("rect", { x, y, width, height, fill: color.fill, stroke: color.stroke, "stroke-width": 2, rx: 4 }));
      const label = el.label || "Room";
      const dims = `${(width / pixelsPerMeter).toFixed(1)}m × ${(height / pixelsPerMeter).toFixed(1)}m`;
      const statsText = stats ? ` · ${stats.done}/${stats.total} done` : "";
      const text = svgEl("text", { x: x + width / 2, y: y + height / 2 - 6, "text-anchor": "middle", class: "sl-fp-room-label" });
      text.textContent = label;
      const sub = svgEl("text", { x: x + width / 2, y: y + height / 2 + 12, "text-anchor": "middle", class: "sl-fp-room-sub" });
      sub.textContent = dims + statsText;
      g.appendChild(text); g.appendChild(sub);
      g.style.cursor = "pointer";
      g.addEventListener("click", (e) => { e.stopPropagation(); if (_tool === "select") { onRoomClick?.(el); if (!readOnly) select(el.id); } });
    } else {
      const style = TOOL_STYLES[el.element_type];
      const { x1, y1, x2, y2 } = el.geometry;
      const hit = svgEl("line", { x1, y1, x2, y2, stroke: "transparent", "stroke-width": 16, class: "sl-fp-hit" });
      const line = svgEl("line", { x1, y1, x2, y2, stroke: style.stroke, "stroke-width": style.width, "stroke-linecap": "round" });
      if (style.dash) line.setAttribute("stroke-dasharray", style.dash);
      g.appendChild(hit); g.appendChild(line);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const dimText = svgEl("text", { x: mx, y: my - 8, "text-anchor": "middle", class: "sl-fp-dim-label" });
      dimText.textContent = `${distanceMeters(x1, y1, x2, y2)}m`;
      g.appendChild(dimText);
      g.style.cursor = "pointer";
      g.addEventListener("click", (e) => { e.stopPropagation(); if (_tool === "select" && !readOnly) select(el.id); });
    }
    layerFor(el.element_type).appendChild(g);
    _elements.set(el.id, { data: el, node: g });
  }

  function select(id) {
    _selectedId = id;
    updateSelectionUI();
  }

  function updateSelectionUI() {
    _elements.forEach(({ node }, id) => node.classList.toggle("selected", id === _selectedId));
    const delBtn = containerEl.querySelector("#fpDeleteBtn");
    if (delBtn) delBtn.style.display = _selectedId ? "" : "none";
  }

  async function deleteSelected() {
    if (!_selectedId) return;
    const entry = _elements.get(_selectedId);
    if (!entry) return;
    try {
      await onDelete?.(_selectedId);
      entry.node.remove();
      _elements.delete(_selectedId);
      _selectedId = null;
      updateSelectionUI();
    } catch (e) {
      alert(e.message || "Could not delete element.");
    }
  }

  function toSvgPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * H };
  }

  if (!readOnly) {
    svg.addEventListener("pointerdown", (e) => {
      if (_tool === "select") { select(null); return; }
      const p = toSvgPoint(e.clientX, e.clientY);
      _drawing = { type: _tool, startX: p.x, startY: p.y };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!_drawing) return;
      const p = toSvgPoint(e.clientX, e.clientY);
      previewLayer.innerHTML = "";
      if (_drawing.type === "room") {
        const x = Math.min(_drawing.startX, p.x), y = Math.min(_drawing.startY, p.y);
        const w = Math.abs(p.x - _drawing.startX), h = Math.abs(p.y - _drawing.startY);
        previewLayer.appendChild(svgEl("rect", { x, y, width: w, height: h, fill: "rgba(30,92,255,0.15)", stroke: "#1e5cff", "stroke-width": 2, "stroke-dasharray": "5,4" }));
      } else {
        const style = TOOL_STYLES[_drawing.type];
        previewLayer.appendChild(svgEl("line", { x1: _drawing.startX, y1: _drawing.startY, x2: p.x, y2: p.y, stroke: style.stroke, "stroke-width": style.width, "stroke-dasharray": "5,4" }));
      }
    });
    svg.addEventListener("pointerup", async (e) => {
      if (!_drawing) return;
      const p = toSvgPoint(e.clientX, e.clientY);
      const drawing = _drawing;
      _drawing = null;
      previewLayer.innerHTML = "";

      if (Math.hypot(p.x - drawing.startX, p.y - drawing.startY) < 8) return; // ignore accidental clicks/taps

      let geometry, label = null;
      if (drawing.type === "room") {
        const x = Math.min(drawing.startX, p.x), y = Math.min(drawing.startY, p.y);
        const width = Math.abs(p.x - drawing.startX), height = Math.abs(p.y - drawing.startY);
        if (width < 10 || height < 10) return;
        label = window.prompt("Room name:", "Room");
        if (!label) return;
        geometry = { x, y, width, height };
      } else {
        geometry = { x1: drawing.startX, y1: drawing.startY, x2: p.x, y2: p.y };
      }
      try {
        const created = await onCreate?.({ element_type: drawing.type, geometry, label });
        if (created) renderElement(created);
      } catch (err) {
        alert(err.message || "Could not save element.");
      }
    });
  }

  return {
    destroy() { containerEl.innerHTML = ""; },
  };
}
