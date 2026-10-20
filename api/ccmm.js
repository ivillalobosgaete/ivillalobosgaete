// Concesiones marítimas (Visor de concesiones marítimas, Subsecretaría para las Fuerzas Armadas).
// Paso 1: diagnóstico (solo administradores). Identifica desde qué servicio carga el visor sus capas,
// para luego programar la captura periódica alrededor de las caletas.
// GET /api/ccmm?descubrir=1            → texto con los servicios y campos encontrados
// GET /api/ccmm?probar=<ruta o URL>    → prueba una dirección del mismo sitio del visor (solo administradores)
import { handler, send, current } from "../lib/core.js";

const VISOR = () => process.env.CCMM_VISOR || "https://visorasuntosmaritimos.ssffaa.gob.cl/deptoaamm/map/7";
const UA = "Mozilla/5.0 (Plataforma Gestion Relacionamiento Pesca Artesanal AAPP Norte; consulta periodica de datos publicos)";

let LIMITE = Infinity;
async function bajar(url, max = 3_000_000) {
  const t0 = Date.now();
  if (t0 > LIMITE) return { url, status: 0, error: "omitido por tiempo", ms: 0, txt: "" };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000), redirect: "follow", headers: { "User-Agent": UA, Accept: "*/*" } });
    const buf = new Uint8Array(await r.arrayBuffer());
    const txt = new TextDecoder("utf-8").decode(buf.slice(0, max));
    return { url, final: r.url, status: r.status, tipo: r.headers.get("content-type") || "", server: r.headers.get("server") || "", largo: buf.length, ms: Date.now() - t0, txt };
  } catch (e) { return { url, status: 0, error: String(e.message || e), ms: Date.now() - t0, txt: "" }; }
}
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

const RX_URL = /["'`](https?:\/\/[^"'`\s<>]{4,300}|\/[A-Za-z0-9_\-./]{0,80}(?:geoserver|wfs|wms|ows|api|arcgis|rest|layer|feature|tile|mvt|pbf|geojson|map|capa|concesi|query|search|identify)[A-Za-z0-9_\-./?=&{}:%]{0,200})["'`]/gi;
const RX_HINT = /(geoserver|ows\?|service=wf[sm]|wfs|wms|arcgis\/rest|FeatureServer|MapServer|geojson|\.pbf|vector ?tiles?|mapbox|maplibre|openlayers|leaflet|ol\/|typeName|typeNames|layers=|outputFormat|getFeature|cql_filter|bbox)/i;

function urlsDe(txt) { const s = new Set(); let m; RX_URL.lastIndex = 0; while ((m = RX_URL.exec(txt))) s.add(m[1]); return [...s]; }
function contexto(txt, rx, n = 12) { const out = []; const g = new RegExp(rx.source, "gi"); let m; while ((m = g.exec(txt)) && out.length < n) out.push(txt.slice(Math.max(0, m.index - 120), m.index + 180).replace(/\s+/g, " ")); return [...new Set(out)]; }
const abs = (u, base) => { try { return new URL(u, base).href; } catch { return null; } };

async function descubrir() {
  LIMITE = Date.now() + 40000;
  const L = [], base = VISOR(), host = new URL(base).host;
  L.push("DIAGNÓSTICO VISOR DE CONCESIONES MARÍTIMAS", "Visor: " + base, "Fecha: " + new Date().toISOString(), "");
  const pg = await bajar(base);
  L.push(`[PÁGINA] estado ${pg.status} · ${pg.tipo} · ${pg.largo || 0} bytes · servidor "${pg.server}" · final ${pg.final || "-"} ${pg.error ? "· ERROR " + pg.error : ""}`);
  const title = (pg.txt.match(/<title>([^<]*)/i) || [])[1]; if (title) L.push("Título: " + title.trim());
  const scripts = [...pg.txt.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map((m) => abs(m[1], pg.final || base)).filter(Boolean);
  const links = [...pg.txt.matchAll(/<link[^>]+href=["']([^"']+)/gi)].map((m) => abs(m[1], pg.final || base)).filter(Boolean);
  L.push("Scripts: " + (scripts.join(" | ") || "ninguno"), "Links: " + (links.filter((x) => /json|manifest|config/i.test(x)).join(" | ") || "-"));
  const inline = [...pg.txt.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  if (inline.trim()) { L.push("Script en línea (inicio): " + inline.replace(/\s+/g, " ").slice(0, 1500)); }
  const rob = await bajar(new URL(base).origin + "/robots.txt", 4000); L.push("", `[ROBOTS] ${rob.status}: ${rob.txt.replace(/\s+/g, " ").slice(0, 400)}`);

  // Bundles JS: buscar direcciones de servicios y pistas de la librería de mapas
  const cand = new Set(urlsDe(pg.txt + "\n" + inline));
  const js = await pool(scripts.slice(0, 14), 5, (u) => bajar(u));
  L.push("", "[SCRIPTS]");
  for (const j of js) {
    L.push(`- ${j.url} → ${j.status} ${j.largo || 0} bytes ${j.error || ""}`);
    urlsDe(j.txt).forEach((u) => cand.add(u));
    const hints = contexto(j.txt, RX_HINT, 10); if (hints.length) L.push("  pistas:", ...hints.map((h) => "   · " + h));
  }
  const lista = [...cand].filter((u) => !/\.(png|jpe?g|svg|gif|woff2?|ttf|css|ico)(\?|$)/i.test(u) && !/w3\.org|reactjs|github|npmjs|mozilla\.org|googleapis\.com\/css|schema\.org|openstreetmap\.org\/copyright/i.test(u));
  L.push("", `[DIRECCIONES ENCONTRADAS] ${lista.length}`, ...lista.slice(0, 200).map((u) => " · " + u));

  // Probar direcciones del mismo sitio y rutas típicas de servicios de mapas
  const o = new URL(base).origin;
  const tip = ["/geoserver/ows?service=WFS&version=2.0.0&request=GetCapabilities", "/geoserver/wfs?service=WFS&request=GetCapabilities", "/geoserver/wms?service=WMS&request=GetCapabilities",
    "/api/", "/api/maps/7", "/api/map/7", "/api/v2/maps/7", "/deptoaamm/api/", "/deptoaamm/api/map/7", "/deptoaamm/api/maps/7", "/deptoaamm/map/7/config", "/arcgis/rest/services?f=json", "/server/rest/services?f=json"];
  const mismo = lista.map((u) => abs(u.replace(/\{[^}]*\}/g, ""), pg.final || base)).filter((u) => u && new URL(u).host === host && !scripts.includes(u));
  const probar = [...new Set([...mismo.slice(0, 25), ...tip.map((p) => o + p)])];
  const res = await pool(probar, 5, (u) => bajar(u, 200_000));
  L.push("", "[PRUEBAS]");
  for (const r of res) L.push(`- ${r.url} → ${r.status} · ${r.tipo} · ${r.largo || 0} bytes ${r.error || ""}`, r.status === 200 ? "   " + r.txt.replace(/\s+/g, " ").slice(0, 700) : "");
  return L.filter((x) => x !== "").join("\n");
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo administradores" });
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("descubrir")) {
    const txt = await descubrir();
    res.statusCode = 200; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
    if (u.searchParams.get("descargar")) res.setHeader("Content-Disposition", 'attachment; filename="diagnostico_concesiones.txt"');
    return res.end(txt);
  }
  const p = u.searchParams.get("probar");
  if (p) {
    const host = new URL(VISOR()).host, url = abs(p, `https://${host}/`);
    if (!url || new URL(url).host !== host) return send(res, 400, { error: "Solo direcciones del visor" });
    const r = await bajar(url, 400_000);
    res.statusCode = 200; res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.setHeader("Cache-Control", "no-store");
    return res.end(`${r.url} → ${r.status} · ${r.tipo} · ${r.largo || 0} bytes ${r.error || ""}\n\n${r.txt.slice(0, 60000)}`);
  }
  return send(res, 400, { error: "Indica ?descubrir=1" });
});
export { descubrir };
