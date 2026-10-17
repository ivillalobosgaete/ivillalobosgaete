// Capas públicas del Geoportal de Subpesca (IDE_PUBLICO): AMERB y caletas pesqueras artesanales; y ECMPO (Subpesca, vía IDE de la SMA).
// Se consultan desde el servidor (sin problemas de CORS) y se actualizan todos los días (máximo 12 horas en memoria). Requiere sesión.
import { handler, send, current } from "../lib/core.js";
const BASE = process.env.GEO_BASE || "https://geoportal.subpesca.cl/server/rest/services/IDE_PUBLICO/";
// ECMPO (espacios costeros marinos de pueblos originarios): capa pública de Subpesca publicada en la IDE de la SMA.
const ECMPO = process.env.ECMPO_URL || "https://ideserver.sma.gob.cl/arcgis/rest/services/IDE/Otras_bajo_proteccion/MapServer/4/query";
const T = "REP_SUBPESCA2.ADM_URB.RRBB_SSP_T_AMERB.", C = "REP_SUBPESCA2.ADM_DDP.";
let cache = { t: 0, key: "", data: null };
async function query(svc, layer, where, extra = "") {
  const out = [];
  for (let off = 0; off < 5000; off += 1000) {
    const u = `${BASE}${svc}/MapServer/${layer}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=true&outSR=4326&geometryPrecision=5${extra}&resultOffset=${off}&resultRecordCount=1000&f=geojson`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (dashboard Asuntos Publicos)" } });
    if (!r.ok) throw new Error("Geoportal " + r.status);
    const j = await r.json(); const f = (j && j.features) || []; out.push(...f);
    if (f.length < 1000) break;
  }
  return out;
}
const pick = (p, suf) => { for (const k in p) if (k.endsWith(suf)) return p[k]; return null; };
const fdate = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "");
function ringCentroid(rings) {
  let best = null, bestA = 0;
  for (const r of rings || []) { let a = 0, x = 0, y = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f; }
    if (Math.abs(a) > bestA && a !== 0) { bestA = Math.abs(a); best = [y / (3 * a), x / (3 * a)]; } }
  if (!best && rings && rings[0] && rings[0].length) { const r = rings[0]; best = [r.reduce((s, p) => s + p[1], 0) / r.length, r.reduce((s, p) => s + p[0], 0) / r.length]; }
  return best;
}
async function ecmpo(boxes) {
  const seen = new Map();
  for (const b of boxes) {
    const u = `${ECMPO}?where=1%3D1&geometry=${encodeURIComponent(b.join(","))}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.002&f=json`;
    const r = await fetch(u, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (dashboard Asuntos Publicos)" } });
    if (!r.ok) throw new Error("IDE SMA " + r.status);
    const j = await r.json(); if (j.error) throw new Error(j.error.message || "IDE SMA");
    for (const f of j.features || []) { const a = f.attributes || {}; const id = a.OBJECTID; if (seen.has(id)) continue; const c = ringCentroid(f.geometry && f.geometry.rings);
      seen.set(id, { n: a.NOMBRE || "", sol: a.SOLICITANT || "", nat: a.NATURALEZA || "", est: a.ESTADO || "", ha: a.SUP_HA, com: a.COMUNA_ || "", reg: a.REGION_ || "", ning: a.N_INGRESOC || "", fing: fdate(a.F_INGRESOC), dec: a.N_DECRETOM || "", fdec: fdate(a.F_DECRETOM), fpm: fdate(a.F_APRUEBAP), lat: c ? c[0] : null, lon: c ? c[1] : null }); }
  }
  return [...seen.values()];
}
export default handler(async (req, res) => {
  if (!(await current(req))) return send(res, 401, { error: "Sin sesión" });
  const regs = String((req.query && req.query.r) || new URL(req.url, "http://x").searchParams.get("r") || "2,4").split(",").map((x) => parseInt(x, 10)).filter((n) => n > 0 && n < 20).slice(0, 6);
  const bq = String(new URL(req.url, "http://x").searchParams.get("b") || "");
  const boxes = bq.split(";").map((t) => t.split(",").map(Number)).filter((a) => a.length === 4 && a.every((v) => isFinite(v) && Math.abs(v) <= 180)).slice(0, 6);
  const key = regs.join(",") + "|" + boxes.map((b) => b.map((v) => v.toFixed(2)).join(",")).join(";");
  // Actualización diaria: se vuelve a consultar al cambiar el día (hora de Chile) o tras 12 horas.
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  if (cache.data && cache.key === key && cache.dia === hoy && Date.now() - cache.t < 12 * 3600e3) return send(res, 200, cache.data);
  const inR = `IN (${regs.join(",") || "2,4"})`;
  const data = { amerb: [], caletas: [], ecmpo: [], fuente: "Geoportal Subpesca (IDE público)", obtenido: new Date().toISOString(), errores: [] };
  await Promise.all([
    (async () => {
      for (const [layer, tipo] of [[0, "Decretada"], [1, "Solicitud"], [2, "Rechazada"]]) {
        try {
          const fs = await query("SRMPUB_AMERB", layer, `${T}C_REGION ${inR}`, "&maxAllowableOffset=0.0003");
          fs.forEach((f) => { const p = f.properties || {}; if (!f.geometry) return;
            data.amerb.push({ tipo, n: pick(p, ".NOMBRE") || "", org: pick(p, ".ORGANIZACION") || "", esp: pick(p, ".ESPECIES") || "", ha: pick(p, ".SUPERFICIE"), est: pick(p, ".DETALLEESTADO") || "", pm: pick(p, ".ESTADO_PM") || "", ce: pick(p, ".C_ESTADOAMERB"), fing: fdate(pick(p, ".F_ING_SSP")), frenov: fdate(pick(p, ".F_DECRETORENOV")), vig: pick(p, ".VIGENCIA") || "", dec: pick(p, ".N_MINECON") || "", fdec: fdate(pick(p, ".F_MINECON")), reg: pick(p, ".C_REGION"), g: f.geometry }); });
        } catch (e) { data.errores.push(`AMERB ${tipo}: ${e.message}`); }
      }
    })(),
    (async () => {
      if (!boxes.length) return;
      try { data.ecmpo = await ecmpo(boxes); } catch (e) { data.errores.push(`ECMPO: ${e.message}`); }
    })(),
    (async () => {
      try {
        const fs = await query("SRMPUB_CALETAS_PESQUERAS", 0, `${C}PART_SSP_T_CALETAS.C_REGION ${inR}`);
        const by = new Map();
        fs.forEach((f) => { const p = f.properties || {}; const g = f.geometry; if (!g || g.type !== "Point") return; const id = pick(p, ".CALETAID"); const anio = pick(p, ".ANIO") || 0; const o = by.get(id);
          if (!o || anio > o.anio) by.set(id, { id, n: pick(p, ".NOMBRE") || "", lon: g.coordinates[0], lat: g.coordinates[1], anio, org: pick(p, ".NROORG"), emb: pick(p, ".NROEMBT"), m: pick(p, ".NROPESM"), h: pick(p, ".NROPESH"), esp: pick(p, "COMPUTOCALETAS.ESPECIES") || "", act: pick(p, ".ACTIVIDADESPRINCIPALES") || "", reg: pick(p, "CALETAS.C_REGION") }); });
        data.caletas = [...by.values()];
      } catch (e) { data.errores.push(`Caletas: ${e.message}`); }
    })(),
  ]);
  if (data.amerb.length || data.caletas.length || data.ecmpo.length) cache = { t: Date.now(), key, data, dia: hoy };
  send(res, 200, data);
});
