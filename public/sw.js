// Shows push notifications sent by the app ("You're on court 2", "You're up next") and opens the
// board when one is tapped. No caching: the board is live and must never be stale.
//
// Platform notes (from the specs and vendor docs):
//  - `vibrate` is honoured by Android browsers only. iPhones ignore it: iOS decides sound and haptics
//    from the user's notification settings, and Safari has never implemented vibration.
//  - The app badge (a number on the Home Screen icon) works for installed apps on iOS 16.4+ and Android.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
	event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = {
			title: "Badminton Queue",
			body: event.data ? event.data.text() : "",
		};
	}
	const isCourt = data.tag === "court";
	event.waitUntil(
		Promise.all([
			self.registration.showNotification(data.title || "Badminton Queue", {
				body: data.body || "",
				icon: "/icons/icon-192.png",
				badge: "/icons/icon-192.png", // Android status bar
				tag: data.tag || "queue", // a newer notice of the same kind replaces the old one...
				renotify: true, // ...and still alerts (sound/vibration) again
				requireInteraction: isCourt, // stays until dismissed: it's the one you must not miss
				vibrate: isCourt ? [250, 120, 250, 120, 250] : [200, 100, 200],
				timestamp: Date.now(),
				data: { url: data.url || "/" },
			}),
			"setAppBadge" in self.navigator
				? self.navigator.setAppBadge(1).catch(() => {})
				: Promise.resolve(),
		]),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	if ("clearAppBadge" in self.navigator)
		self.navigator.clearAppBadge().catch(() => {});
	const url = new URL(event.notification.data?.url || "/", self.location.origin)
		.href;
	event.waitUntil(
		self.clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((windows) => {
				const open = windows.find((w) => w.url === url) || windows[0];
				return open ? open.focus() : self.clients.openWindow(url);
			}),
	);
});
