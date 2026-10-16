import { handler, send, current, sb } from "../lib/core.js";
export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo administradores." });
  const r = await sb("cargas?select=*&order=fecha.desc&limit=30");
  send(res, 200, { cargas: r || [] });
});
