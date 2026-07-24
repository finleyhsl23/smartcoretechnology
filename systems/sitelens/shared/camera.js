// Live camera photo/video capture for SiteLens. Deliberately does not use
// <input type="file" capture>, which on many browsers just opens the OS
// camera app and hands back a file — this drives an in-page <video> preview
// so the crew can see the shot framing and retake it before it's used.
// Defaults to the rear ("environment") camera since this is job-site
// documentation, not a selfie/visitor kiosk flow.

export function isCameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function startCameraCapture(videoEl, { onError, facingMode = "environment" } = {}) {
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

  function captureBlob(mimeType = "image/jpeg", quality = 0.92) {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx2d = canvas.getContext("2d");
        ctx2d.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error("Could not capture photo")), mimeType, quality);
      } catch (err) {
        reject(err);
      }
    });
  }

  start();
  return { stop, switchCamera, captureBlob, get stream() { return stream; } };
}

/**
 * Renders a complete take/retake photo capture flow into `containerEl`
 * (video preview -> Take Photo -> still preview -> Retake / Use Photo).
 *
 * @param {HTMLElement} containerEl
 * @param {object} opts
 *   opts.onCaptured({blob,width,height}) - called once with the confirmed photo
 *   opts.onCancel()                       - called if the user backs out
 */
export function renderPhotoCaptureStep(containerEl, { onCaptured, onCancel, title = "Take a photo" } = {}) {
  let controller = null;
  let captured = null;

  if (!isCameraSupported()) {
    containerEl.innerHTML = `
      <div class="sl-camera-step">
        <p class="text-muted">Camera not available on this device. Use "Upload from device" instead.</p>
        <button class="btn" type="button" id="camCancelBtn">Cancel</button>
      </div>`;
    containerEl.querySelector("#camCancelBtn").addEventListener("click", () => onCancel?.());
    return { stop() {} };
  }

  renderLive();

  function renderLive() {
    containerEl.innerHTML = `
      <div class="sl-camera-step">
        <p class="form-label" style="margin-bottom:8px">${title}</p>
        <div class="sl-cam-frame" style="margin:0 auto"><video id="camVideo" playsinline muted aria-label="Camera preview"></video></div>
        <div id="camError" role="alert" class="form-error"></div>
        <div class="sl-camera-actions">
          <button class="btn" type="button" id="camSwitchBtn"><i data-lucide="refresh-cw"></i> Switch camera</button>
          <button class="btn btn-primary" type="button" id="camTakeBtn"><i data-lucide="camera"></i> Take Photo</button>
          <button class="btn" type="button" id="camCancelBtn">Cancel</button>
        </div>
      </div>`;
    window.lucide?.createIcons?.();

    const video = containerEl.querySelector("#camVideo");
    controller = startCameraCapture(video, {
      onError: (err) => {
        containerEl.querySelector("#camError").textContent = `Camera error: ${err.message || "could not access camera"}.`;
      },
    });

    containerEl.querySelector("#camSwitchBtn").addEventListener("click", () => controller.switchCamera());
    containerEl.querySelector("#camCancelBtn").addEventListener("click", () => { controller?.stop(); onCancel?.(); });
    containerEl.querySelector("#camTakeBtn").addEventListener("click", async () => {
      try {
        captured = await controller.captureBlob();
        controller.stop();
        renderPreview();
      } catch (err) {
        containerEl.querySelector("#camError").textContent = err.message || "Could not capture photo.";
      }
    });
  }

  function renderPreview() {
    const url = URL.createObjectURL(captured.blob);
    containerEl.innerHTML = `
      <div class="sl-camera-step">
        <p class="form-label" style="margin-bottom:8px">Use this photo?</p>
        <div class="sl-cam-frame" style="margin:0 auto"><img src="${url}" alt="Captured photo preview" style="width:100%;height:100%;object-fit:cover"/></div>
        <div class="sl-camera-actions">
          <button class="btn" type="button" id="camRetakeBtn"><i data-lucide="rotate-ccw"></i> Retake</button>
          <button class="btn btn-primary" type="button" id="camUseBtn"><i data-lucide="check"></i> Use This Photo</button>
        </div>
      </div>`;
    window.lucide?.createIcons?.();
    containerEl.querySelector("#camRetakeBtn").addEventListener("click", () => { URL.revokeObjectURL(url); renderLive(); });
    containerEl.querySelector("#camUseBtn").addEventListener("click", () => onCaptured?.(captured));
  }

  return { stop() { controller?.stop(); } };
}
