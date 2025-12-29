// BodyLog SW v2 (cache clean + app shell)
const CACHE = "bodylog-shell-v2";
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
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE) ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // SPA的にどのURLでも index.html を返す（App Shell）
  if (req.mode === "navigate") {
    event.respondWith((async ()=>{
      const cached = await caches.match("/index.html");
      try {
        const fresh = await fetch(req);
        return fresh || cached;
      } catch {
        return cached;
      }
    })());
    return;
  }

  event.respondWith((async ()=>{
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return cached;
    }
  })());
});
