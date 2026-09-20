// Shows push notifications sent by the app ("You're on court 2", "You're up next") and opens the
// board when one is tapped. No caching: the board is live and must never be stale.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Badminton Queue", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Badminton Queue", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "queue", // a newer notice of the same kind replaces the old one
      renotify: true,
      requireInteraction: data.tag === "court",
      vibrate: [200, 100, 200],
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url === url) || windows[0];
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
