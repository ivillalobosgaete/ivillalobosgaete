// Monitor de fuentes oficiales: revisa una vez al día (cron de Vercel) o a pedido del administrador las páginas públicas
// de INDESPA, la Dirección de Obras Portuarias (MOP) y los gobiernos regionales, y registra los enlaces nuevos que
// mencionan pesca artesanal, caletas o las regiones de Antofagasta y Coquimbo. No modifica datos: el administrador
// revisa cada novedad y decide si la agrega a Inversión pública.
// Se guarda en la tabla «vistas» con la clave reservada «#fuentes».
import { handler, send, readBody, current, sb, tableMissing, logAct } from "../lib/core.js";

const KEY = "#fuentes";
const UA = { "User-Agent": "Mozilla/5.0 (Plataforma Borde Costero AAPP Norte; monitor de fuentes publicas)" };
const FUENTES = [
  { id: "indespa_conc", n: "INDESPA · Concursos", u: "https://indespa.gob.cl/concursos/" },
  { id: "indespa_not", n: "INDESPA · Noticias", u: "https://indespa.gob.cl/noticias-indespa/" },
  { id: "dop", n: "MOP · Dirección de Obras Portuarias", u: "https://dop.mop.gob.cl/feed/" },
  { id: "mop_antof", n: "MOP Antofagasta", u: "https://antofagasta.mop.gob.cl/feed/" },
  { id: "gore_antof", n: "Gobierno Regional de Antofagasta", u: "https://goreantofagasta.cl/" },
  { id: "gore_coq", n: "Gobierno Regional de Coquimbo", u: "https://www.gorecoquimbo.cl/" },
];
const CLAVE = /pesca artesanal|pescador|caleta|indespa|acuicultura de peque|marejada|ecmpo|amerb|borde costero|muelle|obras portuarias|fomento productivo/i;
const REGION = /antofagasta|coquimbo|tocopilla|mejillones|taltal|los vilos|canela|la higuera|ovalle|guanaqueros|tongoy|pichidangui|michilla|paposo|cifuncho|chungungo|nacional/i;
const strip = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8211;|&#8212;/g, "–").replace(/&#\d+;/g, "").replace(/\s+/g, " ").trim();

function enlaces(html, base) {
  const out = [];
  if (/<rss|<feed/i.test(html.slice(0, 500))) {
    for (const m of html.matchAll(/<item[\s\S]*?<\/item>/gi)) {
      const it = m[0], t = strip((it.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]), l = strip((it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
      const d = strip((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]), desc = strip((it.match(/<description>([\s\S]*?)<\/description>/i) || [])[1]).slice(0, 400);
      if (t && l) out.push({ t, u: l, f: d ? new Date(d).toISOString().slice(0, 10) : "", x: desc });
    }
    return out;
  }
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const t = strip(m[2]); if (!t || t.length < 12) continue;
    let u; try { u = new URL(m[1], base).href; } catch { continue; }
    if (!/^https?:/.test(u)) continue;
    out.push({ t: t.slice(0, 240), u, f: "", x: "" });
  }
  return out;
}
async function leer() {
  try { const r = await sb(`vistas?usuario=eq.${encodeURIComponent(KEY)}&select=data`); const d = r && r[0] && r[0].data; return d && typeof d === "object" && !Array.isArray(d) ? d : {}; }
  catch (e) { if (tableMissing(e)) return {}; throw e; }
}
async function guardar(d) { await sb("vistas?on_conflict=usuario", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { usuario: KEY, data: d, actualizado: new Date().toISOString() } }); }

async function revisar(por) {
  const d = await leer(); d.items = Array.isArray(d.items) ? d.items : []; d.estado = {};
  const vistos = new Set(d.items.map((x) => x.u)), hoy = new Date().toISOString().slice(0, 10), primera = !d.revisado;
  await Promise.all(FUENTES.map(async (f) => {
    try {
      const r = await fetch(f.u, { signal: AbortSignal.timeout(15000), headers: UA });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const L = enlaces(await r.text(), f.u).filter((x) => CLAVE.test(x.t + " " + x.x) && REGION.test(x.t + " " + x.x + " " + x.u));
      let n = 0;
      for (const x of L) { if (vistos.has(x.u)) continue; vistos.add(x.u); n++; d.items.unshift({ src: f.n, t: x.t, u: x.u, f: x.f, x: x.x, visto: hoy, nuevo: !primera, ok: false }); }
      d.estado[f.id] = { n: f.n, u: f.u, ok: true, encontrados: L.length, nuevos: n };
    } catch (e) { d.estado[f.id] = { n: f.n, u: f.u, ok: false, error: String(e.message || e).slice(0, 160) }; }
  }));
  d.items = d.items.slice(0, 300); d.revisado = new Date().toISOString(); d.por = por || "automático";
  await guardar(d);
  return d;
}

export default handler(async (req, res) => {
  const url = new URL(req.url, "http://x"), cron = url.searchParams.get("cron") === "1";
  if (cron) {
    const auth = req.headers["authorization"] || "", ua = String(req.headers["user-agent"] || "");
    const okCron = process.env.CRON_SECRET ? auth === `Bearer ${process.env.CRON_SECRET}` : /vercel-cron/i.test(ua);
    if (!okCron) return send(res, 401, { error: "No autorizado" });
    try { const d = await revisar("automático"); return send(res, 200, { ok: true, revisado: d.revisado }); }
    catch (e) { if (tableMissing(e)) return send(res, 200, { falta: true }); throw e; }
  }
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo el administrador ve el monitor de fuentes." });
  if (req.method === "GET") { try { return send(res, 200, await leer()); } catch (e) { if (tableMissing(e)) return send(res, 200, { falta: true }); throw e; } }
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  const b = await readBody(req);
  if (b.accion === "revisar") { const d = await revisar(me.usuario); await logAct(me.usuario, "Monitor de fuentes", "Revisión manual"); return send(res, 200, d); }
  if (b.accion === "marcar") {
    const d = await leer(); const it = (d.items || []).find((x) => x.u === String(b.u || ""));
    if (it) { it.ok = !!b.ok; it.nuevo = false; it.por = me.usuario; }
    if (b.todos) (d.items || []).forEach((x) => { x.nuevo = false; });
    await guardar(d); return send(res, 200, d);
  }
  send(res, 400, { error: "Acción no válida" });
});
