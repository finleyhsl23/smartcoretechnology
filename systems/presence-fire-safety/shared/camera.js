// Live camera photo capture for Presence & Fire Safety (visitor/contractor
// photos). Deliberately does not use <input type="file" capture>, which on
// many browsers just opens the OS camera app and hands back a file — this
// module drives an in-page <video> preview so the person can see the shot
// framing and retake it before it's used, matching a real kiosk/reception
// experience.

/**
 * Starts a live camera preview inside `videoEl`.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {object} opts
 *   opts.onError(err)  - called on camera/permission errors
 *   opts.facingMode     - 'environment' (rear) or 'user' (front, default —
 *                          visitor/contractor photos are typically taken by
 *                          someone facing the device)
 *
 * Returns a controller: { stop(), switchCamera(), captureBlob(mimeType) }
 */
export function startCameraCapture(videoEl, { onError, facingMode = "user" } = {}) {
  let stream = null;
  let currentFacing = facingMode;

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing }, audio: false });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (err) {
      onError?.(err);
    }
  }

  function stop() {
    stream?.getTracks()?.forEach(t => t.stop());
    if (videoEl) videoEl.srcObject = null;
  }

  async function switchCamera() {
    currentFacing = currentFacing === "environment" ? "user" : "environment";
    stream?.getTracks()?.forEach(t => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing }, audio: false });
      videoEl.srcObject = stream;
      await videoEl.play();
    } catch (err) {
      onError?.(err);
    }
  }

  /** Captures the current video frame as a Blob (default image/jpeg). */
  function captureBlob(mimeType = "image/jpeg", quality = 0.9) {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx2d = canvas.getContext("2d");
        ctx2d.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not capture photo")), mimeType, quality);
      } catch (err) {
        reject(err);
      }
    });
  }

  start();
  return { stop, switchCamera, captureBlob };
}

export function isCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Renders a complete take/retake photo capture flow into `containerEl`
 * (video preview -> Take Picture -> still preview -> Retake / Use Photo).
 * Reused by the visitor and contractor sign-in forms and the kiosk
 * equivalents, so the capture experience is identical everywhere it appears.
 *
 * @param {HTMLElement} containerEl
 * @param {object} opts
 *   opts.onCaptured(blob) - called once with the confirmed photo Blob
 *   opts.onSkip()         - called if the person chooses not to take a photo
 *   opts.title            - heading text (default "Take a photo")
 */
export function renderPhotoCaptureStep(containerEl, { onCaptured, onSkip, title = "Take a photo" } = {}) {
  let controller = null;
  let capturedBlob = null;

  if (!isCameraSupported()) {
    containerEl.innerHTML = `
      <div class="pfs-camera-step">
        <p class="text-muted">Camera not available on this device.</p>
        <button class="btn" type="button" id="camSkipBtn">Continue without a photo</button>
      </div>`;
    containerEl.querySelector("#camSkipBtn").addEventListener("click", () => onSkip?.());
    return { stop() {} };
  }

  renderLive();

  function renderLive() {
    containerEl.innerHTML = `
      <div class="pfs-camera-step">
        <p class="form-label" style="margin-bottom:8px">${title}</p>
        <div class="pfs-qr-frame" style="margin:0 auto"><video id="camVideo" playsinline muted aria-label="Camera preview"></video></div>
        <div id="camError" role="alert" class="form-error"></div>
        <div class="pfs-camera-actions">
          <button class="btn" type="button" id="camSwitchBtn">Switch camera</button>
          <button class="btn btn-primary" type="button" id="camTakeBtn">Take Picture</button>
          <button class="btn" type="button" id="camSkipBtn">Skip photo</button>
        </div>
      </div>`;

    const video = containerEl.querySelector("#camVideo");
    controller = startCameraCapture(video, {
      facingMode: "user",
      onError: (err) => {
        containerEl.querySelector("#camError").textContent = `Camera error: ${err.message || "could not access camera"}.`;
      },
    });

    containerEl.querySelector("#camSwitchBtn").addEventListener("click", () => controller.switchCamera());
    containerEl.querySelector("#camSkipBtn").addEventListener("click", () => { controller?.stop(); onSkip?.(); });
    containerEl.querySelector("#camTakeBtn").addEventListener("click", async () => {
      try {
        capturedBlob = await controller.captureBlob();
        controller.stop();
        renderPreview();
      } catch (err) {
        containerEl.querySelector("#camError").textContent = err.message || "Could not capture photo.";
      }
    });
  }

  function renderPreview() {
    const url = URL.createObjectURL(capturedBlob);
    containerEl.innerHTML = `
      <div class="pfs-camera-step">
        <p class="form-label" style="margin-bottom:8px">Use this photo?</p>
        <div class="pfs-qr-frame" style="margin:0 auto"><img src="${url}" alt="Captured photo preview" style="width:100%;height:100%;object-fit:cover"/></div>
        <div class="pfs-camera-actions">
          <button class="btn" type="button" id="camRetakeBtn">Retake</button>
          <button class="btn btn-primary" type="button" id="camUseBtn">Use This Photo</button>
        </div>
      </div>`;
    containerEl.querySelector("#camRetakeBtn").addEventListener("click", () => { URL.revokeObjectURL(url); renderLive(); });
    containerEl.querySelector("#camUseBtn").addEventListener("click", () => onCaptured?.(capturedBlob));
  }

  return { stop() { controller?.stop(); } };
}
