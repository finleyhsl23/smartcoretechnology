// Foreground geofence watcher for an active shift. Web apps cannot track
// location while backgrounded or the screen is locked — no browser exposes
// that — so this watches continuously while the page is open/visible, pings
// the server (which does the actual radius check) on an interval, and forces
// an immediate re-check the moment the page becomes visible again after
// being backgrounded, so leaving the site is caught as soon as the app is
// back in front of the user.
import { shifts } from "./shifts.js";
import { getCurrentPosition, isGeoSupported } from "./geo.js";

const PING_INTERVAL_MS = 25000;

export function startGeofenceWatch(shiftId, { onPing, onAutoSignOut, onError } = {}) {
  let watchId = null;
  let lastPingAt = 0;
  let pinging = false;
  let stopped = false;

  async function sendPing(lat, lng) {
    if (pinging || stopped) return;
    pinging = true;
    lastPingAt = Date.now();
    try {
      const updated = await shifts.ping(shiftId, lat, lng);
      if (stopped) return;
      onPing?.(updated);
      if (updated.status === "closed") {
        stop();
        onAutoSignOut?.(updated);
      }
    } catch (e) {
      onError?.(e);
    } finally {
      pinging = false;
    }
  }

  function handlePosition(pos) {
    if (Date.now() - lastPingAt >= PING_INTERVAL_MS) {
      sendPing(pos.coords.latitude, pos.coords.longitude);
    }
  }

  function handleVisibility() {
    if (stopped || document.visibilityState !== "visible") return;
    getCurrentPosition({ timeout: 8000 }).then((pos) => { if (pos) sendPing(pos.latitude, pos.longitude); });
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    document.removeEventListener("visibilitychange", handleVisibility);
  }

  if (isGeoSupported()) {
    watchId = navigator.geolocation.watchPosition(handlePosition, (e) => onError?.(e), {
      enableHighAccuracy: true, maximumAge: 10000, timeout: 20000,
    });
  }
  document.addEventListener("visibilitychange", handleVisibility);
  getCurrentPosition({ timeout: 8000 }).then((pos) => { if (pos) sendPing(pos.latitude, pos.longitude); });

  return { stop };
}
