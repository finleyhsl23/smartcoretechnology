// Web Push registration for SiteSnap. Real push — delivered via the browser
// vendor's push service and shown by sw.js even when no SiteSnap tab is
// open — not the in-tab-only approach this replaced. VAPID_PUBLIC_KEY is
// safe to ship client-side (it identifies the sender, like a public key
// always is); the matching private key lives server-side as an environment
// variable read by functions/api/sitesnap/_webpush.js.
import { sb } from "./supabase.js";

const VAPID_PUBLIC_KEY = "BEUb_akLgDV9L-Wrwo6Vxt19JtzsRjBd96uULyDEQ6CtFXh0UrR_OiH1QEOV-G0V5vXJqpUSloho50KdQKopU84";

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function saveSubscription(subscription) {
  const { data: sessionData } = await sb().auth.getSession();
  const res = await fetch("/api/sitesnap/push-subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}` },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return res.ok;
}

/**
 * Registers the service worker and subscribes to Push — this itself
 * triggers the browser's notification permission prompt if not already
 * granted/denied, so only call it from a place the user expects that
 * (the onboarding step, or an explicit "enable notifications" action).
 * Returns true only if the subscription was created and saved.
 */
export async function registerPush() {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.register("/systems/sitesnap/sw.js", { scope: "/systems/sitesnap/" });
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    return await saveSubscription(subscription);
  } catch {
    return false;
  }
}

/**
 * Silently re-confirms the subscription is registered server-side for
 * someone who already granted permission (e.g. on an earlier visit or via
 * onboarding) — never prompts, since permission is already decided one way
 * or the other. Safe to call unconditionally on every page load.
 */
export async function ensureSubscribedIfGranted() {
  if (!isPushSupported() || Notification.permission !== "granted") return;
  await registerPush();
}

/** Fires a push to someone via the server. Best-effort — call right after the action that should notify them (e.g. assigning a task). */
export async function sendPush({ employeeId, companyId, title, body, url }) {
  try {
    const { data: sessionData } = await sb().auth.getSession();
    await fetch("/api/sitesnap/send-push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionData.session.access_token}` },
      body: JSON.stringify({ employeeId, companyId, title, body, url }),
    });
  } catch {
    /* best-effort — never block the calling action on a notification failure */
  }
}
