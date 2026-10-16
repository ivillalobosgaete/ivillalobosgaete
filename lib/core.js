// Utilidades compartidas por las funciones de /api (no es una ruta pública).
import crypto from "node:crypto";
import zlib from "node:zlib";

const env = (k) => process.env[k];

export function missingConfig() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET"].filter((k) => !env(k));
}

// ---- Base de datos (Supabase, API REST con la clave de servicio; solo en el servidor) ----
export async function sb(path, { method = "GET", body, prefer } = {}) {
  const url = `${env("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`;
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(url, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Base de datos ${r.status}: ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---- Respuestas y cuerpo de la solicitud ----
export function send(res, code, obj, headers = {}) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const k in headers) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(obj));
}
export async function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 8e6) throw new Error("Archivo demasiado grande"); chunks.push(c); }
  const t = Buffer.concat(chunks).toString("utf8");
  try { return t ? JSON.parse(t) : {}; } catch { return {}; }
}
export function handler(fn) {
  return async (req, res) => {
    const miss = missingConfig();
    if (miss.length) return send(res, 500, { error: "Falta configurar en el servidor: " + miss.join(", ") });
    try { await fn(req, res); }
    catch (e) { console.error(e); send(res, 500, { error: "Error del servidor. Revisa los registros de la función." }); }
  };
}

// ---- Usuarios y contraseñas ----
export const uname = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9._-]/g, "");
const SCRYPT = { N: 16384, r: 8, p: 1 };
export function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${h.toString("base64")}`;
}
export function checkPw(pw, stored) {
  try {
    const [, s, h] = String(stored).split("$");
    const hb = Buffer.from(h, "base64");
    const c = crypto.scryptSync(String(pw), Buffer.from(s, "base64"), hb.length, SCRYPT);
    return crypto.timingSafeEqual(c, hb);
  } catch { return false; }
}
export async function getUser(usuario) {
  const r = await sb(`usuarios?usuario=eq.${encodeURIComponent(usuario)}&select=*`);
  return (r && r[0]) || null;
}
export function publicUser(u) {
  return { usuario: u.usuario, nombre: u.nombre || "", cargo: u.cargo || "", area: u.area || "", motivo: u.motivo || "", rol: u.rol, estado: u.estado, permisos: u.permisos || {}, comunas: u.comunas || [], creado: u.creado };
}
// Crea el administrador inicial (variables ADMIN_USER y ADMIN_PASSWORD) si aún no existe.
export async function ensureAdmin() {
  const U = uname(env("ADMIN_USER")), P = env("ADMIN_PASSWORD");
  if (!U || !P) return;
  if (await getUser(U)) return;
  await sb("usuarios", { method: "POST", prefer: "return=minimal", body: { usuario: U, nombre: "", hash: hashPw(P), rol: "administrador", estado: "activo", permisos: { exportar: true, nombres: true }, comunas: [], aprobado_por: "configuración inicial" } });
}

// ---- Sesión (cookie firmada, solo HTTP) ----
export const COOKIE = "sesion";
const HOURS = 8;
export function makeToken(usuario) {
  const p = Buffer.from(JSON.stringify({ u: usuario, exp: Date.now() + HOURS * 3600e3 })).toString("base64url");
  const s = crypto.createHmac("sha256", env("SESSION_SECRET")).update(p).digest("base64url");
  return `${p}.${s}`;
}
function readToken(t) {
  if (!t) return null;
  const [p, s] = t.split(".");
  if (!p || !s) return null;
  const e = crypto.createHmac("sha256", env("SESSION_SECRET")).update(p).digest("base64url");
  if (e.length !== s.length || !crypto.timingSafeEqual(Buffer.from(e), Buffer.from(s))) return null;
  try { const o = JSON.parse(Buffer.from(p, "base64url").toString()); return o.exp > Date.now() ? o.u : null; } catch { return null; }
}
function getCookie(req, name) {
  const c = req.headers.cookie || "";
  const m = c.split(/;\s*/).find((x) => x.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
const secure = () => (env("COOKIE_INSECURE") === "1" ? "" : " Secure;");
export const setCookie = (token) => `${COOKIE}=${token}; Path=/; HttpOnly;${secure()} SameSite=Lax; Max-Age=${HOURS * 3600}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly;${secure()} SameSite=Lax; Max-Age=0`;
// Usuario de la sesión, releído de la base en cada solicitud (una suspensión rige de inmediato).
export async function current(req) {
  const u = readToken(getCookie(req, COOKIE));
  if (!u) return null;
  const user = await getUser(u);
  return user && user.estado === "activo" ? user : null;
}

// ---- Datos: aplica las restricciones del usuario antes de enviarlos ----
export function scopeGz(gzB64, user) {
  const adm = user.rol === "administrador";
  const comunas = adm ? [] : user.comunas || [];
  const nombres = adm || (user.permisos || {}).nombres !== false;
  if (!comunas.length && nombres) return gzB64;
  const m = JSON.parse(zlib.gunzipSync(Buffer.from(gzB64, "base64")).toString("utf8"));
  if (comunas.length) {
    const allow = new Set(comunas);
    const keep = new Set(m.C.map((c, i) => (allow.has(c[1]) ? i : -1)).filter((i) => i >= 0));
    const c = m.cols, n = { d: [], p: [], c: [], e: [], k: [], q: [], x: [] };
    for (let i = 0; i < c.d.length; i++) if (keep.has(c.c[i])) for (const k in n) n[k].push(c[k][i]);
    m.cols = n;
  }
  if (!nombres) m.P = m.P.map((x) => [x[0], "Pescador RPA " + x[0], x[2], x[3]]);
  return zlib.gzipSync(Buffer.from(JSON.stringify(m))).toString("base64");
}
export { zlib };
