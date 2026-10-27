// Indicadores económicos del día (Banco Central de Chile, vía mindicador.cl). Se actualizan una vez al día. Requiere sesión.
import { handler, send, current } from "../lib/core.js";
const DEF = [["dolar", "Dólar observado"], ["euro", "Euro"], ["uf", "UF"], ["utm", "UTM"], ["libra_cobre", "Cobre (libra)"], ["ipc", "IPC mensual"], ["tpm", "TPM (tasa de política monetaria)"]];
let cache = { t: 0, data: null };
let cacheCu = { dia: "", data: null };
export default handler(async (req, res) => {
  if (!(await current(req))) return send(res, 401, { error: "Sin sesión" });
  // Actualización diaria: se consultan una vez por día (hora de Chile).
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
  // Precio promedio anual del cobre (US$/lb, Banco Central vía mindicador.cl) desde 2020, para el contexto minero.
  if (new URL(req.url, "http://x").searchParams.get("cobreAnual")) {
    if (cacheCu.data && cacheCu.dia === hoy) return send(res, 200, cacheCu.data);
    const y1 = +hoy.slice(0, 4), anos = [];
    await Promise.all(Array.from({ length: y1 - 2019 }, (_, i) => 2020 + i).map(async (y) => {
      try {
        const r = await fetch((process.env.MINDICADOR_BASE || "https://mindicador.cl/api/") + "libra_cobre/" + y, { signal: AbortSignal.timeout(8000) });
        const s = ((await r.json()).serie || []).map((x) => +x.valor).filter((v) => v > 0);
        if (s.length) anos.push({ anio: y, prom: s.reduce((a, b) => a + b, 0) / s.length, n: s.length, parcial: y === y1 });
      } catch {}
    }));
    anos.sort((a, b) => a.anio - b.anio);
    const data = { anos, fuente: "Banco Central de Chile vía mindicador.cl", obtenido: new Date().toISOString() };
    if (anos.length) cacheCu = { dia: hoy, data };
    return send(res, 200, data);
  }
  if (cache.data && cache.dia === hoy) return send(res, 200, cache.data);
  const items = [];
  // Primero una sola consulta con todos los indicadores (evita límites por consultas simultáneas); si falla, uno por uno.
  try {
    const r = await fetch((process.env.MINDICADOR_BASE || "https://mindicador.cl/api/"), { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (plataforma AAPP Norte)" } });
    const j = await r.json();
    for (const [k, nombre] of DEF) { const o = j && j[k]; if (o && o.valor != null) items.push({ k, nombre, valor: o.valor, fecha: o.fecha, prev: null }); }
  } catch {}
  if (items.length < DEF.length) for (const [k, nombre] of DEF) { if (items.some((x) => x.k === k)) continue; try {
    const r = await fetch((process.env.MINDICADOR_BASE || "https://mindicador.cl/api/") + k, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (plataforma AAPP Norte)" } });
    const j = await r.json(); const s = j.serie || [];
    if (s.length) items.push({ k, nombre, valor: s[0].valor, fecha: s[0].fecha, prev: s[1] ? s[1].valor : null });
  } catch {} }
  // Variación respecto del valor anterior (solo con la serie de cada indicador, consultada de a una).
  for (const it of items) { if (it.prev != null) continue; try { const r = await fetch((process.env.MINDICADOR_BASE || "https://mindicador.cl/api/") + it.k, { signal: AbortSignal.timeout(5000) }); const s = (await r.json()).serie || []; if (s[1]) it.prev = s[1].valor; } catch {} }
  items.sort((a, b) => DEF.findIndex((d) => d[0] === a.k) - DEF.findIndex((d) => d[0] === b.k));
  if (false) await Promise.all(DEF.map(async ([k, nombre]) => {
    try {
      const r = await fetch((process.env.MINDICADOR_BASE || "https://mindicador.cl/api/") + k, { signal: AbortSignal.timeout(6000) });
      const j = await r.json(); const s = j.serie || [];
      if (s.length) items.push({ k, nombre, valor: s[0].valor, fecha: s[0].fecha, prev: s[1] ? s[1].valor : null });
    } catch {}
  }));
  const data = { items, fuente: "mindicador.cl", obtenido: new Date().toISOString() };
  if (items.length >= Math.min(5, DEF.length)) cache = { t: Date.now(), data, dia: hoy };
  send(res, 200, data);
});
