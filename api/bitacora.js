// Bitácora de relacionamiento (reuniones, compromisos, acuerdos, conflictos). Solo administradores.
import { handler, send, readBody, current, sb, tableMissing, logAct } from "../lib/core.js";

const TIPOS = ["Reunión", "Compromiso", "Acuerdo", "Conflicto", "Otro"];
const ESTADOS = ["Pendiente", "Cumplido", "No aplica"];
const txt = (v, n) => String(v ?? "").trim().slice(0, n);

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede ver la bitácora." });
  if (req.method === "GET") {
    try { const r = await sb("bitacora?select=*&order=fecha.desc&limit=5000"); return send(res, 200, { items: r || [] }); }
    catch (e) { if (tableMissing(e)) return send(res, 200, { items: [], falta: true }); throw e; }
  }
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  const b = await readBody(req);
  if (b.accion === "eliminar") {
    const id = Number(b.id); if (!id) return send(res, 400, { error: "Registro no válido." });
    await sb(`bitacora?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
    await logAct(me.usuario, "Bitácora", `Eliminó el registro ${id}`);
    return send(res, 200, { ok: true });
  }
  const row = {
    clave: txt(b.clave, 120), actor: txt(b.actor, 120), fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha)) ? b.fecha : new Date().toISOString().slice(0, 10),
    tipo: TIPOS.includes(b.tipo) ? b.tipo : "Otro", estado: ESTADOS.includes(b.estado) ? b.estado : "Pendiente",
    responsable: txt(b.responsable, 80), texto: txt(b.texto, 1500),
  };
  if (!row.clave || !row.texto) return send(res, 400, { error: "Falta el actor o el detalle." });
  try {
    if (b.accion === "editar") {
      const id = Number(b.id); if (!id) return send(res, 400, { error: "Registro no válido." });
      await sb(`bitacora?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: row });
      await logAct(me.usuario, "Bitácora", `${row.actor}: ${row.tipo} (${row.estado})`);
      return send(res, 200, { ok: true, id });
    }
    const r = await sb("bitacora", { method: "POST", prefer: "return=representation", body: { ...row, por: me.usuario } });
    await logAct(me.usuario, "Bitácora", `${row.actor}: ${row.tipo}`);
    send(res, 200, { ok: true, id: r && r[0] && r[0].id });
  } catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de bitácora: vuelve a ejecutar supabase/schema.sql en Supabase." }); throw e; }
});
