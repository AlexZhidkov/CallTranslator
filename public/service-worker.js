const CACHE_PREFIX = "call-translator";
const CACHE_VERSION = "v1";
const APP_SHELL_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-${CACHE_VERSION}-runtime`;
const CACHE_NAMES = [APP_SHELL_CACHE, RUNTIME_CACHE];

const APP_SHELL_URLS = [
  "/",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(CACHE_PREFIX) &&
                !CACHE_NAMES.includes(cacheName),
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event));
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(APP_SHELL_CACHE);
      await cache.put("/", response.clone());
    }
    return response;
  } catch {
    const cachedResponse =
      (await caches.match(request)) || (await caches.match("/"));

    return (
      cachedResponse ||
      new Response("Call Translator is unavailable offline.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(event.request);
  const fetchPromise = fetch(event.request)
    .then((response) => {
      if (isCacheable(response)) {
        cache.put(event.request, response.clone());
      }
      return response;
    })
    .catch(() => cachedResponse);

  if (cachedResponse) {
    event.waitUntil(fetchPromise);
    return cachedResponse;
  }

  return (
    (await fetchPromise) ||
    new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

function isCacheable(response) {
  return response && response.ok && response.type === "basic";
}
