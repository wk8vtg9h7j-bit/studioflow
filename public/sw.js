// Minimal service worker — its presence (with a fetch handler) makes the app
// installable on Android/Chrome. It's intentionally a network pass-through; no
// offline caching, so users always get fresh content.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // pass-through: let the network handle every request
});
