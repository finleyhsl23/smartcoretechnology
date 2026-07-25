// Interactive location picker for job/project creation: geocodes a typed
// address or the device's current position to an initial pin, then lets the
// user drag the pin (or click elsewhere on the map) to fine-tune it before
// saving. Uses Leaflet + OpenStreetMap tiles and Nominatim geocoding —
// both free and keyless, unlike Google Maps. Nominatim's usage policy
// (https://operations.osmfoundation.org/policies/nominatim/) expects
// light, non-bulk client use, which a one-off geocode per project create
// comfortably fits; the browser's own Referer header satisfies its
// identification requirement, so no extra headers are needed.

const DEFAULT_CENTER = [54.5, -3]; // Great Britain — shown until a real location is picked
const DEFAULT_ZOOM = 5;
const PIN_ZOOM = 16;

export async function geocodeAddress(query) {
  const q = (query || "").trim();
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results.length) return null;
  return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon) };
}

/**
 * Mounts a draggable-pin map into `containerEl`.
 *
 * @param {HTMLElement} containerEl
 * @param {object} opts
 *   opts.latitude, opts.longitude - initial pin position (optional — map
 *     starts zoomed out with no pin until setPosition() is called)
 *   opts.onChange({latitude, longitude}) - fired on drag or map click
 */
export function mountLocationPicker(containerEl, { latitude, longitude, onChange } = {}) {
  const hasStart = latitude != null && longitude != null;
  const start = hasStart ? [latitude, longitude] : DEFAULT_CENTER;

  const map = L.map(containerEl).setView(start, hasStart ? PIN_ZOOM : DEFAULT_ZOOM);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  let marker = hasStart ? L.marker(start, { draggable: true }).addTo(map) : null;
  if (marker) marker.on("dragend", () => emitChange(marker.getLatLng()));

  function emitChange(latlng) {
    onChange?.({ latitude: latlng.lat, longitude: latlng.lng });
  }

  map.on("click", (e) => {
    if (!marker) {
      marker = L.marker(e.latlng, { draggable: true }).addTo(map);
      marker.on("dragend", () => emitChange(marker.getLatLng()));
    } else {
      marker.setLatLng(e.latlng);
    }
    emitChange(e.latlng);
  });

  return {
    setPosition(lat, lng, { recenter = true } = {}) {
      const latlng = L.latLng(lat, lng);
      if (!marker) {
        marker = L.marker(latlng, { draggable: true }).addTo(map);
        marker.on("dragend", () => emitChange(marker.getLatLng()));
      } else {
        marker.setLatLng(latlng);
      }
      if (recenter) map.setView(latlng, Math.max(map.getZoom(), PIN_ZOOM));
    },
    invalidateSize() { map.invalidateSize(); },
    destroy() { map.remove(); },
  };
}
