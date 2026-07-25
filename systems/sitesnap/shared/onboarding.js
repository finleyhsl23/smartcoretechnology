// First-sign-in onboarding: a full-screen, unskippable welcome, then real
// browser permission requests (location, camera/mic) with plain-language
// reasons, then a short skippable feature tour. Mounted once by index.html
// after requireSiteSnapAccess() succeeds, gated on
// onboarding.hasCompleted(employeeId) so it only ever runs the first time.
import { onboarding } from "./api.js";
import { getCurrentPosition } from "./geo.js";
import { esc } from "./ui.js";

const STEPS = [
  {
    phase: "welcome",
    icon: "camera",
    title: "Welcome to SiteSnap",
    body: "Proof of work for every job — timestamped, GPS-tagged photos and videos your clients and crew can trust.",
    cta: "Get Started",
  },
  {
    phase: "welcome",
    icon: "sparkles",
    title: "Everything In One Place",
    bullets: [
      "Projects to organise every job site",
      "Checklists, daily logs & task assignment",
      "A permanent, tamper-evident record of the work",
    ],
    cta: "Continue",
  },
  {
    phase: "permission",
    type: "location",
    icon: "map-pin",
    title: "Allow Location Access",
    body: "SiteSnap tags every photo and video with the exact GPS coordinates it was taken at, so there's indisputable proof of where the work happened. Your browser will ask you to confirm.",
    cta: "Allow Location",
  },
  {
    phase: "permission",
    type: "camera",
    icon: "video",
    title: "Allow Camera & Microphone",
    body: "This lets you capture photos and videos straight from the browser — no leaving the app to use your camera roll and upload files by hand.",
    cta: "Allow Camera",
  },
  {
    phase: "demo",
    icon: "layout-dashboard",
    title: "Your Dashboard",
    body: "See active projects, recent captures and anything assigned to you the moment you sign in.",
    cta: "Next",
  },
  {
    phase: "demo",
    icon: "folder-kanban",
    title: "Start With a Project",
    body: "Every photo, checklist, log and task lives under a project — add the site address and drop a pin, or just start typing.",
    cta: "Next",
  },
  {
    phase: "demo",
    icon: "camera",
    title: "Capture In Seconds",
    body: "Open Capture, point, shoot. GPS and timestamp are added automatically — tag it and it's saved to the project instantly.",
    cta: "Next",
  },
  {
    phase: "demo",
    icon: "list-checks",
    title: "Stay On Top Of Everything",
    body: "Checklists with photo evidence, daily logs, and tasks assigned to your crew — all in the project you just saw.",
    cta: "Start Using SiteSnap",
    final: true,
  },
];

/**
 * Runs the full onboarding tour and resolves once the user has completed
 * (or, from the demo phase onward, skipped) it. Always resolves — this is
 * a one-time welcome, never a hard gate on using the product.
 */
export function runOnboarding({ employeeId, companyId }) {
  return new Promise((resolve) => {
    let idx = 0;
    const result = { locationPermission: null, cameraPermission: null, demoSkipped: false };

    const overlay = document.createElement("div");
    overlay.className = "sl-onboard-overlay";
    overlay.innerHTML = `
      <div class="sl-onboard-bg" aria-hidden="true"></div>
      <button class="sl-onboard-close" id="onboardClose" aria-label="Skip demo" style="display:none"><i data-lucide="x"></i></button>
      <div class="sl-onboard-dots" id="onboardDots" role="progressbar"></div>
      <div class="sl-onboard-stage" id="onboardStage"></div>
      <button class="sl-onboard-skip-text" id="onboardSkipText" style="display:none">Skip Demo</button>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => overlay.classList.add("visible"));

    const dotsEl = overlay.querySelector("#onboardDots");
    dotsEl.innerHTML = STEPS.map((_, i) => `<span class="sl-onboard-dot" data-i="${i}"></span>`).join("");

    const closeBtn = overlay.querySelector("#onboardClose");
    const skipTextBtn = overlay.querySelector("#onboardSkipText");
    closeBtn.addEventListener("click", () => skipDemo());
    skipTextBtn.addEventListener("click", () => skipDemo());

    function skipDemo() {
      result.demoSkipped = true;
      finish();
    }

    function updateChrome() {
      const step = STEPS[idx];
      const inDemo = step.phase === "demo";
      closeBtn.style.display = inDemo ? "" : "none";
      skipTextBtn.style.display = inDemo && !step.final ? "" : "none";
      dotsEl.querySelectorAll(".sl-onboard-dot").forEach((d, i) => d.classList.toggle("active", i === idx));
    }

    function render(direction = "in") {
      const step = STEPS[idx];
      updateChrome();
      const stage = overlay.querySelector("#onboardStage");
      const card = document.createElement("div");
      card.className = `sl-onboard-card sl-onboard-${step.phase} entering-${direction}`;
      card.innerHTML = cardHtml(step);
      stage.innerHTML = "";
      stage.appendChild(card);
      requestAnimationFrame(() => card.classList.add("shown"));
      window.lucide?.createIcons?.();
      wireCard(card, step);
    }

    function cardHtml(step) {
      const bullets = step.bullets
        ? `<ul class="sl-onboard-bullets">${step.bullets.map(b => `<li><i data-lucide="check"></i>${esc(b)}</li>`).join("")}</ul>`
        : "";
      const statusArea = step.phase === "permission" ? `<div class="sl-onboard-status" id="permStatus"></div>` : "";
      const skipLink = step.phase === "permission" ? `<button class="sl-onboard-notnow" id="permNotNow">Not now</button>` : "";
      return `
        <div class="sl-onboard-icon-wrap"><i data-lucide="${esc(step.icon)}"></i></div>
        <h2>${esc(step.title)}</h2>
        ${step.body ? `<p>${esc(step.body)}</p>` : ""}
        ${bullets}
        ${statusArea}
        <div class="sl-onboard-actions">
          <button class="btn btn-primary sl-onboard-cta" id="onboardCta">${esc(step.cta)}</button>
          ${skipLink}
        </div>
      `;
    }

    function wireCard(card, step) {
      const ctaBtn = card.querySelector("#onboardCta");

      if (step.phase === "permission") {
        // .onclick (not addEventListener) so reassigning it below to advance()
        // fully replaces this handler instead of running alongside it — with
        // addEventListener, clicking "Continue" would also silently re-fire
        // the permission request in the background on every click.
        ctaBtn.onclick = async () => {
          ctaBtn.disabled = true;
          ctaBtn.textContent = "Requesting…";
          const granted = step.type === "location" ? await requestLocation() : await requestCamera();
          const status = card.querySelector("#permStatus");
          if (step.type === "location") result.locationPermission = granted ? "granted" : "denied";
          else result.cameraPermission = granted ? "granted" : "denied";
          status.innerHTML = granted
            ? `<span class="sl-onboard-status-ok"><i data-lucide="check-circle"></i> Enabled</span>`
            : `<span class="sl-onboard-status-warn"><i data-lucide="alert-circle"></i> Not enabled — you can turn this on later in your browser settings.</span>`;
          window.lucide?.createIcons?.();
          ctaBtn.textContent = "Continue";
          ctaBtn.disabled = false;
          ctaBtn.onclick = () => advance();
        };
        card.querySelector("#permNotNow")?.addEventListener("click", () => {
          if (step.type === "location") result.locationPermission = "skipped";
          else result.cameraPermission = "skipped";
          advance();
        });
      } else {
        ctaBtn.addEventListener("click", () => {
          if (step.final) finish();
          else advance();
        });
      }
    }

    async function requestLocation() {
      const pos = await getCurrentPosition({ timeout: 10000 });
      return !!pos;
    }

    async function requestCamera() {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getTracks().forEach(t => t.stop());
        return true;
      } catch {
        return false;
      }
    }

    function advance() {
      idx += 1;
      render("in");
    }

    function finish() {
      onboarding.markComplete({
        employee_id: employeeId,
        company_id: companyId,
        location_permission: result.locationPermission,
        camera_permission: result.cameraPermission,
        demo_skipped: result.demoSkipped,
      }).catch(() => {});
      overlay.classList.remove("visible");
      setTimeout(() => {
        overlay.remove();
        document.body.style.overflow = "";
        resolve();
      }, 300);
    }

    render();
  });
}
