// Usos del borde costero desde servicios públicos oficiales (consulta automática, sin carga manual):
//   · Subpesca (Geoportal IDE_PUBLICO): concesiones y solicitudes de acuicultura, áreas apropiadas para la acuicultura (AAA),
//     acuicultura en AMERB y en ECMPO y áreas marinas protegidas.
//   · SEA (servicio de mapas público del SEIA): proyectos sometidos a evaluación ambiental.
// Se consultan desde el servidor dentro de los recuadros de las zonas de la plataforma y se guardan 12 horas en memoria. Requiere sesión.
import { handler, send, current } from "../lib/core.js";

const SUB = process.env.GEO_BASE || "https://geoportal.subpesca.cl/server/rest/services/IDE_PUBLICO/";
const SEIA = process.env.SEIA_URL || "https://arcgisv11.sea.gob.cl/server/rest/services/WEBServices/ProyectosSEIA/MapServer/0/query";
const UA = { "User-Agent": "Mozilla/5.0 (Plataforma Borde Costero AAPP Norte)" };
const CAPAS = [
  { k: "acu", n: "Concesiones de acuicultura", u: SUB + "SRMPUB_ACUICULTURA/MapServer/0/query", f: "Subpesca" },
  { k: "acusol", n: "Solicitudes de concesión de acuicultura", u: SUB + "SRMPUB_ACUICULTURA/MapServer/2/query", f: "Subpesca" },
  { k: "aaa", n: "Áreas apropiadas para la acuicultura (AAA)", u: SUB + "SRMPUB_AAA/MapServer/0/query", f: "Subpesca" },
  { k: "acuamerb", n: "Acuicultura en áreas de manejo (AMERB)", u: SUB + "SRMPUB_ACUIAMERB/MapServer/0/query", f: "Subpesca" },
  { k: "acuecmpo", n: "Acuicultura en ECMPO", u: SUB + "SRMPUB_ACUIECMPO/MapServer/0/query", f: "Subpesca" },
  { k: "amp", n: "Áreas marinas protegidas", u: SUB + "SRMPUB_AMARINAS_PROT/MapServer/0/query", f: "Subpesca" },
  { k: "seia", n: "Proyectos sometidos al SEIA", u: SEIA, f: "Servicio de Evaluación Ambiental" },
];
let cache = { t: 0, key: "", data: null };
function centro(g) {
  if (!g) return null;
  if (g.type === "Point") return [g.coordinates[1], g.coordinates[0]];
  const rings = g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : g.type === "MultiPoint" ? [g.coordinates] : null;
  if (!rings) return null; let x = 0, y = 0, n = 0;
  for (const r of rings) for (const p of r) { x += p[0]; y += p[1]; n++; }
  return n ? [y / n, x / n] : null;
}
function limpiar(p) {
  const o = {}; let n = 0;
  for (const [k0, v] of Object.entries(p || {})) {
    if (v == null || v === "" || n >= 30) continue; const k = k0.replace(/^.*\./, "");
    if (/^(OBJECTID|SHAPE|Shape|GLOBALID|FID)/i.test(k)) continue;
    let x = v; if (typeof v === "number" && v > 6e11 && v < 4.2e12 && /F_|FECHA|DATE/i.test(k)) x = new Date(v).toISOString().slice(0, 10);
    o[k] = typeof x === "string" ? x.slice(0, 300) : x; n++;
  }
  return o;
}
async function consultar(c, boxes) {
  const seen = new Set(), out = [];
  for (const b of boxes) {
    for (let off = 0; off < 4000; off += 1000) {
      const u = `${c.u}?where=1%3D1&geometry=${encodeURIComponent(b.join(","))}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.003&geometryPrecision=4&resultOffset=${off}&resultRecordCount=1000&f=geojson`;
      const r = await fetch(u, { signal: AbortSignal.timeout(20000), headers: UA });
      if (!r.ok) throw new Error(c.f + " " + r.status);
      const j = await r.json(); if (j.error) throw new Error((j.error && j.error.message) || c.f);
      const fs = j.features || [];
      for (const f of fs) { const p = limpiar(f.properties), id = JSON.stringify(p).slice(0, 400); if (seen.has(id)) continue; seen.add(id); const ce = centro(f.geometry); out.push({ a: p, lat: ce ? +ce[0].toFixed(5) : null, lon: ce ? +ce[1].toFixed(5) : null }); }
      if (fs.length < 1000 || !j.exceededTransferLimit && fs.length < 1000) break;
    }
  }
  return out;
}
export default handler(async (req, res) => {
  if (!(await current(req))) return send(res, 401, { error: "Sin sesión" });
  const q = new URL(req.url, "http://x").searchParams;
    const boxes = String(q.get("b") || "").split(";").map((t) => t.split(",").map(Number)).filter((a) => a.length === 4 && a.every((v) => isFinite(v) && Math.abs(v) <= 180)).slice(0, 6);
  const key = boxes.map((b) => b.map((v) => v.toFixed(2)).join(",")).join(";"), hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  if (cache.data && cache.key === key && cache.dia === hoy && Date.now() - cache.t < 12 * 3600e3) return send(res, 200, cache.data);
  const data = { capas: {}, errores: [], obtenido: new Date().toISOString(), fuentes: CAPAS.map((c) => ({ k: c.k, n: c.n, f: c.f, u: c.u.replace(/\/query$/, "") })) };
  await Promise.all([
    ...CAPAS.map(async (c) => { if (!boxes.length) return; try { data.capas[c.k] = await consultar(c, boxes); } catch (e) { data.errores.push(`${c.n}: ${e.message}`); } }),
  ]);
  if (Object.keys(data.capas).length) cache = { t: Date.now(), key, data, dia: hoy };
  send(res, 200, data);
});
