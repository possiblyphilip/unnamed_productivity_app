// A minimal service worker. It exists so browsers treat the app as installable. It caches nothing,
// so a new version of the app is always picked up straight away.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (event) {
  if (new URL(event.request.url).origin !== self.location.origin) { return; }
  event.respondWith(fetch(event.request));
});
