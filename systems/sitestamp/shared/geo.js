// Browser geolocation helper for GPS-tagging captured media.

export function isGeoSupported() {
  return !!navigator.geolocation;
}

/**
 * Resolves once with { latitude, longitude } or null if unavailable/denied.
 * Never rejects — callers should treat a null result as "no GPS tag", not
 * an error, since plenty of legitimate capture flows happen without location
 * permission granted.
 */
export function getCurrentPosition({ timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!isGeoSupported()) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    );
  });
}
