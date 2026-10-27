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
// Geoportal de Subpesca (el mismo que usa su visor IDE, mapas.subpesca.cl/ideviewer): todas las capas públicas
// de la carpeta IDE_PUBLICO, descubiertas desde el catálogo REST y recortadas al área de interés (regiones II a IV).
const SUB = process.env.GEO_BASE || "https://geoportal.subpesca.cl/server/rest/services/IDE_PUBLICO/";
const SUB_BBOX = process.env.SUB_BBOX || "-72.8,-32.6,-67.9,-20.9";
const SUB_G = "Subpesca · ";
const bonito = (t) => String(t || "").replace(/^.*\./, "").replace(/^(SRMPUB|IDE|REP)_/i, "").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace(/\b(amerb|ecmpo|amcp|aaa|ama|ssp|rae|ppa|aappa|ccmm)\b/gi, (m) => m.toUpperCase());
let SP = null;
async function subCapas() {
  if (SP && Date.now() - SP.t < 12 * 3600e3) return SP.d;
  const cat = await getJ(SUB + "?f=json");
  const svcs = (cat.services || []).filter((x) => /MapServer|FeatureServer/.test(x.type));
  const res = [];
  await Promise.all(svcs.map(async (sv) => {
    const nm = String(sv.name).split("/").pop(), base = SUB + nm + "/" + sv.type;
    try {
      const j = await getJ(base + "/layers?f=json");
      for (const l of j.layers || []) {
        if (!l.geometryType || (l.type && l.type !== "Feature Layer") || (l.capabilities && !/Query/i.test(l.capabilities))) continue;
        res.push({ k: "sp_" + nm.replace(/[^A-Za-z0-9]/g, "") + "_" + l.id, n: bonito(l.name) || nm, g: SUB_G + bonito(nm), u: base + "/" + l.id, sub: true });
      }
    } catch { /* servicio no disponible */ }
  }));
  res.sort((a, b) => a.g.localeCompare(b.g, "es") || a.n.localeCompare(b.n, "es"));
  SP = { t: Date.now(), d: res };
  return res;
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
  let z = [], zErr = "", sp = [], spErr = "";
  await Promise.all([
    zbcCapas().then((x) => { z = x; }).catch((e) => { zErr = String(e.message || e); }),
    subCapas().then((x) => { sp = x; }).catch((e) => { spErr = String(e.message || e); }),
  ]);
  return { lista: [{ k: "infra", n: "Infraestructura del borde costero (OpenStreetMap)", g: "Infraestructura costera", u: "" }, ...z, ...of, ...sp], zErr, spErr };
}

async function capa(k) {
  if (k === "infra") return infra();
  const c = k.startsWith("zbc_") ? (await zbcCapas()).find((x) => x.k === k) : k.startsWith("sp_") ? (await subCapas()).find((x) => x.k === k) : CAPAS[k]; if (!c) throw new Error("Capa desconocida");
  const env = c.sub ? `&geometry=${encodeURIComponent(SUB_BBOX)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` : "";
  const hit = cache.get(k); if (hit && Date.now() - hit.t < 12 * 3600e3) return hit.d;
  const feats = [];
  for (let off = 0; off < 20000; off += 1000) {
    const u = `${c.u}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.00015&geometryPrecision=5${env}&resultOffset=${off}&resultRecordCount=1000&f=json`;
    const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: UA });
    if (!r.ok) throw new Error("GeoIDE MINVU " + r.status);
    const j = await r.json(); if (j.error) throw new Error((j.error && j.error.message) || "GeoIDE MINVU");
    for (const f of j.features || []) { const g = toGeo(f.geometry); if (!g) continue; let pr = f.attributes || {}; if (c.sub) { const q = {}; for (const [a, v] of Object.entries(pr)) q[a.replace(/^.*\./, "")] = v; pr = q; } feats.push({ type: "Feature", properties: pr, geometry: g }); }
    if (!j.exceededTransferLimit && (j.features || []).length < 1000) break;
  }
  const d = { type: "FeatureCollection", nombre: c.n, grupo: c.g, fuente: k.startsWith("zbc_") ? "Anteproyecto ZBC Antofagasta (ArcGIS Online)" : c.sub ? "Geoportal Subpesca (" + c.u.replace(SUB, "") + ")" : "GeoIDE MINVU (" + c.u.replace(G, "") + ")", obtenido: new Date().toISOString(), features: feats };
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

// Infraestructura del borde costero desde OpenStreetMap (Overpass): puertos, muelles, desaladoras, centrales y emisarios
// en la franja costera de las regiones de Antofagasta y Coquimbo. Datos © colaboradores de OpenStreetMap (ODbL). Caché 24 h.
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const FRANJAS = ["-26.2,-70.9,-21.0,-69.95", "-32.3,-71.9,-29.9,-71.2"];
let INFRA = null;
function claseInfra(t) {
  if (t.harbour || t.landuse === "port" || t.industrial === "port" || /port|terminal/i.test(t["seamark:type"] || "") || t.amenity === "ferry_terminal") return "puerto";
  if (t.man_made === "pier" || t.man_made === "breakwater" || t["seamark:type"] === "harbour") return t.man_made === "breakwater" ? "rompeolas" : "muelle";
  if (t.water_works === "desalination" || /desal/i.test((t.name || "") + " " + (t.description || ""))) return "desaladora";
  if (t.power === "plant" || t.power === "generator") return "energia";
  if (t.man_made === "pipeline" || t.man_made === "outfall" || /emisario|aducci|captaci/i.test(t.name || "")) return "ducto";
  if (t.man_made === "lighthouse") return "faro";
  return "otro";
}
async function infra() {
  if (INFRA && Date.now() - INFRA.t < 24 * 3600e3) return INFRA.d;
  const parts = FRANJAS.map((b) => `nwr["harbour"](${b});nwr["landuse"="port"](${b});nwr["industrial"="port"](${b});nwr["man_made"~"^(pier|breakwater|lighthouse)$"](${b});nwr["water_works"="desalination"](${b});nwr["man_made"="water_works"]["name"~"[Dd]esal"](${b});nwr["power"="plant"](${b});nwr["amenity"="ferry_terminal"](${b});`).join("");
  const q = `[out:json][timeout:50];(${parts});out center tags 2000;`;
  const r = await fetch(OVERPASS, { method: "POST", signal: AbortSignal.timeout(55000), headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
  if (!r.ok) throw new Error("Overpass " + r.status);
  const j = await r.json();
  const feats = [];
  for (const e of j.elements || []) {
    const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
    if (lat == null || lon == null) continue;
    const t = e.tags || {};
    if (t.power === "plant" && !/(gas|coal|oil|diesel|thermal|termo|steam)/i.test((t["plant:source"] || "") + " " + (t.name || "")) && lon > -70.2 && lat > -26.5) continue; // descarta parques solares del interior
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties: { clase: claseInfra(t), nombre: t.name || t.operator || "", operador: t.operator || "", tipo: t.man_made || t.harbour || t.power || t.landuse || t.industrial || t.water_works || t.amenity || "", osm: e.type + "/" + e.id } });
  }
  const d = { type: "FeatureCollection", fuente: "© colaboradores de OpenStreetMap (ODbL), vía Overpass", obtenido: new Date().toISOString(), features: feats };
  INFRA = { t: Date.now(), d };
  return d;
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("capas")) { const c = await catalogo(); return send(res, 200, { capas: c.lista.map((x) => ({ k: x.k, n: x.n, g: x.g, f: x.k === "infra" ? "© colaboradores de OpenStreetMap" : x.k.startsWith("zbc_") ? "Anteproyecto ZBC (GORE Antofagasta)" : x.sub ? "Geoportal Subpesca" : "GeoIDE MINVU" })), zbcErr: c.zErr, spErr: c.spErr, mar: !!(process.env.OPENMETEO_APIKEY || process.env.OPENMETEO_FREE === "1") }); }
  if (u.searchParams.get("infra")) { try { return send(res, 200, await infra()); } catch (e) { return send(res, 502, { error: String(e.message || e) }); } }
  const k = u.searchParams.get("capa");
  if (k) { try { return send(res, 200, await capa(k), { "Cache-Control": "private, max-age=3600" }); } catch (e) { return send(res, 502, { error: String(e.message || e) }); } }
  if (u.searchParams.get("mar")) {
    const pts = String(u.searchParams.get("pts") || "").split(";").map((s) => s.split(",").map(Number)).filter((p) => p.length === 2 && p.every(isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180).slice(0, 40);
    if (!pts.length) return send(res, 400, { error: "Indica los puntos." });
    try { return send(res, 200, await mar(pts)); } catch (e) { return send(res, 502, { error: String(e.message || e) }); }
  }
  return send(res, 400, { error: "Indica capas=1, capa=<clave> o mar=1" });
});
