// Borde costero: capas oficiales de planificación territorial (GeoIDE MINVU, servicios ArcGIS públicos)
// y pronóstico de oleaje (Open-Meteo Marine, solo si está configurado). Requiere sesión.
// GET /api/territorio?capas=1                → catálogo de capas oficiales disponibles (incluye el anteproyecto ZBC)
// GET /api/territorio?capa=<clave>            → GeoJSON de la capa (en caché 12 h)
// GET /api/territorio?mar=1&pts=lat,lon;…     → pronóstico de oleaje de 7 días por punto (máx. 40 puntos)
import { handler, send, current } from "../lib/core.js";

const G = process.env.GEOIDE_BASE || "https://geoide.minvu.cl/server/rest/services/IPT/";
const CAPAS = {
  pri_costero: { n: "PRI Borde Costero de Antofagasta · zonificación", g: "Plan regulador intercomunal", u: G + "PRI_Antofagasta/MapServer/1" },
  pri_riesgo: { n: "PRI Borde Costero de Antofagasta · áreas de riesgo", g: "Plan regulador intercomunal", u: G + "PRI_Antofagasta/MapServer/0" },
  prc_antofagasta: { n: "PRC Antofagasta", g: "Plan regulador comunal", u: G + "PRC_Antofagasta/FeatureServer/4" },
  prc_mejillones: { n: "PRC Mejillones", g: "Plan regulador comunal", u: G + "PRC_Antofagasta/FeatureServer/18" },
  sec_hornitos: { n: "Seccional Mejillones · Itata–Hornitos", g: "Plan seccional", u: G + "PRC_Antofagasta/FeatureServer/14" },
  sec_portuaria: { n: "Seccional Mejillones · Portuaria", g: "Plan seccional", u: G + "PRC_Antofagasta/FeatureServer/13" },
  prc_tocopilla: { n: "PRC Tocopilla", g: "Plan regulador comunal", u: G + "PRC_Antofagasta/FeatureServer/31" },
  prc_taltal: { n: "PRC Taltal", g: "Plan regulador comunal", u: G + "PRC_Antofagasta/FeatureServer/30" },
  sec_cifuncho: { n: "Seccional Cifuncho (Taltal)", g: "Plan seccional", u: G + "PRC_Antofagasta/FeatureServer/28" },
  prc_losvilos: { n: "PRC Los Vilos", g: "Plan regulador comunal", u: G + "PRC_Coquimbo/MapServer/10" },
};
// Anteproyecto de Zonificación del Borde Costero (ZBC) de Antofagasta: tablero público de ArcGIS Online.
// Las capas se descubren en tiempo de ejecución desde el tablero (sus fuentes de datos y mapas web).
const AGO = process.env.AGO_BASE || "https://www.arcgis.com/sharing/rest/content/items/";
const ZBC_ITEM = process.env.ZBC_ITEM || "d2536e39cc384646927882c0283f1191";
const ZBC_G = "Zonificación del borde costero (anteproyecto)";
const UA = { "User-Agent": "Mozilla/5.0 (Plataforma Gestion Borde Costero)" };
const cache = new Map();

// Polígonos ArcGIS (anillos) a GeoJSON: anillos exteriores en sentido horario, agujeros en sentido antihorario.
function area(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; }
function toGeo(geom) {
  if (!geom) return null;
  if (geom.rings) {
    const polys = [];
    for (const r of geom.rings) { if (r.length < 4) continue; if (area(r) >= 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r); }
    return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  }
  if (geom.paths) return { type: "MultiLineString", coordinates: geom.paths };
  if (geom.x != null) return { type: "Point", coordinates: [geom.x, geom.y] };
  return null;
}
async function getJ(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: UA });
  if (!r.ok) throw new Error("ArcGIS " + r.status);
  const j = await r.json(); if (j && j.error) throw new Error(j.error.message || "ArcGIS");
  return j;
}
// Recorre el JSON del tablero y junta referencias a ítems (itemId + layerId) y URL de servicios.
function refs(o, out) {
  if (!o || typeof o !== "object") return out;
  if (Array.isArray(o)) { o.forEach((x) => refs(x, out)); return out; }
  if (typeof o.itemId === "string" && /^[0-9a-f]{32}$/i.test(o.itemId)) out.items.push({ id: o.itemId, layer: o.layerId });
  if (typeof o.url === "string" && /\/(Feature|Map)Server(\/\d+)?\/?$/i.test(o.url)) out.urls.push({ u: o.url.replace(/\/$/, ""), t: o.title || o.name || "" });
  for (const v of Object.values(o)) if (v && typeof v === "object") refs(v, out);
  return out;
}
async function capasDeServicio(u, t, out) {
  if (/\/\d+$/.test(u)) { out.push({ u, t }); return; }
  const j = await getJ(u + "?f=json");
  for (const l of j.layers || []) if (!l.subLayerIds) out.push({ u: u + "/" + l.id, t: (t ? t + " · " : "") + l.name });
}
let ZBC = null;
async function zbcCapas() {
  if (ZBC && Date.now() - ZBC.t < 12 * 3600e3) return ZBC.d;
  const d = await getJ(AGO + ZBC_ITEM + "/data?f=json");
  const r = refs(d, { items: [], urls: [] });
  const lay = [];
  for (const x of r.urls) await capasDeServicio(x.u, x.t, lay).catch(() => {});
  const vistos = new Set();
  for (const it of r.items) {
    const key = it.id + ":" + (it.layer ?? ""); if (vistos.has(key)) continue; vistos.add(key);
    try {
      const m = await getJ(AGO + it.id + "?f=json");
      if (/web map/i.test(m.type || "")) {
        const wm = await getJ(AGO + it.id + "/data?f=json");
        const rr = refs(wm.operationalLayers || [], { items: [], urls: [] });
        for (const x of rr.urls) await capasDeServicio(x.u, x.t, lay).catch(() => {});
      } else if (m.url && /(Feature|Map)Server/i.test(m.url)) {
        const base = m.url.replace(/\/$/, "");
        if (it.layer != null && /^\d+$/.test(String(it.layer)) && !/\/\d+$/.test(base)) {
          let t = m.title || ""; try { const lj = await getJ(base + "/" + it.layer + "?f=json"); t = lj.name || t; } catch { /* sin nombre */ }
          lay.push({ u: base + "/" + it.layer, t });
        } else await capasDeServicio(base, m.title || "", lay).catch(() => {});
      }
    } catch { /* ítem no accesible */ }
  }
  // Solo capas con geometría (se descartan tablas), sin duplicados.
  const res = [], us = new Set();
  for (const l of lay) {
    if (us.has(l.u)) continue; us.add(l.u);
    try { const lj = await getJ(l.u + "?f=json"); if (!lj.geometryType) continue; res.push({ k: "zbc_" + res.length, n: "ZBC anteproyecto · " + (lj.name || l.t || "capa"), g: ZBC_G, u: l.u }); } catch { /* capa no accesible */ }
  }
  ZBC = { t: Date.now(), d: res };
  return res;
}
async function catalogo() {
  const of = Object.entries(CAPAS).map(([k, c]) => ({ k, ...c }));
  let z = [], zErr = "";
  try { z = await zbcCapas(); } catch (e) { zErr = String(e.message || e); }
  return { lista: [...z, ...of], zErr };
}

async function capa(k) {
  const c = k.startsWith("zbc_") ? (await zbcCapas()).find((x) => x.k === k) : CAPAS[k]; if (!c) throw new Error("Capa desconocida");
  const hit = cache.get(k); if (hit && Date.now() - hit.t < 12 * 3600e3) return hit.d;
  const feats = [];
  for (let off = 0; off < 20000; off += 1000) {
    const u = `${c.u}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.00015&geometryPrecision=5&resultOffset=${off}&resultRecordCount=1000&f=json`;
    const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: UA });
    if (!r.ok) throw new Error("GeoIDE MINVU " + r.status);
    const j = await r.json(); if (j.error) throw new Error((j.error && j.error.message) || "GeoIDE MINVU");
    for (const f of j.features || []) { const g = toGeo(f.geometry); if (g) feats.push({ type: "Feature", properties: f.attributes || {}, geometry: g }); }
    if (!j.exceededTransferLimit && (j.features || []).length < 1000) break;
  }
  const d = { type: "FeatureCollection", nombre: c.n, grupo: c.g, fuente: k.startsWith("zbc_") ? "Anteproyecto ZBC Antofagasta (ArcGIS Online)" : "GeoIDE MINVU (" + c.u.replace(G, "") + ")", obtenido: new Date().toISOString(), features: feats };
  cache.set(k, { t: Date.now(), d });
  return d;
}

async function mar(pts) {
  const key = process.env.OPENMETEO_APIKEY, libre = process.env.OPENMETEO_FREE === "1";
  if (!key && !libre) return { sinConfig: true };
  const base = process.env.OPENMETEO_BASE || (key ? "https://customer-marine-api.open-meteo.com/v1/marine" : "https://marine-api.open-meteo.com/v1/marine");
  const lat = pts.map((p) => p[0].toFixed(4)).join(","), lon = pts.map((p) => p[1].toFixed(4)).join(",");
  const u = `${base}?latitude=${lat}&longitude=${lon}&daily=wave_height_max,wave_period_max,wave_direction_dominant,swell_wave_height_max&forecast_days=7&timezone=America%2FSantiago${key ? "&apikey=" + encodeURIComponent(key) : ""}`;
  const ck = "mar:" + lat + ":" + lon; const hit = cache.get(ck); if (hit && Date.now() - hit.t < 3 * 3600e3) return hit.d;
  const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: UA });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error("Open-Meteo " + r.status + (j && j.reason ? ": " + j.reason : ""));
  const arr = Array.isArray(j) ? j : [j];
  const d = { fuente: "Open-Meteo Marine (CC BY 4.0)", obtenido: new Date().toISOString(), puntos: arr.map((x) => ({ lat: x.latitude, lon: x.longitude, daily: x.daily || {} })) };
  cache.set(ck, { t: Date.now(), d });
  return d;
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("capas")) { const c = await catalogo(); return send(res, 200, { capas: c.lista.map((x) => ({ k: x.k, n: x.n, g: x.g, f: x.k.startsWith("zbc_") ? "Anteproyecto ZBC (GORE Antofagasta)" : "GeoIDE MINVU" })), zbcErr: c.zErr, mar: !!(process.env.OPENMETEO_APIKEY || process.env.OPENMETEO_FREE === "1") }); }
  const k = u.searchParams.get("capa");
  if (k) { try { return send(res, 200, await capa(k), { "Cache-Control": "private, max-age=3600" }); } catch (e) { return send(res, 502, { error: String(e.message || e) }); } }
  if (u.searchParams.get("mar")) {
    const pts = String(u.searchParams.get("pts") || "").split(";").map((s) => s.split(",").map(Number)).filter((p) => p.length === 2 && p.every(isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180).slice(0, 40);
    if (!pts.length) return send(res, 400, { error: "Indica los puntos." });
    try { return send(res, 200, await mar(pts)); } catch (e) { return send(res, 502, { error: String(e.message || e) }); }
  }
  return send(res, 400, { error: "Indica capas=1, capa=<clave> o mar=1" });
});
