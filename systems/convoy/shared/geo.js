// Browser geolocation helper for GPS-tagging checks and zone photos.

export function isGeoSupported() {
  return !!navigator.geolocation;
}

/**
 * Resolves once with { latitude, longitude, accuracy } or null if
 * unavailable/denied. Never rejects — callers should treat a null result as
 * "no GPS tag" and flag it, not throw, since plenty of legitimate walkarounds
 * happen with weak or no signal (multi-storey car parks, rural depots).
 */
export function getCurrentPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!isGeoSupported()) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 20000 }
    );
  });
}

// Haversine distance in metres — client-side mirror of convoy_distance_metres,
// used only for live UI feedback (e.g. "180m from depot"). The server
// recomputes this independently on submit; it is never trusted from the client.
export function distanceMetres(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v == null)) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
