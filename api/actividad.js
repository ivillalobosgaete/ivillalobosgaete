// Registro de actividad. GET: solo administradores. POST: eventos del navegador (reporte, exportación).
import { handler, send, readBody, current, sb, tableMissing, logAct } from "../lib/core.js";
const PERMITIDAS = ["Reporte ejecutivo", "Exportar CSV", "Escenarios de negociación"];
export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (req.method === "GET") {
    if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede ver el registro." });
    try { const r = await sb("actividad?select=*&order=fecha.desc&limit=200"); return send(res, 200, { items: r || [] }); }
    catch (e) { if (tableMissing(e)) return send(res, 200, { items: [], falta: true }); throw e; }
  }
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  const b = await readBody(req);
  if (!PERMITIDAS.includes(b.accion)) return send(res, 400, { error: "Acción no válida." });
  await logAct(me.usuario, b.accion, b.detalle);
  send(res, 200, { ok: true });
});
