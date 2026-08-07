// SiteSnap service worker — exists solely to receive Web Push events and
// show a notification, plus route a click on that notification back into
// the app. No offline caching / asset interception on purpose: this repo
// has no build step to keep a precache manifest in sync with, and adding
// one is a separate concern from push notifications. Scoped to
// /systems/sitesnap/ by virtue of being served from that path.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* non-JSON payload, ignore */ }

  const title = data.title || "SiteSnap";
  const options = {
    body: data.body || "",
    icon: "/SmartCore Official Logos/SC Icon - Black Background.png",
    badge: "/SmartCore Official Logos/SC Icon - Black Background.png",
    data: { url: data.url || "/systems/sitesnap/index.html" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/systems/sitesnap/index.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes("/systems/sitesnap/") && "focus" in client) {
          if ("navigate" in client) client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
