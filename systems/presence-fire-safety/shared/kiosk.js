// Kiosk mode: a client-side UI state that strips a device down to just the
// employee sign-in screen (+ emergency evacuation access). No company data
// is exposed any differently in kiosk mode — every table/RPC still enforces
// the same RLS/permission checks regardless of this flag. Exiting kiosk mode
// back to full admin UI is gated by a dedicated PIN (separate from the fire
// evacuation PIN — see the migration notes), with a fallback to a full
// SmartCore sign-in if the PIN is wrong or forgotten.

import { sb } from "./supabase.js";
import { getProfile, clearProfileCache, getMyPermissions, hasPermission, getSelectedSiteId } from "./auth.js";
import { settings, devices } from "./api.js";
import { esc, toast, modal, loadingState } from "./ui.js";
import { hideVirtualKeyboard } from "./virtual-keyboard.js";
import { getTheme } from "./theme.js";

// SC mark for the idle screensaver — each file is a solid square tile (not
// transparent), so the dark-mode file has a black background/white mark and
// the light-mode file has a white background/black mark; whichever matches
// the current theme blends into the screensaver's own background.
const SC_ICON_DARK = "/systems/presence-fire-safety/shared/assets/sc-icon-dark.png";
const SC_ICON_LIGHT = "/systems/presence-fire-safety/shared/assets/sc-icon-light.png";

const STORAGE_KEY = "smartcore-pfs-kiosk-mode";
const SIGNIN_PAGE = "/systems/presence-fire-safety/employee-signin.html";
const DASHBOARD_PAGE = "/systems/presence-fire-safety/index.html";
const KIOSK_ALLOWED_PAGES = ["employee-signin", "evacuation", "leaving-check"];

export function isKioskModeActive() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

function setKioskModeActive(active) {
  if (active) localStorage.setItem(STORAGE_KEY, "1");
  else localStorage.removeItem(STORAGE_KEY);
}

/**
 * Call immediately after requirePresenceModuleAccess() resolves, before any
 * other page-specific rendering. If kiosk mode is active and the current
 * page isn't one of the pages kiosk mode is allowed to show, redirects to
 * the sign-in kiosk screen and returns true so the caller can stop.
 */
export function enforceKioskGuard(currentPage) {
  if (isKioskModeActive() && !KIOSK_ALLOWED_PAGES.includes(currentPage)) {
    window.location.replace(SIGNIN_PAGE);
    return true;
  }
  return false;
}

/**
 * Renders the fixed bottom-right kiosk toggle (present on every page) and
 * applies kiosk-mode chrome (hides the sidebar/topbar admin controls) when
 * active. Safe to call multiple times — re-renders in place.
 */
export function initKioskToggle({ companyId, currentPage }) {
  const active = isKioskModeActive();
  document.body.classList.toggle("pfs-kiosk-mode-active", active);

  let el = document.getElementById("pfsKioskToggle");
  if (!el) {
    el = document.createElement("button");
    el.id = "pfsKioskToggle";
    el.type = "button";
    document.body.appendChild(el);
  }
  el.className = "pfs-kiosk-toggle" + (active ? " active" : "");
  el.setAttribute("aria-label", active ? "Exit kiosk mode" : "Enter kiosk mode");
  el.innerHTML = active
    ? `<i data-lucide="lock"></i><span>Exit Kiosk</span>`
    : `<i data-lucide="monitor"></i><span>Kiosk Mode</span>`;
  window.lucide?.createIcons?.();

  el.onclick = async () => {
    if (active) {
      await requestExitKioskMode({ companyId });
    } else {
      await requestEnterKioskMode({ companyId, currentPage });
    }
  };
}

/**
 * Entering kiosk mode offers a choice: continue under the signed-in
 * person's own account (simple, but ties the device to them personally —
 * whoever exits kiosk mode as them lands in a real admin session), or
 * switch to one of this site's registered kiosk device accounts (never
 * tied to a person — see requestExitKioskMode, which forces a genuine
 * sign-in on exit for that case). Skips straight to the "own account" path
 * if no kiosk accounts exist for this site yet, same as the old behaviour.
 */
async function requestEnterKioskMode({ companyId, currentPage }) {
  function proceed() {
    setKioskModeActive(true);
    if (currentPage && KIOSK_ALLOWED_PAGES.includes(currentPage)) {
      window.location.reload();
    } else {
      window.location.href = SIGNIN_PAGE;
    }
  }

  const siteId = getSelectedSiteId();
  let kioskAccounts = [];
  try {
    if (siteId) kioskAccounts = await devices.listKioskAccounts(companyId, siteId);
  } catch {
    /* best-effort — fall through to the simple path below */
  }
  if (!kioskAccounts.length) { proceed(); return; }

  const profile = await getProfile().catch(() => null);
  const overlay = modal(`
    <div class="modal-header"><h3>Enter Kiosk Mode</h3></div>
    <div class="modal-body">
      <p class="text-muted" style="margin-bottom:16px">How should this device sign in?</p>
      <button type="button" class="pfs-kiosk-choice-btn" id="kioskChoiceMe">
        <strong>Continue as ${esc(profile?.full_name || "me")}</strong>
        <span>Uses your own account for this kiosk session.</span>
      </button>
      ${kioskAccounts.length > 1 ? `
        <label class="form-label" for="kioskDeviceSelect" style="margin-top:16px">Kiosk account</label>
        <select class="form-input" id="kioskDeviceSelect">
          ${kioskAccounts.map(d => `<option value="${esc(d.id)}">${esc(d.device_name)}</option>`).join("")}
        </select>
      ` : ""}
      <button type="button" class="pfs-kiosk-choice-btn recommended" id="kioskChoiceDevice" style="margin-top:10px">
        <strong>Use a kiosk account <span class="badge badge-blue">Recommended</span></strong>
        <span>This device's own dedicated login — never tied to you personally. Exiting kiosk mode always requires a real sign-in afterwards.</span>
      </button>
    </div>
    <div class="modal-footer"><button class="btn modal-close" type="button">Cancel</button></div>
  `);
  window.lucide?.createIcons?.();

  overlay.querySelector("#kioskChoiceMe").addEventListener("click", () => {
    overlay.remove();
    proceed();
  });

  overlay.querySelector("#kioskChoiceDevice").addEventListener("click", async (evt) => {
    const btn = evt.currentTarget;
    const deviceId = kioskAccounts.length > 1 ? overlay.querySelector("#kioskDeviceSelect").value : kioskAccounts[0].id;
    const deviceName = kioskAccounts.find((d) => d.id === deviceId)?.device_name || "kiosk";
    btn.disabled = true;
    // Make the account switch visible — it's a real sign-in swap happening
    // silently in the background otherwise, which looks indistinguishable
    // from nothing happening at all.
    overlay.querySelector(".modal-body").innerHTML = loadingState(`Signing in as "${deviceName}"…`);
    overlay.querySelector(".modal-footer")?.remove();
    try {
      const session = await devices.switchToKioskAccount(deviceId);
      const { error } = await sb().auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
      if (error) throw error;
      clearProfileCache();
      await new Promise((r) => setTimeout(r, 600));
      overlay.remove();
      proceed();
    } catch (e) {
      overlay.remove();
      btn.disabled = false;
      toast("error", "Couldn't switch to kiosk account", e.message || "Please try again.");
    }
  });
}

/**
 * A prominent, unmissable link to the evacuation page — kiosk mode hides the
 * sidebar (where this link normally lives), so pages that render kiosk
 * chrome must show this separately. Safe to call even when not in kiosk
 * mode (renders nothing).
 */
export function renderKioskEvacuationBanner(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!isKioskModeActive()) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <a href="/systems/presence-fire-safety/evacuation.html" class="pfs-kiosk-evac-banner">
      <i data-lucide="flame"></i><span>Emergency Evacuation</span>
    </a>`;
  window.lucide?.createIcons?.();
}

/**
 * Releases kiosk mode after a successful PIN/fallback-sign-in exit. A
 * 'kiosk' role is a device's own dedicated account (see
 * requestEnterKioskMode/devices-register.js) — it must never be left
 * sitting in an authenticated admin session, so exiting kiosk mode under
 * one forces a real sign-out back to /modules/ instead of the module
 * dashboard, requiring whoever's there to sign in with their own account.
 */
async function finishExitKioskMode(role) {
  setKioskModeActive(false);
  if (role === "kiosk") {
    await sb().auth.signOut();
    window.location.href = "/modules/";
  } else {
    window.location.href = DASHBOARD_PAGE;
  }
}

/**
 * Exit flow: PIN entry first; on wrong/locked-out PIN, falls back to a full
 * SmartCore email+password sign-in, requiring the newly authenticated user
 * to hold presence.manage_settings before kiosk mode is actually released.
 */
export async function requestExitKioskMode({ companyId }) {
  // Whatever was focused on the underlying kiosk screen (an employee
  // search box, a visitor form field, etc.) never gets blurred just by
  // tapping the kiosk toggle button on some mobile browsers, so its
  // native/virtual keyboard can stay open and visible underneath this
  // modal for a moment. Dismiss it explicitly before rendering anything.
  hideVirtualKeyboard();
  document.activeElement?.blur?.();

  const overlay = modal(`
    <div class="modal-header"><h3>Exit Kiosk Mode</h3></div>
    <div class="modal-body">
      <p class="text-muted" id="kioskExitIntro">Enter the kiosk exit PIN to return to admin mode.</p>
      <div id="kioskExitAlert" aria-live="assertive"></div>
      <div id="kioskExitPin" class="pfs-pin-display" role="textbox" aria-readonly="true" aria-label="Kiosk exit PIN entered"></div>
      <div class="pfs-pin-keypad" role="group" aria-label="PIN keypad">
        ${[1,2,3,4,5,6,7,8,9].map(n => `<button type="button" class="pfs-pin-key" data-key="${n}">${n}</button>`).join("")}
        <button type="button" class="pfs-pin-key pfs-pin-key-clear" data-key="clear">Clear</button>
        <button type="button" class="pfs-pin-key" data-key="0">0</button>
        <button type="button" class="pfs-pin-key" data-key="back" aria-label="Backspace"><i data-lucide="delete"></i></button>
      </div>
      <div id="kioskFallback" style="display:none;margin-top:18px">
        <div class="pfs-divider">or sign in with your SmartCore account</div>
        <label class="form-label" for="kioskEmail">Email</label>
        <input type="email" id="kioskEmail" class="form-input" autocomplete="username"/>
        <label class="form-label" for="kioskPassword" style="margin-top:10px">Password</label>
        <input type="password" id="kioskPassword" class="form-input" autocomplete="current-password"/>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="kioskExitCancel">Cancel</button>
      <button class="btn btn-primary" id="kioskExitSubmit" disabled>Submit</button>
    </div>
  `, { size: "" });

  const pinDisplay = overlay.querySelector("#kioskExitPin");
  const alertBox = overlay.querySelector("#kioskExitAlert");
  const fallback = overlay.querySelector("#kioskFallback");
  const submitBtn = overlay.querySelector("#kioskExitSubmit");
  const cancelBtn = overlay.querySelector("#kioskExitCancel");
  window.lucide?.createIcons?.();

  // Plain div + on-screen keypad, not a real <input> — same reasoning as
  // evacuation.html/leaving-check.html's PIN screens: a real input here
  // (even with inputmode="none") can flash a native or virtual keyboard
  // before this module's own code corrects the layout or dismisses it.
  let pinValue = "";
  function renderPin() { pinDisplay.textContent = pinValue ? "•".repeat(pinValue.length) : ""; }
  function updateSubmitState() { submitBtn.disabled = pinValue.length < 4; }
  overlay.querySelectorAll(".pfs-pin-key").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      if (key === "clear") pinValue = "";
      else if (key === "back") pinValue = pinValue.slice(0, -1);
      else if (pinValue.length < 12) pinValue += key;
      renderPin();
      updateSubmitState();
    });
  });

  let fallbackShown = false;

  cancelBtn.addEventListener("click", () => overlay.remove());

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    try {
      if (!fallbackShown) {
        const pin = pinValue;
        if (!pin) { updateSubmitState(); return; }
        await settings.verifyKioskExitPin(companyId, getSelectedSiteId(), pin);
        overlay.remove();
        const profile = await getProfile().catch(() => null);
        await finishExitKioskMode(profile?.role);
        return;
      }

      // Fallback: full SmartCore sign-in.
      const email = overlay.querySelector("#kioskEmail").value.trim();
      const password = overlay.querySelector("#kioskPassword").value;
      if (!email || !password) { submitBtn.disabled = false; return; }

      const { error: authError } = await sb().auth.signInWithPassword({ email, password });
      if (authError) {
        alertBox.innerHTML = `<p class="form-error">${esc(authError.message || "Sign-in failed.")}</p>`;
        submitBtn.disabled = false;
        return;
      }

      // Re-resolve identity/permissions under the newly signed-in session.
      clearProfileCache();
      const newProfile = await getProfile();
      await getMyPermissions(newProfile.company_id);

      if (hasPermission("presence.manage_settings")) {
        overlay.remove();
        await finishExitKioskMode(newProfile.role);
      } else {
        alertBox.innerHTML = `<p class="form-error">Signed in, but this account doesn't have permission to exit kiosk mode. Ask an owner or administrator.</p>`;
        submitBtn.disabled = false;
        // Session has changed — reload into kiosk mode under the new (still
        // kiosk-restricted) identity rather than leaving stale state around.
        setTimeout(() => window.location.reload(), 2500);
      }
    } catch (e) {
      if (!fallbackShown) {
        fallbackShown = true;
        alertBox.innerHTML = `<p class="form-error">${esc(e.message || "Incorrect PIN.")}</p>`;
        overlay.querySelector("#kioskExitIntro").textContent = "That PIN didn't work.";
        fallback.style.display = "block";
        submitBtn.disabled = false;
        overlay.querySelector("#kioskEmail")?.focus();
      } else {
        alertBox.innerHTML = `<p class="form-error">${esc(e.message || "Something went wrong.")}</p>`;
        submitBtn.disabled = false;
      }
    }
  });
}

// ── Idle screensaver ─────────────────────────────────────────────────────
// Public-facing kiosk devices sit on the same screen for hours at a time,
// which risks OLED/LCD burn-in of the static sign-in UI. After a period of
// no touches/clicks/keys, this shows a full-screen screensaver — a clean
// white backdrop with the company logo, a live clock, and a call to action —
// that gently drifts around (DVD-logo style, but without the neon colour
// cycling) so no pixel stays lit the same way for long. Any interaction
// dismisses it.
let _idleTimer = null;
let _idleOverlay = null;
let _idleBounceRaf = null;
let _idleClockInterval = null;
let _idleInitialized = false;
const IDLE_ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"];

/**
 * @param {object} opts
 *   opts.idleMs   - milliseconds of inactivity before the screensaver shows (default 60000)
 *   opts.text     - the call-to-action text (default "Touch to sign in")
 *   opts.onIdle   - called right before the screensaver appears (e.g. to stop a camera)
 *   opts.onResume - called right after the screensaver is dismissed (e.g. to reset the UI)
 */
export function initIdleScreensaver({ idleMs = 60000, text = "Touch to sign in", onIdle, onResume } = {}) {
  if (_idleInitialized) return;
  _idleInitialized = true;

  function armTimer() {
    if (_idleOverlay) return;
    clearTimeout(_idleTimer);
    _idleTimer = setTimeout(showScreensaver, idleMs);
  }

  function formatClock(d) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function showScreensaver() {
    onIdle?.();
    const scIcon = getTheme() === "light" ? SC_ICON_LIGHT : SC_ICON_DARK;
    _idleOverlay = document.createElement("div");
    _idleOverlay.className = "pfs-screensaver";
    _idleOverlay.innerHTML = `
      <div class="pfs-screensaver-block">
        <img src="${esc(scIcon)}" class="pfs-screensaver-logo" alt="SmartCore"/>
        <div class="pfs-screensaver-clock">${esc(formatClock(new Date()))}</div>
        <div class="pfs-screensaver-text">${esc(text)}</div>
      </div>`;
    document.body.appendChild(_idleOverlay);
    IDLE_ACTIVITY_EVENTS.forEach(ev => _idleOverlay.addEventListener(ev, dismissScreensaver, { once: true }));
    const clockEl = _idleOverlay.querySelector(".pfs-screensaver-clock");
    _idleClockInterval = setInterval(() => { clockEl.textContent = formatClock(new Date()); }, 1000);
    startBounce(_idleOverlay.querySelector(".pfs-screensaver-block"));
  }

  function dismissScreensaver() {
    cancelAnimationFrame(_idleBounceRaf);
    clearInterval(_idleClockInterval);
    _idleOverlay?.remove();
    _idleOverlay = null;
    onResume?.();
    armTimer();
  }

  function startBounce(el) {
    let x = Math.random() * Math.max(0, window.innerWidth - 260);
    let y = Math.random() * Math.max(0, window.innerHeight - 60);
    let vx = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.35);
    let vy = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.35);

    function frame() {
      const rect = el.getBoundingClientRect();
      const maxX = Math.max(0, window.innerWidth - rect.width);
      const maxY = Math.max(0, window.innerHeight - rect.height);
      x += vx;
      y += vy;
      if (x <= 0) { x = 0; vx = Math.abs(vx); }
      else if (x >= maxX) { x = maxX; vx = -Math.abs(vx); }
      if (y <= 0) { y = 0; vy = Math.abs(vy); }
      else if (y >= maxY) { y = maxY; vy = -Math.abs(vy); }
      el.style.transform = `translate(${x}px, ${y}px)`;
      _idleBounceRaf = requestAnimationFrame(frame);
    }
    _idleBounceRaf = requestAnimationFrame(frame);
  }

  IDLE_ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, () => { if (!_idleOverlay) armTimer(); }, { passive: true }));
  armTimer();
}
