/**
 * Service Worker — Polar Breeze Hub
 * Caching strategy: Network-first para API/Firebase, Cache-first para assets estáticos
 */

const CACHE_NAME = "pb-hub-v1";
const STATIC_ASSETS = [
  "/",
  "/app-despachador",
  "/app-encargado",
  "/icon-hub.svg",
  "/icon-despachador.svg",
  "/icon-encargado.svg",
];

// ── Install: pre-cachear assets estáticos ──────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Ignorar errores — algunos assets pueden no estar listos
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: limpiar caches viejos ────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: estrategia por tipo de recurso ─────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Firebase / APIs → siempre red, sin caché
  if (
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis") ||
    url.pathname.startsWith("/api/")
  ) {
    return; // deja pasar al navegador
  }

  // Navegación (HTML) → Network-first, fallback a cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Fallback offline page
          return new Response(
            `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
             <meta name="viewport" content="width=device-width,initial-scale=1">
             <title>Sin conexión — Polar Breeze</title>
             <style>body{font-family:system-ui,sans-serif;background:#1A1A1A;color:#fff;
               display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
               .box{text-align:center;padding:2rem} .emoji{font-size:4rem}
               h1{font-size:1.5rem;margin:.5rem 0} p{color:#aaa;font-size:.9rem}</style>
             </head><body><div class="box">
               <div class="emoji">📶</div>
               <h1>Sin conexión</h1>
               <p>Polar Breeze requiere internet para funcionar.</p>
               <p style="margin-top:1rem;color:#F5C800">Reconectando automáticamente…</p>
             </div></body></html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }))
    );
    return;
  }

  // Assets estáticos (JS, CSS, imágenes) → Cache-first
  if (
    event.request.destination === "script" ||
    event.request.destination === "style" ||
    event.request.destination === "image" ||
    event.request.destination === "font"
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        });
      })
    );
    return;
  }
});

// ── Push Notifications ─────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "Polar Breeze", body: event.data.text() }; }

  const { title = "Polar Breeze", body = "", icon = "/icon-hub.svg", badge = "/icon-hub.svg", url = "/" } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      data: { url },
      vibrate: [200, 100, 200],
      requireInteraction: false,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url) && "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
