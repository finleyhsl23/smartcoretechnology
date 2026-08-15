// Custom on-screen keyboard for kiosk (tablet) devices — Android's native
// keyboard resizes/reflows the whole page when it appears, squishing the
// kiosk layout. This suppresses it (inputmode="none") and draws our own
// fixed-bottom keyboard instead, so the layout stays put and the keys are
// sized for touch rather than whatever the OS defaults to.
//
// Usage: call initVirtualKeyboard() once per page, in Kiosk Mode only — a
// MutationObserver watches the whole document for eligible <input>s (the
// kiosk forms re-render via innerHTML on every tab switch/step) and wires
// each one up automatically, so no per-input changes are needed anywhere
// else, including inputs inside modals (e.g. the kiosk exit PIN prompt).

import { esc } from "./ui.js";

const ELIGIBLE_SELECTOR = 'input[type="text"], input[type="email"], input[type="tel"], input[type="search"], input[type="password"], input:not([type]), textarea';

const QWERTY_NUM = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const QWERTY_R1 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
const QWERTY_R2 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const QWERTY_R3 = ["z", "x", "c", "v", "b", "n", "m"];
const SYMBOLS_R1 = ["@", "#", "$", "&", "*", "(", ")", "-", "_", "+"];
const SYMBOLS_R2 = ["/", ";", ":", "'", '"', "!", "?", ",", "."];

let _panel = null;
let _activeInput = null;
let _shiftOn = false;
let _symbolsOn = false;
let _enabled = false;
let _hideTimer = null;
let _autoHideTimer = null;
const AUTO_HIDE_MS = 30000; // put the keyboard away after 30s of not being tapped

function isEligible(el) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  if (el.disabled || el.readOnly) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  const type = (el.type || "text").toLowerCase();
  return ["text", "email", "tel", "search", "password"].includes(type);
}

function isNumericInput(el) {
  return el.inputMode === "numeric" || el.getAttribute("pattern") === "[0-9]*";
}

function insertText(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function backspace(input) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  if (start !== end) {
    input.value = input.value.slice(0, start) + input.value.slice(end);
    input.setSelectionRange(start, start);
  } else if (start > 0) {
    input.value = input.value.slice(0, start - 1) + input.value.slice(start);
    input.setSelectionRange(start - 1, start - 1);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function keyBtn(char) {
  return `<button type="button" class="pfs-vk-key" data-key="${esc(char)}" tabindex="-1">${esc(char)}</button>`;
}
function specialBtn(action, label, active, extraClass) {
  return `<button type="button" class="pfs-vk-special ${active ? "pfs-vk-active" : ""} ${extraClass || ""}" data-action="${esc(action)}" tabindex="-1">${esc(label)}</button>`;
}

function renderQwertyRows() {
  // Fields like the employee code or vehicle registration are always
  // stored/displayed as capitals (see forceUppercase() in the pages that
  // use this) — showing lowercase key labels for those would be
  // misleading about what you're about to type, so the keys themselves
  // stay permanently capitalised too, with no shift toggle needed (or
  // shown) for fields that never have a lowercase form anyway.
  const forceUpper = _activeInput?.dataset.vkUppercase === "1";
  const caseIt = (s) => (_shiftOn || forceUpper ? s.toUpperCase() : s);
  return `
    <div class="pfs-vk-row">${QWERTY_NUM.map(keyBtn).join("")}</div>
    <div class="pfs-vk-row">${QWERTY_R1.map((k) => keyBtn(caseIt(k))).join("")}</div>
    <div class="pfs-vk-row">${QWERTY_R2.map((k) => keyBtn(caseIt(k))).join("")}</div>
    <div class="pfs-vk-row">
      ${forceUpper ? "" : specialBtn("shift", "⇧", _shiftOn)}
      ${QWERTY_R3.map((k) => keyBtn(caseIt(k))).join("")}
      ${specialBtn("backspace", "⌫")}
    </div>`;
}

function renderSymbolRows() {
  return `
    <div class="pfs-vk-row">${QWERTY_NUM.map(keyBtn).join("")}</div>
    <div class="pfs-vk-row">${SYMBOLS_R1.map(keyBtn).join("")}</div>
    <div class="pfs-vk-row">
      ${SYMBOLS_R2.map(keyBtn).join("")}
      ${specialBtn("backspace", "⌫")}
    </div>`;
}

function renderNumericRows() {
  const grid = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]];
  return `
    ${grid.map((row) => `<div class="pfs-vk-row">${row.map(keyBtn).join("")}</div>`).join("")}
    <div class="pfs-vk-row">
      ${specialBtn("clear", "Clear")}
      ${keyBtn("0")}
      ${specialBtn("backspace", "⌫")}
    </div>`;
}

function renderPanel() {
  const layout = _activeInput?.dataset.vkLayout;
  const bottomRow = layout === "numeric"
    ? `<div class="pfs-vk-row pfs-vk-bottom">${specialBtn("done", "Done", false, "pfs-vk-done")}</div>`
    : `<div class="pfs-vk-row pfs-vk-bottom">
        ${specialBtn("toggle-symbols", _symbolsOn ? "ABC" : "123")}
        ${specialBtn("space", "space", false, "pfs-vk-space")}
        ${specialBtn("done", "Done", false, "pfs-vk-done")}
      </div>`;
  const keyRows = layout === "numeric" ? renderNumericRows() : (_symbolsOn ? renderSymbolRows() : renderQwertyRows());

  _panel.innerHTML = `<div class="pfs-vk-keys">${keyRows}${bottomRow}</div>`;

  _panel.querySelectorAll("[data-key]").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); handleKey(btn.dataset.key); });
  });
  _panel.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); handleAction(btn.dataset.action); });
  });
}

function handleKey(char) {
  if (!_activeInput) return;
  scheduleAutoHide();
  insertText(_activeInput, char);
}

function handleAction(action) {
  if (!_activeInput) return;
  scheduleAutoHide();
  if (action === "backspace") backspace(_activeInput);
  else if (action === "space") insertText(_activeInput, " ");
  else if (action === "clear") { _activeInput.value = ""; _activeInput.dispatchEvent(new Event("input", { bubbles: true })); }
  else if (action === "shift") { _shiftOn = !_shiftOn; renderPanel(); }
  else if (action === "toggle-symbols") { _symbolsOn = !_symbolsOn; renderPanel(); }
  else if (action === "done") { const el = _activeInput; hideKeyboard(); el.blur(); }
}

/** (Re)starts the 30s-of-no-taps countdown that puts the keyboard away on
 *  its own — called on open and on every key/action tap so it only ever
 *  fires after a genuine idle stretch, never mid-typing. */
function scheduleAutoHide() {
  clearTimeout(_autoHideTimer);
  _autoHideTimer = setTimeout(() => {
    const el = _activeInput;
    hideKeyboard();
    el?.blur();
  }, AUTO_HIDE_MS);
}

function updateHeightVar() {
  requestAnimationFrame(() => {
    const h = _panel?.classList.contains("pfs-vk-open") ? _panel.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty("--pfs-vkeyboard-height", `${h}px`);
  });
}

function showKeyboardFor(el) {
  clearTimeout(_hideTimer);
  _activeInput = el;
  _shiftOn = false;
  _symbolsOn = false;
  renderPanel();
  _panel.classList.add("pfs-vk-open");
  _panel.setAttribute("aria-hidden", "false");
  // Pages opt into extra "typing" chrome (hiding banners/QR scanners,
  // anchoring content near the top instead of centered) by styling off
  // this body class — see employee-signin.html's #kioskEvacBanner/QR rules.
  document.body.classList.add("pfs-vk-typing");
  updateHeightVar();
  requestAnimationFrame(() => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  scheduleAutoHide();
}

function scheduleHide() {
  // Short delay so tabbing straight from one prepared input to another
  // doesn't flash the keyboard closed and immediately re-open.
  clearTimeout(_hideTimer);
  _hideTimer = setTimeout(hideKeyboard, 120);
}

function hideKeyboard() {
  clearTimeout(_autoHideTimer);
  _activeInput = null;
  _panel?.classList.remove("pfs-vk-open");
  _panel?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("pfs-vk-typing");
  updateHeightVar();
}

function prepareInput(el) {
  if (!isEligible(el) || el.dataset.vkPrepared) return;
  el.dataset.vkPrepared = "1";
  el.dataset.vkLayout = isNumericInput(el) ? "numeric" : "qwerty";
  // inputmode="none" alone isn't reliably respected by Android on
  // type="email"/type="tel" inputs — some Chrome/WebView versions still
  // show their own specialized keyboard for those types regardless of the
  // hint. Switching them to type="text" (safe here — validation on these
  // kiosk fields is all done in JS, nothing relies on native email/tel
  // constraint checking) is the combination that's actually reliable.
  if (el.type === "email" || el.type === "tel") el.type = "text";
  el.setAttribute("inputmode", "none");
  el.addEventListener("focus", () => showKeyboardFor(el));
  el.addEventListener("blur", scheduleHide);
  // inputmode="none" only suppresses the OS's own on-screen keyboard — a
  // kiosk tablet with a physical keyboard docked can still type directly,
  // which should count as "being used" just as much as tapping our keys.
  el.addEventListener("input", () => { if (_activeInput === el) scheduleAutoHide(); });
}

function scan(root) {
  if (root.matches?.(ELIGIBLE_SELECTOR)) prepareInput(root);
  root.querySelectorAll?.(ELIGIBLE_SELECTOR).forEach(prepareInput);
}

/** Prepares + focuses an input together. Plain el.focus() right after an
 *  input is inserted can flash the native keyboard briefly first — the
 *  MutationObserver below picks up new inputs via a microtask, which runs
 *  after focus() if focus() is called synchronously in the same script (the
 *  common "render form, then autofocus its first field" pattern). Calling
 *  this instead guarantees inputmode="none" is set before focus happens.
 *  Safe to call even if initVirtualKeyboard() was never run on this page
 *  (falls back to a plain focus()). */
export function focusWithKeyboard(el) {
  if (!el) return;
  if (_enabled) prepareInput(el);
  el.focus();
}

/** Closes the keyboard right away and blurs whatever's focused, skipping
 *  both the normal blur debounce and the 30s auto-hide countdown — for
 *  callers that need it gone immediately rather than waiting for either,
 *  e.g. the idle screensaver: it shouldn't ever be sitting open underneath
 *  that. Safe to call whether or not the keyboard is currently showing. */
export function hideVirtualKeyboard() {
  clearTimeout(_hideTimer);
  const el = _activeInput;
  hideKeyboard();
  el?.blur();
}

/** Call once per page (Kiosk Mode only — a physical keyboard is normal for
 *  regular admin use of the same pages). Idempotent. */
export function initVirtualKeyboard() {
  if (_enabled || typeof document === "undefined") return;
  _enabled = true;

  _panel = document.createElement("div");
  _panel.className = "pfs-vkeyboard";
  _panel.setAttribute("aria-hidden", "true");
  document.body.appendChild(_panel);

  scan(document.body);
  new MutationObserver((mutations) => {
    for (const m of mutations) m.addedNodes.forEach((node) => { if (node.nodeType === 1) scan(node); });
  }).observe(document.body, { childList: true, subtree: true });
}
