// Información complementaria que ingresa un administrador cuando a la plataforma le falta un dato
// (por ejemplo el registro oficial de una caleta, su ubicación o el monto de una RCA).
// Se guarda en la tabla «vistas» con la clave reservada «#complementos» (ningún usuario puede tener «#» en su nombre).
//   GET  → datos complementarios visibles para el usuario (los de caletas se filtran según sus permisos)
//   PUT  {key, valor, c}  → (solo administrador) guarda o, con valor vacío, elimina un dato
import { handler, send, readBody, current, sb, tableMissing, logAct, zonaDe } from "../lib/core.js";

const KEY = "#complementos";
async function leer() {
  try { const r = await sb(`vistas?usuario=eq.${encodeURIComponent(KEY)}&select=data`); const d = r && r[0] && r[0].data; return d && typeof d === "object" && !Array.isArray(d) ? d : {}; }
  catch (e) { if (tableMissing(e)) return {}; throw e; }
}
function limpiarValor(v, d = 0) {
  if (v == null || d > 2) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const s = v.trim().slice(0, 600); return s || null; }
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = {}; for (const k of Object.keys(v).slice(0, 12)) { const x = limpiarValor(v[k], d + 1); if (x != null) o[String(k).slice(0, 30)] = x; }
    return Object.keys(o).length ? o : null;
  }
  return null;
}
// Datos de una caleta (c = [nombre, comuna, , región]): mismas reglas de acceso que el modelo de desembarque.
function caletaOK(me, c) {
  if (me.rol === "administrador" || !Array.isArray(c)) return true;
  const com = me.comunas || [], cal = (me.permisos || {}).caletas || [], zon = (me.permisos || {}).zonas || [];
  const soloCom = com.length && !cal.length && !zon.length;
  return (!com.length || com.includes(c[1])) && (!cal.length || cal.includes(c[0])) && (!zon.length || zon.includes(zonaDe(c))) && !(soloCom && zonaDe(c) === "aim");
}
function visibles(me, all) {
  const out = {};
  for (const [k, x] of Object.entries(all)) {
    if (!x || typeof x !== "object") continue;
    if (k.startsWith("cal:") && !caletaOK(me, x.c)) continue;
    out[k] = me.rol === "administrador" ? x : { v: x.v, c: x.c };
  }
  return out;
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (req.method === "GET") return send(res, 200, { items: visibles(me, await leer()) });
  if (req.method !== "PUT") return send(res, 405, { error: "Método no permitido" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede completar información faltante." });
  const b = await readBody(req);
  const key = String(b.key || "").slice(0, 200);
  if (!/^[a-z]+:.+/.test(key)) return send(res, 400, { error: "Clave no válida." });
  const valor = limpiarValor(b.valor);
  const c = Array.isArray(b.c) ? b.c.slice(0, 4).map((x) => String(x == null ? "" : x).slice(0, 120)) : null;
  const all = await leer();
  if (valor == null) delete all[key];
  else all[key] = { v: valor, c, por: me.usuario, f: new Date().toISOString() };
  if (Object.keys(all).length > 3000) return send(res, 400, { error: "Se alcanzó el máximo de datos complementarios." });
  try { await sb("vistas?on_conflict=usuario", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { usuario: KEY, data: all, actualizado: new Date().toISOString() } }); }
  catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de vistas: ejecuta supabase/schema.sql en Supabase." }); throw e; }
  await logAct(me.usuario, "Información complementaria", `${valor == null ? "Eliminó" : "Completó"} ${key}`.slice(0, 200));
  send(res, 200, { ok: true, items: visibles(me, all) });
});
