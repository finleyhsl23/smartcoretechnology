// Sound effects for Presence & Fire Safety — synthesized via the Web Audio
// API (no audio asset files to host). A single shared AudioContext is
// created lazily on first use (browsers block autoplay before a user
// gesture, and every call site here is already inside a click/tap handler).

let _ctx = null;
let _enabled = true; // sensible default before company settings load

function ctx() {
  if (!_ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    _ctx = new AudioCtx();
  }
  if (_ctx.state === "suspended") _ctx.resume().catch(() => {});
  return _ctx;
}

export function setSoundEnabled(enabled) {
  _enabled = !!enabled;
}

export function isSoundEnabled() {
  return _enabled;
}

function tone(freq, { duration = 0.12, type = "sine", startAt = 0, gain = 0.18 } = {}) {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + startAt;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

const PLAYERS = {
  success: () => { tone(880, { duration: 0.1 }); tone(1320, { duration: 0.16, startAt: 0.08 }); },
  error:   () => { tone(220, { duration: 0.16, type: "square", gain: 0.14 }); tone(160, { duration: 0.2, startAt: 0.1, type: "square", gain: 0.14 }); },
  info:    () => { tone(660, { duration: 0.09 }); },
  tap:     () => { tone(500, { duration: 0.05, gain: 0.12 }); },
};

/** Plays a sound for the given kind ('success' | 'error' | 'info' | 'tap'),
 *  a no-op if sound effects are disabled or the browser has no audio API. */
export function playSound(kind) {
  if (!_enabled) return;
  try {
    (PLAYERS[kind] || PLAYERS.info)();
  } catch {
    // Never let a sound-effect failure break the underlying action.
  }
}

/** Fire-and-forget: fetches the company's sound_effects_enabled setting and
 *  applies it. Called once per page load (right after companyId is known)
 *  so every toast()/tap sound on every page — including pages that don't
 *  otherwise need company settings — respects the admin's preference. */
export async function initSoundFromSettings(companyId) {
  try {
    const { settings } = await import("./api.js");
    const row = await settings.get(companyId);
    setSoundEnabled(row?.sound_effects_enabled !== false);
  } catch {
    // Leave the default (enabled) in place if settings can't be loaded.
  }
}
