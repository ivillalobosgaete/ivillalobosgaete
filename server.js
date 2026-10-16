// Servidor para hostings con Node (Render, Railway, Fly.io, un VPS, etc.).
// En Vercel NO se usa: Vercel sirve index.html y las funciones de /api por sí solo.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
try { // carga .env si existe (pruebas locales)
  for (const l of fs.readFileSync(path.join(dir, ".env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const ROUTES = ["estado", "me", "login", "logout", "register", "users", "data", "cargas", "indicadores", "mapa", "ajustes", "bitacora", "vistas", "actividad", "rca", "lugar"];
const handlers = {};
for (const r of ROUTES) handlers[r] = (await import(`./api/${r}.js`)).default;
const html = fs.readFileSync(path.join(dir, "index.html"));
const SEC = { "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  for (const k in SEC) res.setHeader(k, SEC[k]);
  const m = url.pathname.match(/^\/api\/([a-z]+)\/?$/);
  if (m) { const h = handlers[m[1]]; if (!h) { res.statusCode = 404; return res.end("{}"); } return h(req, res); }
  if (url.pathname === "/" || url.pathname === "/index.html") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.end(html); }
  res.statusCode = 404; res.end("No encontrado");
}).listen(process.env.PORT || 3000, () => console.log("Plataforma en http://localhost:" + (process.env.PORT || 3000)));
