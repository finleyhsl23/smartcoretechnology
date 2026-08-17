// Self-contained SVG floor plan canvas for one level: walls, doors, windows
// (line segments) and rooms (rectangles), with live dimensions computed
// from a configurable pixels-per-meter scale. Select an element to drag it
// (rigid move), drag a room's corner handles to resize it, or drag either
// end of a wall/door/window to move that endpoint — all persisted via
// opts.onUpdate as the drag ends.
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

// Shrinks a label's font size until it fits maxWidth (shared canvas context,
// far cheaper than round-tripping through the DOM via getBBox()), then
// truncates with an ellipsis if it still doesn't fit even at minSize.
let _measureCtx = null;
function fitLabel(text, maxWidth, { baseSize = 13, minSize = 7, weight = 700 } = {}) {
  if (!_measureCtx) _measureCtx = document.createElement("canvas").getContext("2d");
  const widthAt = (t, size) => { _measureCtx.font = `${weight} ${size}px Inter, sans-serif`; return _measureCtx.measureText(t).width; };
  let size = baseSize;
  while (size > minSize && widthAt(text, size) > maxWidth) size -= 0.5;
  if (widthAt(text, size) <= maxWidth) return { text, size };
  let truncated = text;
  while (truncated.length > 1 && widthAt(truncated + "…", size) > maxWidth) truncated = truncated.slice(0, -1);
  return { text: truncated.length < text.length ? truncated + "…" : truncated, size };
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
 *   opts.hideMeasurements - hides wall/door/window length labels and room
 *     dimensions entirely (room name + task-completion count still shows)
 *   opts.roomStats(roomId) -> {done, total, color} | null - for room fill color
 *   opts.onCreate({element_type, geometry, label}) -> Promise<created element w/ id>
 *   opts.onDelete(id) -> Promise
 *   opts.onUpdate(id, geometry) -> Promise - called after a move/resize/endpoint drag
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

// Renders the given elements as a plain PNG (data URL) using an offscreen
// <canvas>, purely from vector drawing — no images loaded, so no CORS
// tainting risk when sending it off to the AI verify-floorplan endpoint for
// visual comparison against the original sketch. Mirrors renderElement()'s
// text-fit/rotation logic closely enough that what the AI sees matches what
// mountFloorPlanEditor actually renders on screen.
export function renderSnapshotPNG(elements, { pixelsPerMeter = 50, hideMeasurements = false, referenceImageRect } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#12151c";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  if (referenceImageRect) {
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(referenceImageRect.x, referenceImageRect.y, referenceImageRect.width, referenceImageRect.height);
  }

  for (const el of elements) {
    if (el.element_type !== "room") continue;
    const { x, y, width, height, label_angle } = el.geometry;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 2;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);

    const cx = x + width / 2, cy = y + height / 2;
    const angle = Number(label_angle) || 0;
    const vertical = Math.abs(((angle % 180) + 180) % 180 - 90) < 45;
    const pad = 8;
    const maxTextWidth = Math.max(0, (vertical ? height : width) - pad * 2);
    if (maxTextWidth <= 4) continue;
    const label = fitLabel(el.label || "Room", maxTextWidth, { baseSize: 13, minSize: 7 });
    ctx.save();
    ctx.translate(cx, cy);
    if (angle) ctx.rotate((angle * Math.PI) / 180);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${label.size}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.text, 0, 0);
    if (!hideMeasurements) {
      ctx.font = `500 10px Inter, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.fillText(`${(width / pixelsPerMeter).toFixed(1)}m x ${(height / pixelsPerMeter).toFixed(1)}m`, 0, label.size);
    }
    ctx.restore();
  }

  for (const el of elements) {
    if (el.element_type === "room") continue;
    const style = TOOL_STYLES[el.element_type];
    const { x1, y1, x2, y2 } = el.geometry;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash ? style.dash.split(",").map(Number) : []);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  return canvas.toDataURL("image/png");
}

export function mountFloorPlanEditor(containerEl, opts) {
  const { pixelsPerMeter, referenceImageUrl, referenceImageRect, readOnly, hideMeasurements, roomStats, onCreate, onDelete, onUpdate, onRoomClick } = opts;
  const W = CANVAS_W, H = CANVAS_H;
  let _tool = "select";
  let _selectedId = null;
  let _drawing = null; // {type, startX, startY, previewEl}
  const _elements = new Map(); // id -> {data, node, refs}

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
  const roomsLayer = svgEl("g"); const wallsLayer = svgEl("g"); const doorsLayer = svgEl("g"); const windowsLayer = svgEl("g"); const previewLayer = svgEl("g"); const handlesLayer = svgEl("g");
  svg.appendChild(roomsLayer); svg.appendChild(wallsLayer); svg.appendChild(doorsLayer); svg.appendChild(windowsLayer); svg.appendChild(previewLayer); svg.appendChild(handlesLayer);
  containerEl.appendChild(svg);

  for (const el of opts.elements) renderElement(el);

  function setTool(tool) {
    _tool = tool;
    _selectedId = null;
    updateSelectionUI();
    renderHandles();
    containerEl.querySelectorAll(".sl-fp-tool").forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
  }

  function layerFor(type) {
    return type === "room" ? roomsLayer : type === "wall" ? wallsLayer : type === "door" ? doorsLayer : windowsLayer;
  }

  function distanceMeters(x1, y1, x2, y2) {
    return (Math.hypot(x2 - x1, y2 - y1) / pixelsPerMeter).toFixed(1);
  }

  // Builds the DOM for one element ONCE (persistent node refs stored on the
  // entry), then hands off to layout() to position everything from
  // entry.data.geometry. layout() is re-run — cheaply, no DOM churn — on
  // every drag/resize frame and again on drag end, so live dragging and the
  // final persisted position share exactly one code path.
  function renderElement(el) {
    const g = svgEl("g", { class: "sl-fp-element", "data-id": el.id, "data-type": el.element_type });
    const refs = {};
    if (el.element_type === "room") {
      const rectNode = svgEl("rect", { rx: 4 });
      g.appendChild(rectNode);

      // Clip text to the room's own rectangle — a hard guarantee it can
      // never visually spill into a neighbouring room, on top of (not
      // instead of) shrinking the font to fit below.
      const clipRectNode = svgEl("rect");
      const clip = svgEl("clipPath", { id: `fp-clip-${el.id}` });
      clip.appendChild(clipRectNode);
      defs.appendChild(clip);
      const textGroup = svgEl("g", { "clip-path": `url(#fp-clip-${el.id})` });
      const labelNode = svgEl("text", { "text-anchor": "middle", class: "sl-fp-room-label" });
      const subNode = svgEl("text", { "text-anchor": "middle", class: "sl-fp-room-sub" });
      textGroup.appendChild(labelNode);
      textGroup.appendChild(subNode);
      g.appendChild(textGroup);

      Object.assign(refs, { rectNode, clipRectNode, labelNode, subNode });
      g.style.cursor = "pointer";
      g.addEventListener("click", (e) => { e.stopPropagation(); if (_tool === "select") { onRoomClick?.(el); if (!readOnly) select(el.id); } });
    } else {
      const style = TOOL_STYLES[el.element_type];
      const hitNode = svgEl("line", { stroke: "transparent", "stroke-width": 16, class: "sl-fp-hit" });
      const lineNode = svgEl("line", { stroke: style.stroke, "stroke-width": style.width, "stroke-linecap": "round" });
      if (style.dash) lineNode.setAttribute("stroke-dasharray", style.dash);
      const dimNode = svgEl("text", { "text-anchor": "middle", class: "sl-fp-dim-label" });
      g.appendChild(hitNode); g.appendChild(lineNode); g.appendChild(dimNode);
      Object.assign(refs, { hitNode, lineNode, dimNode });
      g.style.cursor = "pointer";
      g.addEventListener("click", (e) => { e.stopPropagation(); if (_tool === "select" && !readOnly) select(el.id); });
    }
    layerFor(el.element_type).appendChild(g);
    const entry = { data: el, node: g, refs };
    _elements.set(el.id, entry);
    layout(entry);
    return entry;
  }

  function layout(entry) {
    if (entry.data.element_type === "room") layoutRoom(entry); else layoutLine(entry);
  }

  function layoutRoom(entry) {
    const { id, label, geometry } = entry.data;
    const { x, y, width, height, label_angle } = geometry;
    const { rectNode, clipRectNode, labelNode, subNode } = entry.refs;
    const stats = roomStats?.(id);
    const color = ROOM_COLORS[stats?.color || "none"];

    rectNode.setAttribute("x", x); rectNode.setAttribute("y", y);
    rectNode.setAttribute("width", width); rectNode.setAttribute("height", height);
    rectNode.setAttribute("fill", color.fill); rectNode.setAttribute("stroke", color.stroke); rectNode.setAttribute("stroke-width", 2);
    clipRectNode.setAttribute("x", x); clipRectNode.setAttribute("y", y);
    clipRectNode.setAttribute("width", width); clipRectNode.setAttribute("height", height);

    // A rotated label (typically 90°, for a narrow/long room) reads along
    // its own long axis, so the text-fit budget swaps to the room's height
    // instead of its width.
    const cx = x + width / 2, cy = y + height / 2;
    const angle = Number(label_angle) || 0;
    const vertical = Math.abs(((angle % 180) + 180) % 180 - 90) < 45;
    const pad = 8;
    const maxTextWidth = Math.max(0, (vertical ? height : width) - pad * 2);
    if (maxTextWidth <= 4) {
      labelNode.textContent = ""; subNode.textContent = ""; subNode.style.display = "none";
      return;
    }

    const fitted = fitLabel(label || "Room", maxTextWidth, { baseSize: 13, minSize: 7 });
    const subParts = [];
    if (!hideMeasurements) subParts.push(`${(width / pixelsPerMeter).toFixed(1)}m × ${(height / pixelsPerMeter).toFixed(1)}m`);
    if (stats) subParts.push(`${stats.done}/${stats.total} done`);
    const showSub = subParts.length && (vertical ? width : height) >= 34;

    labelNode.setAttribute("x", cx); labelNode.setAttribute("y", cy + (showSub ? -6 : 4));
    labelNode.setAttribute("font-size", fitted.size);
    if (angle) labelNode.setAttribute("transform", `rotate(${angle} ${cx} ${cy})`); else labelNode.removeAttribute("transform");
    labelNode.textContent = fitted.text;

    if (showSub) {
      const sub = fitLabel(subParts.join(" · "), maxTextWidth, { baseSize: 10, minSize: 6, weight: 500 });
      subNode.setAttribute("x", cx); subNode.setAttribute("y", cy + 12);
      subNode.setAttribute("font-size", sub.size);
      if (angle) subNode.setAttribute("transform", `rotate(${angle} ${cx} ${cy})`); else subNode.removeAttribute("transform");
      subNode.textContent = sub.text;
      subNode.style.display = "";
    } else {
      subNode.style.display = "none";
      subNode.textContent = "";
    }
  }

  function layoutLine(entry) {
    const { x1, y1, x2, y2 } = entry.data.geometry;
    const { hitNode, lineNode, dimNode } = entry.refs;
    hitNode.setAttribute("x1", x1); hitNode.setAttribute("y1", y1); hitNode.setAttribute("x2", x2); hitNode.setAttribute("y2", y2);
    lineNode.setAttribute("x1", x1); lineNode.setAttribute("y1", y1); lineNode.setAttribute("x2", x2); lineNode.setAttribute("y2", y2);
    if (!hideMeasurements) {
      dimNode.setAttribute("x", (x1 + x2) / 2); dimNode.setAttribute("y", (y1 + y2) / 2 - 8);
      dimNode.textContent = `${distanceMeters(x1, y1, x2, y2)}m`;
      dimNode.style.display = "";
    } else {
      dimNode.style.display = "none";
    }
  }

  function select(id) {
    _selectedId = id;
    updateSelectionUI();
    renderHandles();
  }

  function updateSelectionUI() {
    _elements.forEach(({ node }, id) => node.classList.toggle("selected", id === _selectedId));
    const delBtn = containerEl.querySelector("#fpDeleteBtn");
    if (delBtn) delBtn.style.display = _selectedId ? "" : "none";
  }

  // Corner handles (drag to resize) for a selected room, or endpoint
  // handles (drag to move that end) for a selected wall/door/window.
  function renderHandles() {
    handlesLayer.innerHTML = "";
    if (!_selectedId || readOnly) return;
    const entry = _elements.get(_selectedId);
    if (!entry) return;
    if (entry.data.element_type === "room") {
      const { x, y, width, height } = entry.data.geometry;
      const corners = { nw: [x, y], ne: [x + width, y], sw: [x, y + height], se: [x + width, y + height] };
      for (const [key, [hx, hy]] of Object.entries(corners)) {
        const h = svgEl("rect", { x: hx - 5, y: hy - 5, width: 10, height: 10, class: "sl-fp-handle", "data-handle": key });
        h.style.cursor = `${key}-resize`;
        handlesLayer.appendChild(h);
      }
    } else {
      const { x1, y1, x2, y2 } = entry.data.geometry;
      for (const [key, hx, hy] of [["p1", x1, y1], ["p2", x2, y2]]) {
        const h = svgEl("circle", { cx: hx, cy: hy, r: 6, class: "sl-fp-handle", "data-handle": key });
        h.style.cursor = "move";
        handlesLayer.appendChild(h);
      }
    }
  }

  async function deleteSelected() {
    if (!_selectedId) return;
    const entry = _elements.get(_selectedId);
    if (!entry) return;
    try {
      await onDelete?.(_selectedId);
      entry.node.remove();
      if (entry.data.element_type === "room") defs.querySelector(`#fp-clip-${_selectedId}`)?.remove();
      _elements.delete(_selectedId);
      _selectedId = null;
      updateSelectionUI();
      renderHandles();
    } catch (e) {
      alert(e.message || "Could not delete element.");
    }
  }

  function toSvgPoint(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * H };
  }

  function translateGeometry(type, geometry, dx, dy) {
    return type === "room"
      ? { ...geometry, x: geometry.x + dx, y: geometry.y + dy }
      : { ...geometry, x1: geometry.x1 + dx, y1: geometry.y1 + dy, x2: geometry.x2 + dx, y2: geometry.y2 + dy };
  }

  // Rigid move: dragged live via a transform on the whole element group (no
  // per-frame reflow needed since nothing but position changes — this also
  // keeps a room's text clip moving in lockstep, since clip-path resolves in
  // the transformed element's coordinate system), then baked into the real
  // geometry and persisted once the drag ends.
  function startMove(entry, e) {
    const start = toSvgPoint(e.clientX, e.clientY);
    let dx = 0, dy = 0, moved = false;
    svg.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const p = toSvgPoint(ev.clientX, ev.clientY);
      dx = p.x - start.x; dy = p.y - start.y;
      if (Math.hypot(dx, dy) > 2) moved = true;
      entry.node.setAttribute("transform", `translate(${dx} ${dy})`);
    };
    const onUp = async () => {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.releasePointerCapture(e.pointerId);
      entry.node.removeAttribute("transform");
      if (!moved) return;
      const prevGeometry = entry.data.geometry;
      entry.data.geometry = translateGeometry(entry.data.element_type, prevGeometry, dx, dy);
      layout(entry); renderHandles();
      try {
        await onUpdate?.(entry.data.id, entry.data.geometry);
      } catch (err) {
        entry.data.geometry = prevGeometry;
        layout(entry); renderHandles();
        alert(err.message || "Could not move element.");
      }
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
  }

  function startResize(entry, handle, e) {
    const orig = { ...entry.data.geometry };
    const MIN = 15;
    svg.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const p = toSvgPoint(ev.clientX, ev.clientY);
      let { x, y, width, height } = orig;
      if (handle.includes("w")) { const nx = Math.min(p.x, orig.x + orig.width - MIN); width = orig.x + orig.width - nx; x = nx; }
      if (handle.includes("e")) { width = Math.max(MIN, p.x - orig.x); }
      if (handle.includes("n")) { const ny = Math.min(p.y, orig.y + orig.height - MIN); height = orig.y + orig.height - ny; y = ny; }
      if (handle.includes("s")) { height = Math.max(MIN, p.y - orig.y); }
      entry.data.geometry = { ...entry.data.geometry, x, y, width, height };
      layout(entry); renderHandles();
    };
    const onUp = async () => {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.releasePointerCapture(e.pointerId);
      try {
        await onUpdate?.(entry.data.id, entry.data.geometry);
      } catch (err) {
        entry.data.geometry = orig;
        layout(entry); renderHandles();
        alert(err.message || "Could not resize room.");
      }
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
  }

  function startEndpointDrag(entry, point, e) {
    const orig = { ...entry.data.geometry };
    svg.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const p = toSvgPoint(ev.clientX, ev.clientY);
      const geom = { ...entry.data.geometry };
      if (point === "p1") { geom.x1 = p.x; geom.y1 = p.y; } else { geom.x2 = p.x; geom.y2 = p.y; }
      entry.data.geometry = geom;
      layout(entry); renderHandles();
    };
    const onUp = async () => {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.releasePointerCapture(e.pointerId);
      try {
        await onUpdate?.(entry.data.id, entry.data.geometry);
      } catch (err) {
        entry.data.geometry = orig;
        layout(entry); renderHandles();
        alert(err.message || "Could not move endpoint.");
      }
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
  }

  if (!readOnly) {
    svg.addEventListener("pointerdown", (e) => {
      const handleTarget = e.target.closest("[data-handle]");
      if (handleTarget && _selectedId) {
        const entry = _elements.get(_selectedId);
        if (entry) {
          if (entry.data.element_type === "room") startResize(entry, handleTarget.dataset.handle, e);
          else startEndpointDrag(entry, handleTarget.dataset.handle, e);
        }
        return;
      }
      if (_tool === "select") {
        const elNode = e.target.closest(".sl-fp-element");
        if (elNode) {
          const id = elNode.dataset.id;
          const entry = _elements.get(id);
          select(id);
          if (entry) startMove(entry, e);
        } else {
          select(null);
        }
        return;
      }
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
