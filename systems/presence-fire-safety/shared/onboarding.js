// First-run setup wizard for the Presence & Fire Safety dashboard.
// Checks what a company hasn't configured yet (sites, evacuation PIN, kiosk
// exit PIN) and — only for the admins who can actually fix it — walks them
// through the gaps in a small full-screen wizard with a fade transition
// between steps. Nothing is persisted client-side to "never show again";
// it simply stops appearing once the underlying data says it's configured.
import { sites, settings } from "./api.js";
import { toast, refreshIcons } from "./ui.js";

/** Figures out what's missing. Returns null if there's nothing to do. */
export async function checkOnboarding(companyId) {
  const [siteList, settingsRow] = await Promise.all([
    sites.list(companyId).catch(() => []),
    settings.get(companyId).catch(() => null),
  ]);
  const missing = [];
  if (siteList.length === 0) missing.push("site");
  if (!settingsRow?.evacuation_pin_hash) missing.push("evacuation_pin");
  if (!settingsRow?.kiosk_exit_pin_hash) missing.push("kiosk_pin");
  if (!missing.length) return null;
  return { missing, siteList, settingsRow };
}

/**
 * Runs the wizard. `onSiteAdded` is called (with the new site) right after
 * a site is created, so the caller can refresh its own site list/selection
 * before the wizard's later steps or its own dashboard render need it.
 * Resolves once the wizard is dismissed (finished or closed early).
 */
export function runOnboarding({ companyId, missing, onSiteAdded }) {
  return new Promise((resolve) => {
    const order = ["welcome", ...missing, "done"];
    let idx = 0;
    let settled = false;

    const overlay = document.createElement("div");
    overlay.className = "pfs-onboard-overlay";
    overlay.innerHTML = `
      <div class="pfs-onboard-card" role="dialog" aria-modal="true" aria-label="Finish setting up">
        <button class="pfs-onboard-close icon-btn" type="button" aria-label="Close">&times;</button>
        <div class="pfs-onboard-dots"></div>
        <div class="pfs-onboard-stepwrap"><div class="pfs-onboard-step"></div></div>
      </div>`;
    document.body.appendChild(overlay);

    const dotsEl = overlay.querySelector(".pfs-onboard-dots");
    const stepEl = overlay.querySelector(".pfs-onboard-step");

    overlay.querySelector(".pfs-onboard-close").addEventListener("click", finish);
    overlay.addEventListener("keydown", e => { if (e.key === "Escape") finish(); });

    function finish() {
      if (settled) return;
      settled = true;
      overlay.classList.remove("visible");
      setTimeout(() => { overlay.remove(); resolve(); }, 220);
    }

    function renderDots() {
      dotsEl.innerHTML = order.map((_, i) =>
        `<span class="pfs-onboard-dot ${i === idx ? "active" : i < idx ? "done" : ""}"></span>`
      ).join("");
    }

    function goTo(newIdx) {
      stepEl.classList.add("leaving");
      setTimeout(() => {
        idx = newIdx;
        renderDots();
        renderStep();
        stepEl.classList.remove("leaving");
        stepEl.classList.add("entering");
        requestAnimationFrame(() => requestAnimationFrame(() => stepEl.classList.remove("entering")));
      }, 200);
    }

    function renderStep() {
      const key = order[idx];
      stepEl.innerHTML = STEP_HTML[key]();
      refreshIcons();
      STEP_WIRE[key]?.();
    }

    const STEP_HTML = {
      welcome: () => `
        <div class="pfs-onboard-icon"><i data-lucide="sparkles"></i></div>
        <h2>Let's finish setting up</h2>
        <p class="pfs-onboard-copy">A couple of things still need configuring before Presence &amp; Fire Safety is fully ready to use. It only takes a minute.</p>
        <div class="pfs-onboard-actions">
          <button class="btn btn-primary" id="obNext" type="button">Let's go →</button>
        </div>`,

      site: () => `
        <div class="pfs-onboard-icon"><i data-lucide="map-pin"></i></div>
        <h2>Add your first site</h2>
        <p class="pfs-onboard-copy">Sites are the buildings or locations you'll track sign-ins, visitors and evacuations for.</p>
        <label class="form-label" for="obSiteName">Site name</label>
        <input class="form-input" id="obSiteName" placeholder="e.g. Head Office" style="margin-bottom:12px" autofocus/>
        <label class="form-label" for="obSiteAssembly">Assembly point (optional)</label>
        <input class="form-input" id="obSiteAssembly" placeholder="e.g. Car park, north gate"/>
        <div class="form-error" id="obSiteError" role="alert" style="margin-top:10px"></div>
        <div class="pfs-onboard-actions">
          <button class="btn" id="obSkip" type="button">Skip for now</button>
          <button class="btn btn-primary" id="obNext" type="button">Add Site →</button>
        </div>`,

      evacuation_pin: () => `
        <div class="pfs-onboard-icon"><i data-lucide="flame"></i></div>
        <h2>Set an Evacuation PIN</h2>
        <p class="pfs-onboard-copy">4–12 digits. This unlocks the emergency evacuation screen — share it only with designated fire marshals.</p>
        <label class="form-label" for="obPin1">New PIN</label>
        <input type="password" id="obPin1" class="form-input" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12" style="margin-bottom:12px"/>
        <label class="form-label" for="obPin2">Confirm PIN</label>
        <input type="password" id="obPin2" class="form-input" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12"/>
        <div class="form-error" id="obPinError" role="alert" style="margin-top:10px"></div>
        <div class="pfs-onboard-actions">
          <button class="btn" id="obSkip" type="button">Skip for now</button>
          <button class="btn btn-primary" id="obNext" type="button">Save PIN →</button>
        </div>`,

      kiosk_pin: () => `
        <div class="pfs-onboard-icon"><i data-lucide="monitor"></i></div>
        <h2>Set a Kiosk Exit PIN <span class="pfs-onboard-optional">Optional</span></h2>
        <p class="pfs-onboard-copy">Only needed if you plan to use Kiosk Mode on a shared device. It's used to exit back to admin mode, and is deliberately separate from the Evacuation PIN.</p>
        <label class="form-label" for="obKPin1">New PIN</label>
        <input type="password" id="obKPin1" class="form-input" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12" style="margin-bottom:12px"/>
        <label class="form-label" for="obKPin2">Confirm PIN</label>
        <input type="password" id="obKPin2" class="form-input" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12"/>
        <div class="form-error" id="obKPinError" role="alert" style="margin-top:10px"></div>
        <div class="pfs-onboard-actions">
          <button class="btn" id="obSkip" type="button">Skip for now</button>
          <button class="btn btn-primary" id="obNext" type="button">Save PIN →</button>
        </div>`,

      done: () => `
        <div class="pfs-onboard-icon pfs-onboard-icon-good"><i data-lucide="check-circle-2"></i></div>
        <h2>You're all set</h2>
        <p class="pfs-onboard-copy">Anything you skipped can always be finished later from Settings.</p>
        <div class="pfs-onboard-actions">
          <button class="btn btn-primary" id="obDone" type="button">Go to dashboard →</button>
        </div>`,
    };

    const STEP_WIRE = {
      welcome: () => {
        stepEl.querySelector("#obNext").addEventListener("click", () => goTo(idx + 1));
      },

      site: () => {
        stepEl.querySelector("#obSkip").addEventListener("click", () => goTo(idx + 1));
        stepEl.querySelector("#obNext").addEventListener("click", async () => {
          const errEl = stepEl.querySelector("#obSiteError");
          const name = stepEl.querySelector("#obSiteName").value.trim();
          errEl.textContent = "";
          if (!name) { errEl.textContent = "Site name is required."; return; }
          const assembly = stepEl.querySelector("#obSiteAssembly").value.trim();
          const btn = stepEl.querySelector("#obNext");
          btn.disabled = true;
          btn.textContent = "Adding…";
          try {
            const site = await sites.create(companyId, {
              name,
              timezone: "Europe/London",
              is_default: true,
              is_active: true,
              assembly_point: assembly || null,
            });
            toast("success", "Site added");
            onSiteAdded?.(site);
            goTo(idx + 1);
          } catch (e) {
            errEl.textContent = e.message || "Couldn't add this site.";
            btn.disabled = false;
            btn.textContent = "Add Site →";
          }
        });
      },

      evacuation_pin: () => {
        stepEl.querySelector("#obSkip").addEventListener("click", () => goTo(idx + 1));
        stepEl.querySelector("#obNext").addEventListener("click", async () => {
          const errEl = stepEl.querySelector("#obPinError");
          const pin = stepEl.querySelector("#obPin1").value;
          const confirmPin = stepEl.querySelector("#obPin2").value;
          errEl.textContent = "";
          if (!/^[0-9]{4,12}$/.test(pin)) { errEl.textContent = "PIN must be 4–12 digits."; return; }
          if (pin !== confirmPin) { errEl.textContent = "PINs don't match."; return; }
          const btn = stepEl.querySelector("#obNext");
          btn.disabled = true;
          btn.textContent = "Saving…";
          try {
            await settings.setEvacuationPin(companyId, pin);
            toast("success", "Evacuation PIN set");
            goTo(idx + 1);
          } catch (e) {
            errEl.textContent = e.message || "Couldn't set PIN.";
            btn.disabled = false;
            btn.textContent = "Save PIN →";
          }
        });
      },

      kiosk_pin: () => {
        stepEl.querySelector("#obSkip").addEventListener("click", () => goTo(idx + 1));
        stepEl.querySelector("#obNext").addEventListener("click", async () => {
          const errEl = stepEl.querySelector("#obKPinError");
          const pin = stepEl.querySelector("#obKPin1").value;
          const confirmPin = stepEl.querySelector("#obKPin2").value;
          errEl.textContent = "";
          if (!/^[0-9]{4,12}$/.test(pin)) { errEl.textContent = "PIN must be 4–12 digits."; return; }
          if (pin !== confirmPin) { errEl.textContent = "PINs don't match."; return; }
          const btn = stepEl.querySelector("#obNext");
          btn.disabled = true;
          btn.textContent = "Saving…";
          try {
            await settings.setKioskExitPin(companyId, pin);
            toast("success", "Kiosk exit PIN set");
            goTo(idx + 1);
          } catch (e) {
            errEl.textContent = e.message || "Couldn't set PIN.";
            btn.disabled = false;
            btn.textContent = "Save PIN →";
          }
        });
      },

      done: () => {
        stepEl.querySelector("#obDone").addEventListener("click", finish);
      },
    };

    renderDots();
    renderStep();
    requestAnimationFrame(() => overlay.classList.add("visible"));
  });
}
