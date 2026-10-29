// Presupuesto AAPP Norte (cifras internas). Las cifras NO están en el código (el repositorio es público):
// se guardan en la base de datos (tabla vistas, clave reservada «#presupuesto») y solo se entregan a administradores y a usuarios con el
// permiso «presupuesto»; los no administradores deben ingresar además la clave de consulta para verlas. Para modificarlas se exige la clave de edición que define un administrador
// (guardada cifrada, clave reservada «#presupuesto-clave»). Cada cambio queda en la bitácora.
//   GET                                   → cifras + estado
//   POST {accion:"verificar", clave}      → comprueba la clave de edición
//   POST {accion:"clave", nueva}          → (administrador) define o cambia la clave de edición
//   PUT  {clave, data, motivo}            → guarda las cifras (requiere clave)
import { handler, send, readBody, current, sb, tableMissing, logAct, hashPw, checkPw } from "../lib/core.js";

export const puedeVer = (me) => me.rol === "administrador" || !!(me.permisos || {}).presupuesto;
const INT = new Map(); // intentos fallidos de clave por usuario (se reinicia con la función; complementa la bitácora)
function bloqueado(u) { const x = INT.get(u); return x && x.n >= 5 && Date.now() - x.t < 15 * 60e3; }
function fallo(u) { const x = INT.get(u) || { n: 0, t: 0 }; if (Date.now() - x.t > 15 * 60e3) x.n = 0; x.n++; x.t = Date.now(); INT.set(u, x); }

// Limpieza genérica: solo objetos, listas, textos acotados y números finitos (sin funciones ni HTML ejecutable).
function limpiar(v, d = 0) {
  if (d > 8) return null;
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.slice(0, 1500);
  if (Array.isArray(v)) return v.slice(0, 5000).map((x) => limpiar(x, d + 1));
  if (typeof v === "object") { const o = {}; for (const k of Object.keys(v).slice(0, 300)) o[String(k).slice(0, 200)] = limpiar(v[k], d + 1); return o; }
  return null;
}
// Se guardan en la tabla «vistas» con claves reservadas que empiezan con «#»: ningún nombre de usuario puede
// contener ese carácter, así que la ruta /api/vistas nunca las entrega. (La tabla «ajustes» admite una sola fila.)
const KEY = { 5: "#presupuesto", 6: "#presupuesto-clave", 7: "#presupuesto-consulta" };
async function fila(id) {
  try { const r = await sb(`vistas?usuario=eq.${encodeURIComponent(KEY[id])}&select=data,actualizado`); const x = r && r[0]; return x ? { data: x.data && !Array.isArray(x.data) ? x.data.v : null, por: x.data && x.data.por, actualizado: x.actualizado } : null; }
  catch (e) { if (tableMissing(e)) return null; throw e; }
}
async function guardar(id, data, por) {
  await sb("vistas?on_conflict=usuario", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { usuario: KEY[id], data: { v: data, por }, actualizado: new Date().toISOString() } });
}
// Clave de consulta: la exigen los usuarios no administradores para ver las cifras (también sirve la clave de edición).
async function consultaOK(me, clave) {
  if (bloqueado(me.usuario)) return { ok: false, error: "Demasiados intentos fallidos. Espera 15 minutos." };
  const [kc, ke] = await Promise.all([fila(7), fila(6)]);
  if (!kc || !kc.data || !kc.data.hash) return { ok: false, error: "Aún no hay clave de consulta. Pide a un administrador que la defina en Administración." };
  const c = String(clave || "");
  if (!(checkPw(c, kc.data.hash) || (ke && ke.data && ke.data.hash && checkPw(c, ke.data.hash)))) { fallo(me.usuario); await logAct(me.usuario, "Presupuesto", "Clave de consulta incorrecta"); return { ok: false, error: "Clave de consulta incorrecta." }; }
  INT.delete(me.usuario);
  return { ok: true };
}
async function claveOK(me, clave) {
  if (bloqueado(me.usuario)) return { ok: false, error: "Demasiados intentos fallidos. Espera 15 minutos." };
  const k = await fila(6);
  if (!k || !k.data || !k.data.hash) return { ok: false, error: "Aún no hay clave de edición. Un administrador debe definirla en Administración." };
  if (!checkPw(String(clave || ""), k.data.hash)) { fallo(me.usuario); await logAct(me.usuario, "Presupuesto", "Clave de edición incorrecta"); return { ok: false, error: "Clave de edición incorrecta." }; }
  INT.delete(me.usuario);
  return { ok: true };
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const adm = me.rol === "administrador";
  if (req.method === "POST") {
    const b = await readBody(req);
    if (b.accion === "clave") {
      if (!adm) return send(res, 403, { error: "Solo un administrador puede definir las claves del presupuesto." });
      const n = String(b.nueva || ""), cons = b.tipo === "consulta";
      if (n.length < 8) return send(res, 400, { error: "La clave debe tener al menos 8 caracteres." });
      try { await guardar(cons ? 7 : 6, { hash: hashPw(n) }, me.usuario); }
      catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de vistas: ejecuta supabase/schema.sql en Supabase." }); throw e; }
      await logAct(me.usuario, "Presupuesto", cons ? "Definió o cambió la clave de consulta" : "Definió o cambió la clave de edición");
      return send(res, 200, { ok: true });
    }
    if (!puedeVer(me)) return send(res, 403, { error: "Sin acceso al presupuesto." });
    if (b.accion === "verificar") { const r = await claveOK(me, b.clave); return send(res, r.ok ? 200 : 403, r); }
    if (b.accion === "leer") {
      if (!adm) { const r = await consultaOK(me, b.clave); if (!r.ok) return send(res, 403, r); await logAct(me.usuario, "Presupuesto", "Consultó el presupuesto"); }
      const [d, k] = await Promise.all([fila(5), fila(6)]);
      return send(res, 200, { data: d ? d.data : null, por: d ? d.por : null, actualizado: d ? d.actualizado : null, tieneClave: !!(k && k.data && k.data.hash), admin: adm });
    }
    return send(res, 400, { error: "Acción no reconocida." });
  }
  if (!puedeVer(me)) return send(res, 403, { error: "Sin acceso al presupuesto." });
  if (req.method === "GET") {
    const [d, k, kc] = await Promise.all([adm ? fila(5) : null, fila(6), fila(7)]);
    const tc = !!(kc && kc.data && kc.data.hash);
    // Usuarios no administradores: sin cifras hasta ingresar la clave de consulta (POST {accion:"leer"}).
    if (!adm) return send(res, 200, { bloqueado: true, tieneConsulta: tc, tieneClave: !!(k && k.data && k.data.hash), admin: false });
    return send(res, 200, { data: d ? d.data : null, por: d ? d.por : null, actualizado: d ? d.actualizado : null, tieneClave: !!(k && k.data && k.data.hash), tieneConsulta: tc, admin: adm });
  }
  if (req.method !== "PUT") return send(res, 405, { error: "Método no permitido" });
  const b = await readBody(req);
  const r = await claveOK(me, b.clave);
  if (!r.ok) return send(res, 403, r);
  const data = limpiar(b.data);
  if (!data || typeof data !== "object" || !data.lom) return send(res, 400, { error: "Los datos no tienen el formato esperado." });
  if (JSON.stringify(data).length > 3e6) return send(res, 400, { error: "Los datos son demasiado grandes." });
  try { await guardar(5, data, me.usuario); }
  catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de vistas: ejecuta supabase/schema.sql en Supabase." }); throw e; }
  await logAct(me.usuario, "Presupuesto", String(b.motivo || "Actualizó las cifras").slice(0, 200));
  send(res, 200, { ok: true });
});
