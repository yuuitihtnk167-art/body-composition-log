const CACHE_NAME = "bodylog-shell-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // ナビゲーションは index.html（App Shell）を返す
  if (req.mode === "navigate") {
    event.respondWith(caches.match("/index.html").then((c) => c || fetch(req)));
    return;
  }

  event.respondWith(caches.match(req).then((c) => c || fetch(req)));
});
