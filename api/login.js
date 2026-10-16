import { handler, send, readBody, uname, getUser, checkPw, ensureAdmin, makeToken, setCookie, publicUser } from "../lib/core.js";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export default handler(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  await ensureAdmin();
  const b = await readBody(req);
  const id = uname(b.usuario);
  const u = id ? await getUser(id) : null;
  if (!u || !checkPw(b.password || "", u.hash)) { await wait(700); return send(res, 401, { error: "Usuario o contraseña incorrectos.", code: "cred" }); }
  if (u.estado === "pendiente") return send(res, 403, { error: "Cuenta pendiente de aprobación.", code: "pend" });
  if (u.estado !== "activo") return send(res, 403, { error: "Cuenta suspendida.", code: "susp" });
  send(res, 200, { user: publicUser(u) }, { "Set-Cookie": setCookie(makeToken(u.usuario)) });
});
