// Interactive location picker for a vehicle's depot/home location: geocodes
// a typed address to an initial pin, then lets the user drag the pin (or
// click elsewhere on the map) to fine-tune it before saving. Uses the Google
// Maps JavaScript API + Geocoding API — same key already used elsewhere in
// SmartCore (shop/onboarding.html, SiteSnap's project location picker).

const GOOGLE_MAPS_KEY = "AIzaSyBTz0ra1eZdfopIzTMbnzpailHzgJqxts8";
const DEFAULT_CENTER = { lat: 54.5, lng: -3 }; // Great Britain — shown until a real location is picked
const DEFAULT_ZOOM = 5;
const PIN_ZOOM = 16;

let _loadPromise = null;

export function loadGoogleMaps() {
  if (window.google?.maps) return Promise.resolve();
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const cbName = "__convoyGoogleMapsReady";
    window[cbName] = () => { resolve(); delete window[cbName]; };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&callback=${cbName}`;
    script.async = true;
    script.onerror = () => reject(new Error("Could not load Google Maps."));
    document.head.appendChild(script);
  });
  return _loadPromise;
}

export async function geocodeAddress(query) {
  const q = (query || "").trim();
  if (!q) return null;
  await loadGoogleMaps();
  return new Promise((resolve) => {
    new google.maps.Geocoder().geocode({ address: q }, (results, status) => {
      if (status !== "OK" || !results?.length) return resolve(null);
      const loc = results[0].geometry.location;
      resolve({ latitude: loc.lat(), longitude: loc.lng() });
    });
  });
}

/**
 * Mounts a draggable-pin map into `containerEl`. Async because the Google
 * Maps script loads lazily on first use.
 * opts.latitude, opts.longitude - initial pin position (optional)
 * opts.onChange({latitude, longitude}) - fired on drag or map click
 */
export async function mountLocationPicker(containerEl, { latitude, longitude, onChange } = {}) {
  await loadGoogleMaps();

  const hasStart = latitude != null && longitude != null;
  const start = hasStart ? { lat: latitude, lng: longitude } : DEFAULT_CENTER;

  const map = new google.maps.Map(containerEl, {
    center: start, zoom: hasStart ? PIN_ZOOM : DEFAULT_ZOOM,
    streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
  });

  let marker = hasStart ? new google.maps.Marker({ position: start, map, draggable: true }) : null;
  if (marker) marker.addListener("dragend", () => emitChange(marker.getPosition()));

  function emitChange(latlng) {
    onChange?.({ latitude: latlng.lat(), longitude: latlng.lng() });
  }

  map.addListener("click", (e) => {
    if (!marker) {
      marker = new google.maps.Marker({ position: e.latLng, map, draggable: true });
      marker.addListener("dragend", () => emitChange(marker.getPosition()));
    } else {
      marker.setPosition(e.latLng);
    }
    emitChange(e.latLng);
  });

  return {
    setPosition(lat, lng, { recenter = true } = {}) {
      const pos = { lat, lng };
      if (!marker) {
        marker = new google.maps.Marker({ position: pos, map, draggable: true });
        marker.addListener("dragend", () => emitChange(marker.getPosition()));
      } else {
        marker.setPosition(pos);
      }
      if (recenter) {
        map.setCenter(pos);
        if (map.getZoom() < PIN_ZOOM) map.setZoom(PIN_ZOOM);
      }
    },
    invalidateSize() { google.maps.event.trigger(map, "resize"); },
    destroy() { marker?.setMap(null); },
  };
}
