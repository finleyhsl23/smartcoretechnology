// QR badge scanning for Presence & Fire Safety.
// Uses the native BarcodeDetector API where available; callers must always
// provide a manual-entry fallback since BarcodeDetector is not universal
// (notably absent in Firefox and Safari at time of writing).

export function isBarcodeDetectorSupported() {
  return "BarcodeDetector" in window;
}

/**
 * Starts a camera-based QR scanner inside `videoEl`.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {object} opts
 *   opts.onDetect(value)     - called with the decoded text, debounced
 *   opts.onError(err)        - called on camera/permission errors
 *   opts.debounceMs          - minimum gap between repeat detections of the
 *                              same value (default 2500ms) to avoid double-scans
 *   opts.facingMode          - 'environment' (rear, default) or 'user' (front)
 *
 * Returns a controller: { stop(), switchCamera() }
 */
export function startQrScanner(videoEl, { onDetect, onError, debounceMs = 2500, facingMode = "environment" } = {}) {
  let stream = null;
  let detector = null;
  let rafId = null;
  let lastValue = null;
  let lastAt = 0;
  let currentFacing = facingMode;
  let stopped = false;

  async function start() {
    if (!isBarcodeDetectorSupported()) {
      onError?.(new Error("BARCODE_DETECTOR_UNSUPPORTED"));
      return;
    }
    try {
      detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing },
        audio: false,
      });
      videoEl.srcObject = stream;
      await videoEl.play();
      tick();
    } catch (err) {
      onError?.(err);
    }
  }

  async function tick() {
    if (stopped) return;
    try {
      if (videoEl.readyState >= 2) {
        const codes = await detector.detect(videoEl);
        if (codes.length) {
          const value = codes[0].rawValue;
          const now = Date.now();
          if (value !== lastValue || now - lastAt > debounceMs) {
            lastValue = value;
            lastAt = now;
            onDetect?.(value);
          }
        }
      }
    } catch (err) {
      // Detection errors are usually transient (frame not ready) — don't stop the loop.
    }
    rafId = requestAnimationFrame(tick);
  }

  function stop() {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    stream?.getTracks()?.forEach(t => t.stop());
    if (videoEl) videoEl.srcObject = null;
  }

  async function switchCamera() {
    currentFacing = currentFacing === "environment" ? "user" : "environment";
    stream?.getTracks()?.forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacing }, audio: false });
    videoEl.srcObject = stream;
    await videoEl.play();
  }

  start();
  return { stop, switchCamera };
}
