/* Production replaces these markers with the exact output of every Vite build. */
const CACHE_PREFIX = "roadster-flight-test-";
const CACHE_NAME = "roadster-flight-test-__BUILD_VERSION__";
const PRECACHE = /*__PRECACHE__*/ [];

self.addEventListener("install", (event) => {
  // The source worker deliberately does nothing if accidentally opened in dev.
  if (!PRECACHE.length) return;
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  if (!PRECACHE.length) return;
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!PRECACHE.length || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Published trailers/share art stay network-only. In particular, leave video
  // navigation and byte-range requests alone instead of serving game HTML.
  if (url.pathname === "/media" || url.pathname.startsWith("/media/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) return response;
        } catch {
          /* The complete precached shell is available without a network. */
        }
        // A troubleshooting visit must never fall back to the full game:
        // that could immediately recreate the failing graphics workload.
        const shell = /^\/graphics-check(?:\.html|\/)?$/.test(url.pathname)
          ? "/graphics-check.html"
          : /^\/player(?:\/|$)/.test(url.pathname)
          ? "/player/index.html"
          : "/index.html";
        return (await caches.match(shell)) || Response.error();
      })(),
    );
    return;
  }

  // Only explicitly built assets are cached. Arbitrary URLs, APIs and user data
  // never enter this game's offline cache.
  if (!PRECACHE.includes(url.pathname)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url.pathname);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === "basic")
        await cache.put(url.pathname, response.clone());
      return response;
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
