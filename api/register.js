import { handler, send, readBody, uname, getUser, hashPw, sb } from "../lib/core.js";
const clip = (s, n) => String(s || "").trim().slice(0, n);
export default handler(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  const b = await readBody(req);
  const id = uname(b.usuario);
  if (id.length < 3) return send(res, 400, { error: "El usuario debe tener al menos 3 letras o números (sin espacios)." });
  if (String(b.password || "").length < 8) return send(res, 400, { error: "La contraseña debe tener al menos 8 caracteres." });
  if (!clip(b.nombre, 80)) return send(res, 400, { error: "Escribe tu nombre." });
  if (await getUser(id)) return send(res, 409, { error: "Ese usuario ya existe. Elige otro." });
  await sb("usuarios", { method: "POST", prefer: "return=minimal", body: { usuario: id, nombre: clip(b.nombre, 80), cargo: clip(b.cargo, 80), area: clip(b.area, 80), motivo: clip(b.motivo, 400), hash: hashPw(b.password), rol: "visualizador", estado: "pendiente", permisos: { nombres: true, exportar: false }, comunas: [] } });
  send(res, 200, { usuario: id });
});
