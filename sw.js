/* Service worker de la Plataforma de Gestión Borde Costero.
   Solo guarda la estructura de la aplicación (página, íconos y manifiesto) para abrir rápido
   y mostrar un aviso sin conexión. Nunca guarda datos: /api/*, Supabase ni archivos de RCA
   van siempre directo a la red, porque contienen información sensible y requieren sesión. */
const VERSION = "bc-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/favicon-32.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const OFFLINE = `<!doctype html><html lang="es-CL"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión · Borde Costero</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b2a40;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px}
main{max-width:420px}img{width:84px;height:84px;border-radius:20px}h1{font-size:1.3rem}p{color:#cfe3f0;line-height:1.5}
button{margin-top:10px;padding:12px 22px;border:0;border-radius:10px;background:#1f6f94;color:#fff;font-size:1rem;font-weight:700}</style></head>
<body><main><img src="/icons/icon-192.png" alt=""><h1>Sin conexión a internet</h1><p>La plataforma necesita conexión para iniciar sesión y consultar los datos, que se guardan cifrados en el servidor.</p><button onclick="location.reload()">Reintentar</button></main></body></html>`;

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                 // Supabase, fuentes y otros sitios: red directa
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/rca/")) return; // datos: nunca en caché
  if (req.mode === "navigate") {                              // la página: primero la red (siempre la última versión)
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(VERSION).then(k => k.put("/", c)); return r; })
      .catch(() => caches.match("/").then(r => r || new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } }))));
    return;
  }
  if (SHELL.includes(url.pathname)) {                         // íconos y manifiesto: caché primero
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
  }
});
