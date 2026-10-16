// Indicadores económicos del día (Banco Central de Chile, vía mindicador.cl). Requiere sesión.
import { handler, send, current } from "../lib/core.js";
const DEF = [["dolar", "Dólar observado"], ["euro", "Euro"], ["uf", "UF"], ["utm", "UTM"], ["libra_cobre", "Cobre (libra)"], ["ipc", "IPC mensual"], ["tpm", "TPM (tasa de política monetaria)"]];
let cache = { t: 0, data: null };
export default handler(async (req, res) => {
  if (!(await current(req))) return send(res, 401, { error: "Sin sesión" });
  if (cache.data && Date.now() - cache.t < 30 * 60e3) return send(res, 200, cache.data);
  const items = [];
  await Promise.all(DEF.map(async ([k, nombre]) => {
    try {
      const r = await fetch((process.env.MINDICADOR_BASE || "https://mindicador.cl/api/") + k, { signal: AbortSignal.timeout(6000) });
      const j = await r.json(); const s = j.serie || [];
      if (s.length) items.push({ k, nombre, valor: s[0].valor, fecha: s[0].fecha, prev: s[1] ? s[1].valor : null });
    } catch {}
  }));
  const data = { items, fuente: "mindicador.cl", obtenido: new Date().toISOString() };
  if (items.length) cache = { t: Date.now(), data };
  send(res, 200, data);
});
