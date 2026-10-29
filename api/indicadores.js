// Indicadores económicos del día con varias fuentes en cascada y respaldo del último dato válido. Requiere sesión.
//  1) Banco Central de Chile vía mindicador.cl (dólar, euro, UF, UTM, IPC, TPM, cobre).
//  2) CMF Chile (API oficial; opcional, variable CMF_APIKEY) para dólar, euro, UF, UTM e IPC si faltan.
//  3) ExchangeRate-API (open.er-api.com, referencial, requiere atribución) para dólar y euro si aún faltan.
//  4) Metales preciosos: gold-api.com (oro y plata, USD por onza troy).
//  5) Molibdeno: valor ingresado por un administrador (no hay fuente pública gratuita diaria).
//  Si una fuente falla, se muestra el último valor obtenido (guardado en la base de datos) marcado como «último dato disponible».
import { handler, send, current, sb, readBody, tableMissing, logAct } from "../lib/core.js";
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
  if (req.method === "POST") {
    const me = await current(req);
    if (!me || me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede ingresar valores manuales." });
    const b = await readBody(req), v = Number(b.valor), f = String(b.fecha || "").slice(0, 10);
    if (!(v > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return send(res, 400, { error: "Ingresa un valor mayor que cero y una fecha válida." });
    const man = (await kv("#indicadores-manual")) || {};
    man.molibdeno = { valor: Math.round(v * 100) / 100, fecha: f, fuente: String(b.fuente || "Ingreso manual").slice(0, 120) };
    await kvSet("#indicadores-manual", man);
    await logAct(me.usuario, "Indicadores", `Molibdeno ${man.molibdeno.valor} USD/lb al ${f}`);
    cache = { t: 0, data: null };
    return send(res, 200, { ok: true });
  }
  if (cache.data && cache.dia === hoy && Date.now() - cache.t < 3 * 3600e3) return send(res, 200, cache.data);
  const items = new Map(), fuentes = new Set(), add = (it) => { if (it && it.valor != null && isFinite(it.valor) && !items.has(it.k)) items.set(it.k, it) };
  const MB = process.env.MINDICADOR_BASE || "https://mindicador.cl/api/", UA = { "User-Agent": "Mozilla/5.0 (plataforma AAPP Norte)", Accept: "application/json" };
  const get = async (url, ms = 9000, tries = 2) => { for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: UA }); if (r.ok) return await r.json(); } catch {} } return null; };
  // 1) mindicador.cl
  const j = await get(MB);
  if (j) for (const [k, nombre] of DEF) { const o = j[k]; if (o && o.valor != null) { add({ k, nombre, valor: +o.valor, fecha: o.fecha, prev: null, fuente: "Banco Central de Chile (mindicador.cl)" }); fuentes.add("Banco Central de Chile vía mindicador.cl"); } }
  // Variación respecto del valor anterior (dólar, euro, UF, cobre)
  await Promise.all(["dolar", "euro", "uf", "libra_cobre"].filter((k) => items.has(k)).map(async (k) => { const s = ((await get(MB + k, 5000, 1)) || {}).serie || []; if (s[1]) items.get(k).prev = +s[1].valor; }));
  // 2) CMF (opcional)
  const CMF = process.env.CMF_APIKEY;
  if (CMF) {
    const map = { dolar: ["dolar", "Dolares"], euro: ["euro", "Euros"], uf: ["uf", "UFs"], utm: ["utm", "UTMs"], ipc: ["ipc", "IPCs"] };
    await Promise.all(Object.entries(map).filter(([k]) => !items.has(k)).map(async ([k, [rec, key]]) => {
      const r = await get(`${process.env.CMF_BASE || "https://api.cmfchile.cl/api-sbifv3/recursos_api/"}${rec}?apikey=${encodeURIComponent(CMF)}&formato=json`, 8000, 1);
      const x = r && r[key] && r[key][0]; if (!x) return;
      const v = Number(String(x.Valor).replace(/\./g, "").replace(",", "."));
      if (v) { add({ k, nombre: DEF.find((d) => d[0] === k)[1], valor: v, fecha: x.Fecha, prev: null, fuente: "Comisión para el Mercado Financiero (CMF)" }); fuentes.add("CMF Chile"); }
    }));
  }
  // 3) ExchangeRate-API (referencial) para dólar y euro
  if (!items.has("dolar") || !items.has("euro")) {
    const r = await get(process.env.ER_BASE || "https://open.er-api.com/v6/latest/USD", 8000, 1);
    if (r && r.rates && r.rates.CLP) {
      const f = r.time_last_update_unix ? new Date(r.time_last_update_unix * 1000).toISOString() : new Date().toISOString();
      add({ k: "dolar", nombre: "Dólar (referencial)", valor: r.rates.CLP, fecha: f, prev: null, fuente: "ExchangeRate-API (referencial, no es el dólar observado)" });
      if (r.rates.EUR) add({ k: "euro", nombre: "Euro (referencial)", valor: r.rates.CLP / r.rates.EUR, fecha: f, prev: null, fuente: "ExchangeRate-API (referencial)" });
      fuentes.add("ExchangeRate-API"); }
  }
  // 4) Metales preciosos (USD por onza troy)
  const GB = process.env.GOLDAPI_BASE || "https://api.gold-api.com/price/";
  await Promise.all([["oro", "Oro (onza troy)", "XAU"], ["plata", "Plata (onza troy)", "XAG"], ["cobre_spot", "Cobre spot (libra)", "HG"]].map(async ([k, nombre, sym]) => {
    if (k === "cobre_spot" && items.has("libra_cobre")) return;
    const r = await get(GB + sym, 7000, 1); if (r && +r.price > 0) { add({ k, nombre, valor: +r.price, fecha: r.updatedAt || new Date().toISOString(), prev: null, fuente: "gold-api.com" }); fuentes.add("gold-api.com"); }
  }));
  // 5) Molibdeno (manual)
  const man = (await kv("#indicadores-manual")) || {};
  if (man.molibdeno) add({ k: "molibdeno", nombre: "Molibdeno (libra)", valor: man.molibdeno.valor, fecha: man.molibdeno.fecha, prev: null, fuente: man.molibdeno.fuente, manual: true });
  // Respaldo: último dato válido de cada indicador
  const last = (await kv("#indicadores-cache")) || { items: [] };
  for (const it of last.items || []) if (!items.has(it.k)) items.set(it.k, { ...it, stale: true });
  const ORD = ["dolar", "euro", "uf", "utm", "ipc", "tpm", "libra_cobre", "cobre_spot", "oro", "plata", "molibdeno"];
  const out = [...items.values()].sort((a, b) => ORD.indexOf(a.k) - ORD.indexOf(b.k));
  const fresh = out.filter((x) => !x.stale);
  const data = { items: out, fuentes: [...fuentes], fuente: [...fuentes].join(" · ") || "último dato disponible", obtenido: new Date().toISOString(), atrib: out.some((x) => /ExchangeRate/.test(x.fuente || "")) ? { texto: "Rates By Exchange Rate API", url: "https://www.exchangerate-api.com" } : null };
  if (fresh.length) { const merged = new Map((last.items || []).map((x) => [x.k, x])); fresh.filter((x) => !x.manual).forEach(({ stale, ...x }) => merged.set(x.k, x)); await kvSet("#indicadores-cache", { items: [...merged.values()] }).catch(() => {}); if (fresh.length >= 5) cache = { t: Date.now(), data, dia: hoy }; }
  send(res, 200, data);
});
// Almacenamiento simple en la tabla «vistas» con claves reservadas («#…» no puede ser un nombre de usuario).
async function kv(key) { try { const r = await sb(`vistas?usuario=eq.${encodeURIComponent(key)}&select=data`); return r && r[0] ? r[0].data : null; } catch (e) { return null; } }
async function kvSet(key, data) { await sb("vistas?on_conflict=usuario", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { usuario: key, data, actualizado: new Date().toISOString() } }); }
