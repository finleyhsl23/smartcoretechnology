// QR badge scanning for Presence & Fire Safety.
// Uses the native BarcodeDetector API where available (faster, no extra
// decode work), and otherwise falls back to jsQR (shared/jsqr-lib.js,
// vendored — see that file for license) decoding frames drawn to an
// offscreen canvas. Between the two, camera-based scanning works in every
// browser that can grant camera access, including Safari and Firefox.

export function isBarcodeDetectorSupported() {
  return "BarcodeDetector" in window;
}

/** Whether camera-based QR scanning can work at all in this browser. */
export function isQrScanningSupported() {
  return isBarcodeDetectorSupported() || typeof window.jsQR === "function";
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
  let canvas = null;
  let ctx = null;
  let rafId = null;
  let lastValue = null;
  let lastAt = 0;
  let currentFacing = facingMode;
  let stopped = false;
  const useNative = isBarcodeDetectorSupported();

  async function start() {
    if (!useNative && typeof window.jsQR !== "function") {
      onError?.(new Error("QR_SCANNING_UNSUPPORTED"));
      return;
    }
    try {
      if (useNative) {
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      } else {
        canvas = document.createElement("canvas");
        ctx = canvas.getContext("2d", { willReadFrequently: true });
      }
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
        const value = useNative ? await detectNative() : detectWithJsQr();
        if (value) {
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

  async function detectNative() {
    const codes = await detector.detect(videoEl);
    return codes.length ? codes[0].rawValue : null;
  }

  function detectWithJsQr() {
    const w = videoEl.videoWidth;
    const h = videoEl.videoHeight;
    if (!w || !h) return null;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.drawImage(videoEl, 0, 0, w, h);
    const frame = ctx.getImageData(0, 0, w, h);
    const result = window.jsQR(frame.data, w, h, { inversionAttempts: "dontInvert" });
    return result?.data || null;
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
