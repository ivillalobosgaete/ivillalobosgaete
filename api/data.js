// GET: datos para el usuario con sesión (con sus restricciones). PUT: reemplaza la base (solo administradores).
import { handler, send, readBody, current, sb, scopeGz, zlib } from "../lib/core.js";
export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (req.method === "GET") {
    const r = await sb("datos?id=eq.1&select=*");
    const d = r && r[0];
    if (!d) return send(res, 200, { vacio: true });
    return send(res, 200, { meta: { archivo: d.archivo, filas: d.filas, desde: d.desde, hasta: d.hasta, actualizado: d.actualizado }, gz: scopeGz(d.gz, me) });
  }
  if (req.method !== "PUT") return send(res, 405, { error: "Método no permitido" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede modificar los datos." });
  const b = await readBody(req);
  let m;
  try { m = JSON.parse(zlib.gunzipSync(Buffer.from(String(b.gz || ""), "base64")).toString("utf8")); } catch { return send(res, 400, { error: "El archivo enviado no es válido." }); }
  if (!m || !m.cols || !Array.isArray(m.cols.d) || !Array.isArray(m.P)) return send(res, 400, { error: "El archivo enviado no tiene el formato esperado." });
  const filas = m.cols.d.length;
  await sb("datos?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 1, gz: b.gz, archivo: String(b.archivo || "").slice(0, 200), filas, desde: String(b.desde || ""), hasta: String(b.hasta || ""), por: me.usuario, actualizado: new Date().toISOString() } });
  await sb("cargas", { method: "POST", prefer: "return=minimal", body: { por: me.usuario, archivo: String(b.archivo || "").slice(0, 200), modo: String(b.modo || ""), nuevas: Number(b.nuevas) || 0, filas } });
  send(res, 200, { ok: true, filas });
});
