// Kiosk mode: a client-side UI state that strips a device down to just the
// employee sign-in screen (+ emergency evacuation access). No company data
// is exposed any differently in kiosk mode — every table/RPC still enforces
// the same RLS/permission checks regardless of this flag. Exiting kiosk mode
// back to full admin UI is gated by a dedicated PIN (separate from the fire
// evacuation PIN — see the migration notes), with a fallback to a full
// SmartCore sign-in if the PIN is wrong or forgotten.

import { sb } from "./supabase.js";
import { getProfile, clearProfileCache, getMyPermissions, hasPermission } from "./auth.js";
import { settings } from "./api.js";
import { esc, toast, modal } from "./ui.js";

const STORAGE_KEY = "smartcore-pfs-kiosk-mode";
const SIGNIN_PAGE = "/systems/presence-fire-safety/employee-signin.html";
const DASHBOARD_PAGE = "/systems/presence-fire-safety/index.html";
const KIOSK_ALLOWED_PAGES = ["employee-signin", "evacuation"];

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
      setKioskModeActive(true);
      if (currentPage && KIOSK_ALLOWED_PAGES.includes(currentPage)) {
        window.location.reload();
      } else {
        window.location.href = SIGNIN_PAGE;
      }
    }
  };
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
 * Exit flow: PIN entry first; on wrong/locked-out PIN, falls back to a full
 * SmartCore email+password sign-in, requiring the newly authenticated user
 * to hold presence.manage_settings before kiosk mode is actually released.
 */
export async function requestExitKioskMode({ companyId }) {
  const overlay = modal(`
    <div class="modal-header"><h3>Exit Kiosk Mode</h3></div>
    <div class="modal-body">
      <p class="text-muted" id="kioskExitIntro">Enter the kiosk exit PIN to return to admin mode.</p>
      <div id="kioskExitAlert" aria-live="assertive"></div>
      <label class="form-label" for="kioskExitPin">Exit PIN</label>
      <input type="password" id="kioskExitPin" class="form-input" inputmode="numeric" pattern="[0-9]*"
             autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="12" aria-label="Kiosk exit PIN"/>
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
      <button class="btn btn-primary" id="kioskExitSubmit">Submit</button>
    </div>
  `, { size: "" });

  const pinInput = overlay.querySelector("#kioskExitPin");
  const alertBox = overlay.querySelector("#kioskExitAlert");
  const fallback = overlay.querySelector("#kioskFallback");
  const submitBtn = overlay.querySelector("#kioskExitSubmit");
  const cancelBtn = overlay.querySelector("#kioskExitCancel");
  pinInput.focus();

  let fallbackShown = false;

  cancelBtn.addEventListener("click", () => overlay.remove());

  submitBtn.addEventListener("click", async () => {
    submitBtn.disabled = true;
    try {
      if (!fallbackShown) {
        const pin = pinInput.value.trim();
        if (!pin) { submitBtn.disabled = false; return; }
        await settings.verifyKioskExitPin(companyId, pin);
        // Success — release kiosk mode and return to the admin dashboard.
        setKioskModeActive(false);
        overlay.remove();
        window.location.href = DASHBOARD_PAGE;
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
        setKioskModeActive(false);
        overlay.remove();
        window.location.href = DASHBOARD_PAGE;
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

  pinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitBtn.click(); });
}
