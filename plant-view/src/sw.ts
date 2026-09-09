/// <reference lib="webworker" />
export type {};
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = "wattloft-v2.1-shell";
const DATA_CACHE = "wattloft-v2.1-data";

const PRECACHE_ASSETS = [
  "/",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Ibarra+Real+Nova:wght@600&family=Source+Sans+3:wght@400;500&display=swap",
];

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(PRECACHE_ASSETS);
      } catch {
        // Ignore precache failure during build/offline install
      }
      return self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== DATA_CACHE)
          .map((k) => caches.delete(k)),
      );
    }).then(() => self.clients.claim()),
  );
});

async function fetchWithTimeout(request: Request, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);

  // Intercept /api/plant (Stale-While-Revalidate with 3-second network timeout)
  if (url.pathname === "/api/plant" && event.request.method === "GET") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(DATA_CACHE);
        const cachedResponse = await cache.match(event.request);

        // Try network with 3-second timeout
        try {
          const networkResponse = await fetchWithTimeout(event.request.clone(), 3000);
          if (networkResponse.ok) {
            void cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          // If offline or network times out (> 3 seconds), return cached JSON snapshot
          if (cachedResponse) {
            const headers = new Headers(cachedResponse.headers);
            headers.set("X-Wattloft-Offline", "true");
            return new Response(cachedResponse.body, {
              status: cachedResponse.status,
              statusText: cachedResponse.statusText,
              headers,
            });
          }
          return new Response(JSON.stringify({ empty: true, offline: true }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      })(),
    );
    return;
  }

  // Intercept logout to clear caches
  if (url.pathname === "/logout" && event.request.method === "POST") {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    );
    return;
  }

  // Pre-cached assets & shell (Stale-While-Revalidate / Cache-First)
  if (
    event.request.method === "GET" &&
    (event.request.mode === "navigate" ||
      url.pathname.startsWith("/assets/") ||
      url.pathname === "/favicon.svg" ||
      url.pathname === "/apple-touch-icon.png" ||
      url.pathname === "/manifest.webmanifest" ||
      url.hostname.includes("fonts.googleapis.com") ||
      url.hostname.includes("fonts.gstatic.com"))
  ) {
    event.respondWith(
      caches.match(event.request).then(async (cached) => {
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        } catch {
          if (cached) return cached;
          return new Response("Offline", { status: 503 });
        }
      }),
    );
    return;
  }
});

// Push notification listener
self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string; icon?: string } = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : undefined };
  }

  const title = data.title || "Wattloft · Logger Stall";
  const options: NotificationOptions = {
    body: data.body || "A logger has stalled during daylight hours.",
    icon: data.icon || "/favicon.svg",
    badge: "/favicon.svg",
    data: { url: "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click listener
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList: readonly Client[]) => {
      for (const client of clientList) {
        if ("focus" in client && typeof (client as WindowClient).focus === "function") {
          return (client as WindowClient).focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("/");
      }
    }),
  );
});
