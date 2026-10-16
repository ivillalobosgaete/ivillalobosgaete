import { handler, send, current, publicUser } from "../lib/core.js";
export default handler(async (req, res) => {
  const u = await current(req);
  if (!u) return send(res, 401, { error: "Sin sesión" });
  send(res, 200, { user: publicUser(u) });
});
