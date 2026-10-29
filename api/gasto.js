// Gasto social e inversión social de las compañías del norte (cifras internas, miles de USD).
// Las cifras NO están en el código (el repositorio es público): se guardan en la base de datos (ajustes, fila 4)
// y solo se entregan a administradores y a usuarios con la zona Asuntos Públicos Norte sin restricción por caleta.
//   GET → cifras guardadas (o vacío).   PUT → (administrador) guarda las cifras editadas o importadas.
import { handler, send, readBody, current, sb, tableMissing, logAct } from "../lib/core.js";

const CATS = ["aapp", "cias", "mit", "obl", "rca"];
const txt = (s, n = 120) => String(s == null ? "" : s).trim().slice(0, n);
export function puedeVer(me) {
  if (me.rol === "administrador") return true;
  const p = me.permisos || {};
  return Array.isArray(p.zonas) && p.zonas.includes("norte") && !(Array.isArray(p.caletas) && p.caletas.length);
}
function limpiar(d = {}) {
  const desde = Math.min(2100, Math.max(2000, Math.round(Number(d.desde) || 2020)));
  const n = Math.min(20, Math.max(1, Math.round(Number(d.anios) || 11)));
  const real = Math.min(desde + n - 1, Math.max(desde - 1, Math.round(Number(d.real) || desde)));
  const num = (v) => { const x = Math.round(Number(v) * 10) / 10; return Number.isFinite(x) ? Math.max(-1e7, Math.min(1e7, x)) : 0; };
  const cias = (Array.isArray(d.cias) ? d.cias : []).slice(0, 12).map((c) => ({
    k: txt(c.k, 12).toLowerCase().replace(/[^a-z0-9]/g, "") || "x", n: txt(c.n, 80), nota: txt(c.nota, 300),
    lineas: (Array.isArray(c.lineas) ? c.lineas : []).slice(0, 40).map((l) => ({
      n: txt(l.n, 100), cat: CATS.includes(l.cat) ? l.cat : "aapp",
      v: Array.from({ length: n }, (_, i) => num((l.v || [])[i])),
    })).filter((l) => l.n),
  })).filter((c) => c.n);
  return { desde, anios: n, real, moneda: "miles de USD", nota: txt(d.nota, 500), cias };
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (!puedeVer(me)) return send(res, 403, { error: "Sin acceso a esta información." });
  if (req.method === "GET") {
    try { const r = await sb("ajustes?id=eq.4&select=data,por,actualizado"); const x = r && r[0]; return send(res, 200, { data: (x && x.data) || null, por: x ? x.por : null, actualizado: x ? x.actualizado : null, admin: me.rol === "administrador" }); }
    catch (e) { if (tableMissing(e)) return send(res, 200, { data: null, admin: me.rol === "administrador" }); throw e; }
  }
  if (req.method !== "PUT") return send(res, 405, { error: "Método no permitido" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede editar estas cifras." });
  const data = limpiar((await readBody(req)).data);
  if (!data.cias.length) return send(res, 400, { error: "No hay compañías con datos." });
  try { await sb("ajustes?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 4, data, por: me.usuario, actualizado: new Date().toISOString() } }); }
  catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de ajustes: ejecuta supabase/schema.sql en Supabase." }); throw e; }
  await logAct(me.usuario, "Gasto social", `${data.cias.length} compañías, ${data.desde}–${data.desde + data.anios - 1}`);
  send(res, 200, { ok: true });
});
