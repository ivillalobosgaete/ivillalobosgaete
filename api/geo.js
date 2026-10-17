// Capas públicas del Geoportal de Subpesca (IDE_PUBLICO): AMERB y caletas pesqueras artesanales.
// Se consultan desde el servidor (sin problemas de CORS) y se guardan en memoria 12 horas. Requiere sesión.
import { handler, send, current } from "../lib/core.js";
const BASE = process.env.GEO_BASE || "https://geoportal.subpesca.cl/server/rest/services/IDE_PUBLICO/";
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
export default handler(async (req, res) => {
  if (!(await current(req))) return send(res, 401, { error: "Sin sesión" });
  const regs = String((req.query && req.query.r) || new URL(req.url, "http://x").searchParams.get("r") || "2,4").split(",").map((x) => parseInt(x, 10)).filter((n) => n > 0 && n < 20).slice(0, 6);
  const key = regs.join(",");
  if (cache.data && cache.key === key && Date.now() - cache.t < 12 * 3600e3) return send(res, 200, cache.data);
  const inR = `IN (${regs.join(",") || "2,4"})`;
  const data = { amerb: [], caletas: [], fuente: "Geoportal Subpesca (IDE público)", obtenido: new Date().toISOString(), errores: [] };
  await Promise.all([
    (async () => {
      for (const [layer, tipo] of [[0, "Decretada"], [1, "Solicitud"]]) {
        try {
          const fs = await query("SRMPUB_AMERB", layer, `${T}C_REGION ${inR}`, "&maxAllowableOffset=0.0003");
          fs.forEach((f) => { const p = f.properties || {}; if (!f.geometry) return;
            data.amerb.push({ tipo, n: pick(p, ".NOMBRE") || "", org: pick(p, ".ORGANIZACION") || "", esp: pick(p, ".ESPECIES") || "", ha: pick(p, ".SUPERFICIE"), est: pick(p, ".DETALLEESTADO") || "", pm: pick(p, ".ESTADO_PM") || "", vig: pick(p, ".VIGENCIA") || "", dec: pick(p, ".N_MINECON") || "", fdec: fdate(pick(p, ".F_MINECON")), reg: pick(p, ".C_REGION"), g: f.geometry }); });
        } catch (e) { data.errores.push(`AMERB ${tipo}: ${e.message}`); }
      }
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
  if (data.amerb.length || data.caletas.length) cache = { t: Date.now(), key, data };
  send(res, 200, data);
});
