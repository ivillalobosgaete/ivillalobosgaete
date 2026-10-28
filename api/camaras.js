// Cámaras de las caletas (grabadores Dahua) vistas a través de un equipo local con go2rtc y un túnel seguro.
// Las cámaras están en redes internas (10.x): la plataforma nunca se conecta a ellas directamente, sino al
// equipo local publicado por el túnel. Las claves de las cámaras quedan solo en ese equipo; aquí solo se guarda
// la conexión con el equipo local (variables de Vercel o ajuste guardado por un administrador; nunca en el código).
//   GET              → lista de cámaras que el usuario puede ver (según permiso «camaras» y caletas/zonas/comunas).
//   GET ?foto=<id>   → imagen actual de la cámara (JPEG).
//   GET ?vivo=<id>   → video en vivo (MJPEG) por tramos de ~55 s; la página vuelve a conectar sola.
//   PUT              → (administrador) guarda la lista de cámaras.
import { handler, send, readBody, current, sb, tableMissing, logAct } from "../lib/core.js";

const env = (k) => process.env[k] || "";
const ZONAS = ["norte", "pelambres", "aim"];
const txt = (s, n = 120) => String(s == null ? "" : s).trim().slice(0, n);

function limpiar(L) {
  const vistos = new Set();
  return (Array.isArray(L) ? L : []).slice(0, 60).map((c) => ({
    id: txt(c.id, 40).toLowerCase().replace(/[^a-z0-9_-]/g, ""),
    nombre: txt(c.nombre, 80), caleta: txt(c.caleta, 80), comuna: txt(c.comuna, 60),
    zona: ZONAS.includes(c.zona) ? c.zona : "norte",
    src: txt(c.src, 40).replace(/[^A-Za-z0-9_-]/g, ""), nota: txt(c.nota, 200),
  })).filter((c) => c.id && c.src && c.nombre && !vistos.has(c.id) && vistos.add(c.id));
}
async function lista() {
  try { const r = await sb("ajustes?id=eq.2&select=data"); return limpiar(((r && r[0] && r[0].data) || {}).camaras); }
  catch (e) { if (tableMissing(e)) return []; throw e; }
}
// Misma regla que los datos: comunas, caletas y zonas permitidas; con solo comunas no se ve la zona AIM.
export function camOK(me, c) {
  if (me.rol === "administrador") return true;
  const p = me.permisos || {};
  if (!p.camaras) return false;
  const com = new Set(me.comunas || []), cal = new Set(p.caletas || []), z = new Set(p.zonas || []);
  const soloCom = com.size && !cal.size && !z.size;
  return (!com.size || com.has(c.comuna)) && (!cal.size || cal.has(c.caleta)) && (!z.size || z.has(c.zona)) && !(soloCom && c.zona === "aim");
}
// Conexión con el equipo local: variables de entorno de Vercel o, si no existen, la guardada por un administrador
// desde la plataforma (tabla ajustes, fila 3). Las claves nunca se envían al navegador.
async function conexion() {
  if (env("CAM_RELAY_URL")) return { url: env("CAM_RELAY_URL"), user: env("CAM_RELAY_USER"), pass: env("CAM_RELAY_PASS"), cfId: env("CAM_CF_ID"), cfSecret: env("CAM_CF_SECRET"), env: true };
  try { const r = await sb("ajustes?id=eq.3&select=data"); const d = (r && r[0] && r[0].data) || {}; return { url: d.url || "", user: d.user || "", pass: d.pass || "", cfId: d.cfId || "", cfSecret: d.cfSecret || "", env: false }; }
  catch (e) { if (tableMissing(e)) return { url: "" }; throw e; }
}
function relayHeaders(k) {
  const h = {};
  if (k.user) h.Authorization = "Basic " + Buffer.from(k.user + ":" + k.pass).toString("base64");
  // Opcional: token de servicio de Cloudflare Access (solo la plataforma puede llegar al equipo local).
  if (k.cfId) { h["CF-Access-Client-Id"] = k.cfId; h["CF-Access-Client-Secret"] = k.cfSecret; }
  return h;
}
const relay = (k, path) => k.url.replace(/\/$/, "") + path;
const urlOK = (u) => /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(u) || (process.env.COOKIE_INSECURE === "1" && /^http:\/\/127\.0\.0\.1:\d+\/[\w/-]*$/.test(u));

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const q = new URL(req.url, "http://x").searchParams;
  const adm = me.rol === "administrador";

  if (req.method === "PUT") {
    if (!adm) return send(res, 403, { error: "Solo un administrador puede configurar las cámaras." });
    const b = await readBody(req);
    if (b.conexion) {
      const k = await conexion();
      if (k.env) return send(res, 400, { error: "La conexión está definida en las variables de Vercel; cámbiala allí." });
      const c = b.conexion, url = txt(c.url, 200).replace(/\/$/, "");
      if (c.borrar) { await sb("ajustes?id=eq.3", { method: "DELETE", prefer: "return=minimal" }).catch(() => {}); await logAct(me.usuario, "Cámaras", "Quitó la conexión con el equipo local"); return send(res, 200, { ok: true }); }
      if (!urlOK(url)) return send(res, 400, { error: "La dirección debe comenzar con https:// (por ejemplo https://camaras.su-dominio.cl)." });
      const d = { url, user: txt(c.user, 80), pass: c.pass ? String(c.pass).slice(0, 200) : k.pass || "", cfId: txt(c.cfId, 200), cfSecret: c.cfSecret ? String(c.cfSecret).slice(0, 300) : (txt(c.cfId, 200) ? k.cfSecret || "" : "") };
      try { await sb("ajustes?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 3, data: d, por: me.usuario, actualizado: new Date().toISOString() } }); }
      catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de ajustes: ejecuta supabase/schema.sql en Supabase." }); throw e; }
      await logAct(me.usuario, "Cámaras", "Actualizó la conexión con el equipo local");
      return send(res, 200, { ok: true });
    }
    const camaras = limpiar(b.camaras);
    try { await sb("ajustes?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 2, data: { camaras }, por: me.usuario, actualizado: new Date().toISOString() } }); }
    catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de ajustes: ejecuta supabase/schema.sql en Supabase." }); throw e; }
    await logAct(me.usuario, "Cámaras", `${camaras.length} cámaras configuradas`);
    return send(res, 200, { ok: true });
  }
  if (req.method !== "GET") return send(res, 405, { error: "Método no permitido" });

  const L = await lista(), K = await conexion();
  // Prueba de conexión (administrador): lista las transmisiones que publica el equipo local.
  if (q.get("probar")) {
    if (!adm) return send(res, 403, { error: "Solo administradores." });
    if (!K.url) return send(res, 200, { ok: false, error: "Aún no hay conexión configurada." });
    try {
      const r = await fetch(relay(K, "/api/streams"), { headers: relayHeaders(K), signal: AbortSignal.timeout(10000) });
      if (r.status === 401 || r.status === 403) return send(res, 200, { ok: false, error: "El equipo local rechazó el usuario o la clave (o falta el token de Cloudflare Access)." });
      if (!r.ok) return send(res, 200, { ok: false, error: `El equipo local respondió con error ${r.status}.` });
      const j = await r.json().catch(() => ({}));
      return send(res, 200, { ok: true, streams: Object.keys(j || {}).slice(0, 60) });
    } catch { return send(res, 200, { ok: false, error: "No se pudo llegar al equipo local: revisa que esté encendido y que el túnel esté activo." }); }
  }
  const id = q.get("foto") || q.get("vivo");
  if (!id) {
    const vis = L.filter((c) => camOK(me, c)).map((c) => (adm ? c : { id: c.id, nombre: c.nombre, caleta: c.caleta, comuna: c.comuna, zona: c.zona, nota: c.nota }));
    const out = { camaras: vis, activo: !!K.url, admin: adm };
    if (adm) out.conexion = { url: K.url, user: K.user || "", tienePass: !!K.pass, cfId: K.cfId || "", tieneCF: !!K.cfSecret, env: !!K.env };
    return send(res, 200, out);
  }
  const c = L.find((x) => x.id === id);
  if (!c || !camOK(me, c)) return send(res, 404, { error: "Cámara no disponible" });
  if (!K.url) return send(res, 503, { error: "Falta conectar el equipo local de cámaras." });

  if (q.get("foto")) {
    let r;
    try { r = await fetch(relay(K, "/api/frame.jpeg?src=" + encodeURIComponent(c.src)), { headers: relayHeaders(K), signal: AbortSignal.timeout(12000) }); }
    catch { return send(res, 504, { error: "El equipo local de cámaras no responde." }); }
    if (!r.ok) return send(res, 502, { error: "Sin imagen: la cámara no responde (revisa que esté encendida y conectada a la red)." });
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "no-store, private");
    return res.end(buf);
  }

  // Video en vivo (MJPEG): se transmite por tramos para no superar el tiempo máximo de la función.
  const ctl = new AbortController();
  const fin = setTimeout(() => ctl.abort(), 55000);
  req.on("close", () => ctl.abort());
  let r;
  try { r = await fetch(relay(K, "/api/stream.mjpeg?src=" + encodeURIComponent(c.src)), { headers: relayHeaders(K), signal: ctl.signal }); }
  catch { clearTimeout(fin); return send(res, 504, { error: "El equipo local de cámaras no responde." }); }
  if (!r.ok || !r.body) { clearTimeout(fin); return send(res, 502, { error: "Sin video: la cámara no responde." }); }
  if (q.get("ini")) await logAct(me.usuario, "Cámara en vivo", c.nombre);
  res.statusCode = 200;
  res.setHeader("Content-Type", r.headers.get("content-type") || "multipart/x-mixed-replace");
  res.setHeader("Cache-Control", "no-store, private");
  try { for await (const ch of r.body) { if (!res.write(ch)) await new Promise((ok) => res.once("drain", ok)); } } catch {}
  clearTimeout(fin);
  res.end();
});
