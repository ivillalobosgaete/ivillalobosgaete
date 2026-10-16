// Vistas guardadas: cada usuario lee y escribe solo las suyas.
import { handler, send, readBody, current, sb, tableMissing } from "../lib/core.js";
export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const where = `vistas?usuario=eq.${encodeURIComponent(me.usuario)}`;
  if (req.method === "GET") {
    try { const r = await sb(where + "&select=data"); return send(res, 200, { data: (r && r[0] && r[0].data) || [] }); }
    catch (e) { if (tableMissing(e)) return send(res, 200, { data: [], falta: true }); throw e; }
  }
  if (req.method !== "PUT") return send(res, 405, { error: "Método no permitido" });
  const b = await readBody(req);
  const data = (Array.isArray(b.data) ? b.data : []).slice(0, 30);
  if (JSON.stringify(data).length > 100000) return send(res, 400, { error: "Las vistas son demasiado grandes." });
  try { await sb("vistas?on_conflict=usuario", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { usuario: me.usuario, data, actualizado: new Date().toISOString() } }); }
  catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de vistas: vuelve a ejecutar supabase/schema.sql en Supabase." }); throw e; }
  send(res, 200, { ok: true });
});
