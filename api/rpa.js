// Registro Pesquero Artesanal (Sernapesca, registro público): estado del pescador, caleta base y embarcaciones
// (matrícula, capitanía, caleta, estado y vencimiento). Información pública; se consulta como máximo una vez al día
// por RPA y se guarda en la tabla rpa_cache. Requiere sesión.
// GET /api/rpa?nums=5283,5278   (hasta 12 por llamada)   ·   &forzar=1 (solo administradores)   ·   ?debug=5283 (solo administradores)
import { handler, send, current, sb, tableMissing } from "../lib/core.js";

const BASE = () => (process.env.RPA_BASE || "http://registropublico.sernapesca.cl/reportes/").replace(/\/?$/, "/");
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
const nrm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[:\s]+/g, " ").trim();

async function bajar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { "User-Agent": "Mozilla/5.0 (plataforma AAPP Norte)" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1252").decode(buf); }
}
const ent = (s) => s.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&([aeiouAEIOU])acute;/g, (m, v) => ({ a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" })[v]).replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ").replace(/&ordm;|&deg;/g, "°")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
// Convierte el HTML en filas de celdas (las tablas anidadas quedan como filas propias).
function filas(html) {
  html = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ");
  const rows = []; let row = [], cell = null;
  const flushCell = () => { if (cell !== null) { row.push(ent(cell).replace(/\s+/g, " ").trim()); cell = null; } };
  const flushRow = () => { flushCell(); if (row.some((c) => c)) rows.push(row); row = []; };
  for (const t of html.split(/(<[^>]+>)/)) {
    if (!t) continue;
    if (t[0] === "<") {
      const tag = (t.match(/^<\/?\s*([a-z0-9]+)/i) || [])[1]?.toLowerCase(), close = /^<\//.test(t);
      if (tag === "tr" || tag === "table") { flushRow(); continue; }
      if (tag === "td" || tag === "th") { flushCell(); if (!close) cell = ""; continue; }
      if (tag === "br" || tag === "p" || tag === "div" || tag === "li") { if (cell !== null) cell += " "; else { flushRow(); } continue; }
      continue;
    }
    if (cell !== null) cell += t; else if (t.trim()) { row.push(ent(t).replace(/\s+/g, " ").trim()); }
  }
  flushRow();
  return rows;
}
// Valor de una etiqueta: la celda siguiente no vacía (o el resto de la misma celda tras ":").
function campo(rows, etiquetas, desde = 0) {
  const L = etiquetas.map(nrm);
  for (let r = desde; r < rows.length; r++) {
    const R = rows[r];
    for (let c = 0; c < R.length; c++) {
      const n = nrm(R[c]);
      const hit = L.find((l) => n === l || (n.startsWith(l + " ") && R[c].includes(":")));
      if (!hit) continue;
      if (n !== hit) { const v = R[c].slice(R[c].indexOf(":") + 1).trim(); if (v) return { v, r }; }
      for (let k = c + 1; k < R.length; k++) if (R[k] && nrm(R[k]) !== hit) return { v: R[k], r };
      if (rows[r + 1] && rows[r + 1][c]) return { v: rows[r + 1][c], r: r + 1 };
    }
  }
  return { v: "", r: -1 };
}
const val = (rows, et, d) => { const x = campo(rows, et, d).v; return /^confidencial$/i.test(x) ? "" : x; };
const fecha = (s) => { const m = String(s || "").match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

function tabla(rows, cabecera) {
  const H = cabecera.map(nrm);
  for (let r = 0; r < rows.length; r++) {
    const R = rows[r].map(nrm);
    const idx = H.map((h) => R.findIndex((c) => c === h || c.startsWith(h)));
    if (idx.filter((i) => i >= 0).length < Math.min(3, H.length)) continue;
    const out = [];
    for (let k = r + 1; k < rows.length; k++) {
      const X = rows[k];
      if (!X.length || !/^\d{2,}$/.test((X[idx[0]] || "").trim())) { if (out.length) break; else continue; }
      out.push(idx.map((i) => (i >= 0 ? X[i] || "" : "")));
    }
    if (out.length) return out;
  }
  return [];
}

function parsePescador(html) {
  const rows = filas(html);
  const est = campo(rows, ["Estado"]);
  const cats = new Set(), dgtm = [];
  rows.forEach((R) => {
    const t = R.join(" ");
    if (!/\(\d+\)\s*[A-ZÁÉÍÓÚ]/.test(t)) return;
    (t.match(/\(\d+\)\s*([A-Za-zÁÉÍÓÚáéíóúñÑ ]+?)(?=\s*\(\d+\)|\s+\d{2}[-\/]|$)/g) || []).forEach((m) => cats.add(m.replace(/^\(\d+\)\s*/, "").trim()));
    const f = R.map(fecha).filter(Boolean);
    if (f.length) dgtm.push({ venc: f[0], cat: (t.match(/\(\d+\)[^()]*/g) || []).map((x) => x.replace(/^\(\d+\)\s*/, "").trim()).join(", ") });
  });
  const emb = tabla(rows, ["Código", "Nombre", "Estado", "Tipo"]).map(([cod, nombre, estado, tipo]) => ({ cod: cod.trim(), nombre, estado, tipo }));
  return {
    estado: est.v, inscripcion: fecha(val(rows, ["Fecha Inscripción", "Fecha de Inscripción"])), oficina: val(rows, ["Oficina"]),
    caleta: val(rows, ["Caleta Base", "Caleta"]), comuna: val(rows, ["Comuna CONARA", "Comuna"]), region: val(rows, ["Región", "Region"]),
    categorias: [...cats].slice(0, 8), dgtm: dgtm.slice(0, 6), emb: emb.slice(0, 20),
  };
}
function parseEmbarcacion(html) {
  const rows = filas(html);
  const mat = val(rows, ["Nº Matricula", "N° Matricula", "Nº Matrícula", "N° Matrícula", "Matrícula", "Matricula"]), cap = val(rows, ["Capitania", "Capitanía"]);
  return {
    estado: val(rows, ["Estado"]), matricula: mat ? (cap && !mat.includes("-") ? `${cap}-${mat}` : mat) : "", capitania: cap,
    nombre: val(rows, ["Nombre Embarcación", "Nombre Embarcacion"]), venc: fecha(val(rows, ["Fecha Vencimiento"])),
    caleta: val(rows, ["Caleta Base"]), region: val(rows, ["Región", "Region"]), clasificacion: val(rows, ["Clasificación", "Clasificacion"]),
    eslora: val(rows, ["Eslora (m)", "Eslora"]), bodega: val(rows, ["Bodega (m3)", "Bodega"]), potencia: val(rows, ["Potencia Motor (hp)", "Potencia Motor"]),
    anio: val(rows, ["Año Construcción", "Ano Construccion"]), armador: val(rows, ["Nº Inscripción", "N° Inscripción"]),
  };
}

async function consultar(num) {
  const p = parsePescador(await bajar(`${BASE()}regpescadores_publico/verAction.php?num=${encodeURIComponent(num)}`));
  // Detalle (matrícula, caleta, vencimiento) solo de las embarcaciones activas, para no sobrecargar el registro.
  const act = p.emb.filter((e) => /activ/i.test(e.estado) && !/inactiv/i.test(e.estado)).slice(0, 4);
  await Promise.all(act.map(async (e) => {
    try { Object.assign(e, parseEmbarcacion(await bajar(`${BASE()}regembarcaciones_publico/verAction.php?num=${encodeURIComponent(e.cod)}`)), { cod: e.cod, tipo: e.tipo, estado: e.estado || "" }); }
    catch (er) { e.error = "No se pudo leer la ficha de la embarcación"; }
  }));
  return { ...p, fuente: `${BASE()}regpescadores_publico/verAction.php?num=${num}`, obtenido: new Date().toISOString() };
}

async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const admin = me.rol === "administrador";
  const u = new URL(req.url, "http://x");
  if (u.searchParams.get("debug")) {
    if (!admin) return send(res, 403, { error: "Solo administradores" });
    const n = u.searchParams.get("debug").replace(/\D/g, "");
    const tipo = u.searchParams.get("tipo") === "emb" ? "regembarcaciones_publico" : "regpescadores_publico";
    const html = await bajar(`${BASE()}${tipo}/verAction.php?num=${n}`);
    return send(res, 200, { filas: filas(html).slice(0, 400), parse: tipo === "regembarcaciones_publico" ? parseEmbarcacion(html) : parsePescador(html) });
  }
  const nums = [...new Set((u.searchParams.get("nums") || "").split(",").map((x) => x.replace(/\D/g, "")).filter(Boolean))].slice(0, 12);
  if (!nums.length) return send(res, 400, { error: "Indica los números RPA." });
  const dia = hoy(), forzar = admin && u.searchParams.get("forzar") === "1";
  let cache = [], falta = false;
  try { cache = await sb(`rpa_cache?rpa=in.(${nums.map((n) => `"${n}"`).join(",")})&select=rpa,datos,dia`); }
  catch (e) { if (tableMissing(e)) falta = true; else throw e; }
  const datos = {}, errores = {}, nuevos = [];
  const stale = u.searchParams.get("stale") === "1";
  for (const c of cache || []) if ((c.dia === dia || stale) && !forzar) datos[c.rpa] = c.dia === dia ? c.datos : { ...c.datos, desactualizado: true };
  const pend = nums.filter((n) => !datos[n]);
  await pool(pend, 4, async (n) => {
    try {
      const d = await consultar(n), old = (cache || []).find((c) => c.rpa === n);
      // Alerta de cambio: el pescador pasó de activo a inactivo (o al revés) desde la última consulta.
      const act = (x) => /activ/i.test(x || "") && !/inactiv/i.test(x || "");
      if (old && old.datos && old.datos.estado && d.estado && act(old.datos.estado) !== act(d.estado)) d.cambio = { fecha: dia, txt: `El RPA pasó de «${old.datos.estado}» a «${d.estado}» (detectado el ${dia.split("-").reverse().join("-")}).` };
      else if (old && old.datos && old.datos.cambio) d.cambio = old.datos.cambio;
      datos[n] = d; nuevos.push({ rpa: n, datos: d, dia, actualizado: new Date().toISOString() }); }
    catch (e) {
      const old = (cache || []).find((c) => c.rpa === n);
      if (old) datos[n] = { ...old.datos, desactualizado: true };
      errores[n] = "No se pudo consultar el registro de Sernapesca";
    }
  });
  if (nuevos.length && !falta) { try { await sb("rpa_cache?on_conflict=rpa", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: nuevos }); } catch (e) { if (tableMissing(e)) falta = true; } }
  send(res, 200, { dia, datos, errores, falta });
});
