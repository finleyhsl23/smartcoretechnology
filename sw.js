// Platform-wide service worker — exists solely to receive Web Push events
// and show a notification, plus route a click on that notification back
// into the app. Registered from /modules/ at scope '/' (see
// modules/index.html) so it covers every module, not just one. No offline
// caching / asset interception on purpose: this repo has no build step to
// keep a precache manifest in sync with, and that's a separate concern from
// push notifications anyway.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload, ignore */ }

  const title = data.title || "SmartCore";
  const options = {
    body: data.body || "",
    icon: "/SmartCore Official Logos/SC Icon - Black Background.png",
    badge: "/SmartCore Official Logos/SC Icon - Black Background.png",
    data: { url: data.url || "/modules/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/modules/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ("focus" in client) {
          if (client.url !== url && "navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
