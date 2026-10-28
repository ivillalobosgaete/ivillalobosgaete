// Cámaras de las caletas (grabadores Dahua) vistas a través de un equipo local con go2rtc y un túnel seguro.
// Las cámaras están en redes internas (10.x): la plataforma nunca se conecta a ellas directamente, sino al
// equipo local publicado por el túnel (variable CAM_RELAY_URL). Las claves de las cámaras quedan solo en ese
// equipo; aquí solo se guardan las credenciales del equipo local (variables de entorno, nunca en el código).
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
function relayHeaders() {
  const h = {};
  if (env("CAM_RELAY_USER")) h.Authorization = "Basic " + Buffer.from(env("CAM_RELAY_USER") + ":" + env("CAM_RELAY_PASS")).toString("base64");
  // Opcional: token de servicio de Cloudflare Access (solo la plataforma puede llegar al equipo local).
  if (env("CAM_CF_ID")) { h["CF-Access-Client-Id"] = env("CAM_CF_ID"); h["CF-Access-Client-Secret"] = env("CAM_CF_SECRET"); }
  return h;
}
const relay = (path) => env("CAM_RELAY_URL").replace(/\/$/, "") + path;

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const q = new URL(req.url, "http://x").searchParams;
  const adm = me.rol === "administrador";

  if (req.method === "PUT") {
    if (!adm) return send(res, 403, { error: "Solo un administrador puede configurar las cámaras." });
    const b = await readBody(req);
    const camaras = limpiar(b.camaras);
    try { await sb("ajustes?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 2, data: { camaras }, por: me.usuario, actualizado: new Date().toISOString() } }); }
    catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de ajustes: ejecuta supabase/schema.sql en Supabase." }); throw e; }
    await logAct(me.usuario, "Cámaras", `${camaras.length} cámaras configuradas`);
    return send(res, 200, { ok: true });
  }
  if (req.method !== "GET") return send(res, 405, { error: "Método no permitido" });

  const L = await lista();
  const id = q.get("foto") || q.get("vivo");
  if (!id) {
    const vis = L.filter((c) => camOK(me, c)).map((c) => (adm ? c : { id: c.id, nombre: c.nombre, caleta: c.caleta, comuna: c.comuna, zona: c.zona, nota: c.nota }));
    return send(res, 200, { camaras: vis, activo: !!env("CAM_RELAY_URL"), admin: adm });
  }
  const c = L.find((x) => x.id === id);
  if (!c || !camOK(me, c)) return send(res, 404, { error: "Cámara no disponible" });
  if (!env("CAM_RELAY_URL")) return send(res, 503, { error: "Falta configurar el equipo local de cámaras (CAM_RELAY_URL)." });

  if (q.get("foto")) {
    let r;
    try { r = await fetch(relay("/api/frame.jpeg?src=" + encodeURIComponent(c.src)), { headers: relayHeaders(), signal: AbortSignal.timeout(12000) }); }
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
  try { r = await fetch(relay("/api/stream.mjpeg?src=" + encodeURIComponent(c.src)), { headers: relayHeaders(), signal: ctl.signal }); }
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
