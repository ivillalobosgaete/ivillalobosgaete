// Ajustes generales: precios de playa, vedas y umbral de alertas.
// GET: cualquier usuario activo. PUT: solo administradores.
import { handler, send, readBody, current, sb, tableMissing, logAct } from "../lib/core.js";

function clean(d = {}) {
  const precios = {};
  for (const [k, v] of Object.entries(d.precios || {}).slice(0, 2000)) { const n = Math.round(Number(v)); if (n > 0 && n < 1e8) precios[String(k).slice(0, 20)] = n; }
  const vedas = (Array.isArray(d.vedas) ? d.vedas : []).slice(0, 300).map((v) => ({
    esp: (Array.isArray(v.esp) ? v.esp : []).slice(0, 20).map((x) => String(x).slice(0, 20)),
    zona: String(v.zona || "").slice(0, 80), desde: Math.min(11, Math.max(0, Math.round(Number(v.desde) || 0))), hasta: Math.min(11, Math.max(0, Math.round(Number(v.hasta) || 0))), nota: String(v.nota || "").slice(0, 120),
  })).filter((v) => v.esp.length);
  const a = d.alertas || {};
  const alertas = { umbral: Math.min(90, Math.max(5, Number(a.umbral) || 30)), minT: Math.max(0, Number(a.minT) || 0) };
  return { precios, vedas, alertas };
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (req.method === "GET") {
    try { const r = await sb("ajustes?id=eq.1&select=data"); return send(res, 200, { data: (r && r[0] && r[0].data) || {} }); }
    catch (e) { if (tableMissing(e)) return send(res, 200, { data: {}, falta: true }); throw e; }
  }
  if (req.method !== "PUT") return send(res, 405, { error: "Método no permitido" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede cambiar los ajustes." });
  const b = await readBody(req);
  const data = clean(b.data);
  try { await sb("ajustes?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 1, data, por: me.usuario, actualizado: new Date().toISOString() } }); }
  catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de ajustes: vuelve a ejecutar supabase/schema.sql en Supabase." }); throw e; }
  await logAct(me.usuario, "Ajustes", `${Object.keys(data.precios).length} precios, ${data.vedas.length} vedas, alertas ${data.alertas.umbral} %`);
  send(res, 200, { ok: true });
});
