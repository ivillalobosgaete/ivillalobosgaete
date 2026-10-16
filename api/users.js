// Administración de usuarios (solo administradores). Todas las reglas se validan aquí, en el servidor.
import { handler, send, readBody, current, sb, uname, publicUser, getUser, hashPw, logAct } from "../lib/core.js";

const txt = (v, n = 80) => String(v ?? "").trim().slice(0, n);
const rolOf = (r) => (r === "administrador" ? "administrador" : "visualizador");
const permsOf = (p = {}) => ({ exportar: !!p.exportar, nombres: p.nombres !== false });
const comunasOf = (rol, c) => (rol === "administrador" || !Array.isArray(c) ? [] : c.map((x) => txt(x, 60)).filter(Boolean).slice(0, 50));
const where = (id) => `usuarios?usuario=eq.${encodeURIComponent(id)}`;
const patchUser = (id, body) => sb(where(id), { method: "PATCH", body, prefer: "return=minimal" });

async function otherActiveAdmins(id) {
  const r = await sb("usuarios?select=usuario&rol=eq.administrador&estado=eq.activo");
  return (r || []).filter((u) => u.usuario !== id).length;
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede hacer esto." });

  if (req.method === "GET") {
    const r = await sb("usuarios?select=*&order=creado.desc");
    return send(res, 200, { usuarios: (r || []).map(publicUser) });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });

  const b = await readBody(req);
  const id = uname(b.usuario);
  const accion = b.accion;

  // Crear un usuario nuevo directamente (queda activo).
  if (accion === "crear") {
    if (id.length < 3 || id.length > 40) return send(res, 400, { error: "El usuario debe tener entre 3 y 40 letras o números (sin espacios)." });
    if (String(b.password || "").length < 8) return send(res, 400, { error: "La contraseña debe tener al menos 8 caracteres." });
    if (!txt(b.nombre)) return send(res, 400, { error: "Escribe el nombre." });
    if (await getUser(id)) return send(res, 409, { error: "Ese usuario ya existe. Elige otro." });
    const rol = rolOf(b.rol);
    await sb("usuarios", {
      method: "POST", prefer: "return=minimal",
      body: { usuario: id, nombre: txt(b.nombre), cargo: txt(b.cargo), area: txt(b.area), motivo: "", hash: hashPw(String(b.password)), rol, estado: "activo", permisos: permsOf(b.permisos), comunas: comunasOf(rol, b.comunas), aprobado_por: me.usuario }
    });
    await logAct(me.usuario, "Usuarios", `Creó a ${id}`);
    return send(res, 200, { ok: true });
  }

  const u = id && (await getUser(id));
  if (!u) return send(res, 404, { error: "Usuario no encontrado." });
  const self = id === me.usuario;
  const isActiveAdmin = u.rol === "administrador" && u.estado === "activo";

  if (accion === "editar") {
    if (!txt(b.nombre)) return send(res, 400, { error: "Escribe el nombre." });
    const rol = self ? u.rol : rolOf(b.rol);
    if (isActiveAdmin && rol !== "administrador" && !(await otherActiveAdmins(id))) return send(res, 400, { error: "Debe quedar al menos un administrador activo." });
    await patchUser(id, { nombre: txt(b.nombre), cargo: txt(b.cargo), area: txt(b.area), rol, permisos: permsOf(b.permisos), comunas: comunasOf(rol, b.comunas) });
    await logAct(me.usuario, "Usuarios", `Editó a ${id}`);
    return send(res, 200, { ok: true });
  }
  if (accion === "password") {
    if (String(b.password || "").length < 8) return send(res, 400, { error: "La contraseña debe tener al menos 8 caracteres." });
    await patchUser(id, { hash: hashPw(String(b.password)) });
    await logAct(me.usuario, "Usuarios", `Cambió la contraseña de ${id}`);
    return send(res, 200, { ok: true });
  }

  // Las siguientes acciones no se pueden aplicar a la propia cuenta.
  if (self) return send(res, 400, { error: "No puedes suspender, rechazar ni eliminar tu propia cuenta." });

  if (accion === "aprobar") {
    const rol = rolOf(b.rol);
    const body = { estado: "activo", rol, permisos: permsOf(b.permisos), comunas: comunasOf(rol, b.comunas), aprobado_por: me.usuario };
    if (b.nombre !== undefined) Object.assign(body, { nombre: txt(b.nombre), cargo: txt(b.cargo), area: txt(b.area) });
    await patchUser(id, body);
    await logAct(me.usuario, "Usuarios", `Aprobó a ${id}`);
    return send(res, 200, { ok: true });
  }
  if (accion === "rechazar") { await patchUser(id, { estado: "rechazado" }); await logAct(me.usuario, "Usuarios", `Rechazó a ${id}`); return send(res, 200, { ok: true }); }
  if (accion === "suspender" || accion === "eliminar") {
    if (isActiveAdmin && !(await otherActiveAdmins(id))) return send(res, 400, { error: "Debe quedar al menos un administrador activo." });
    if (accion === "suspender") await patchUser(id, { estado: "suspendido" });
    else await sb(where(id), { method: "DELETE", prefer: "return=minimal" });
    await logAct(me.usuario, "Usuarios", `${accion === "suspender" ? "Suspendió" : "Eliminó"} a ${id}`);
    return send(res, 200, { ok: true });
  }
  return send(res, 400, { error: "Acción no válida." });
});
