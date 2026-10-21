// Minutas de reuniones con organizaciones de pescadores.
// Fichas en la tabla «minutas»; el archivo original en el depósito privado «minutas» de Supabase Storage
// (nunca público: se entrega con enlaces firmados de corta duración y solo con sesión iniciada).
// GET  /api/minutas                         → lista de fichas (cualquier usuario con sesión)
// GET  /api/minutas?archivo=<id>[&dl=1]     → redirige a un enlace firmado (2 min) del archivo original
// POST /api/minutas {accion:"subida", nombre, tipo}        → (admin) enlace firmado para subir el archivo
// POST /api/minutas {accion:"ia", texto, imagenes:[b64]}   → (admin) lectura con IA (requiere ANTHROPIC_API_KEY)
// POST /api/minutas {accion:"guardar", ficha}              → (admin) crea o actualiza la ficha
// POST /api/minutas {accion:"borrar", id}                  → (admin) elimina la ficha y su archivo
import { handler, send, current, sb, readBody, tableMissing, logAct } from "../lib/core.js";

const BUCKET = "minutas";
const SBU = () => process.env.SUPABASE_URL.replace(/\/$/, "");
const KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const hdr = () => ({ apikey: KEY(), Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" });
const limpio = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "minuta";
const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function storage(path, body) {
  const r = await fetch(`${SBU()}/storage/v1/${path}`, { method: "POST", headers: hdr(), body: JSON.stringify(body || {}) });
  const t = await r.text();
  if (!r.ok) throw new Error(`Almacenamiento ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : {};
}

async function leerIA(texto, imagenes, instrucciones) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { sinIA: true };
  const content = [];
  for (const b64 of (imagenes || []).slice(0, 6)) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: String(b64) } });
  content.push({ type: "text", text: String(instrucciones || "").slice(0, 20000) + (texto ? "\n\nTEXTO DE LA MINUTA:\n" + String(texto).slice(0, 120000) : "") });
  const r = await fetch((process.env.ANTHROPIC_BASE || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(55000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", max_tokens: 6000, messages: [{ role: "user", content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("IA " + r.status + ": " + ((j.error && j.error.message) || "sin respuesta"));
  return { texto: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("") };
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const adm = me.rol === "administrador";
  const u = new URL(req.url, "http://x");

  if (req.method === "GET") {
    const aid = u.searchParams.get("archivo");
    if (aid) {
      const rows = await sb(`minutas?id=eq.${encodeURIComponent(aid)}&select=archivo,archivo_nombre`);
      const m = rows && rows[0];
      if (!m || !m.archivo) return send(res, 404, { error: "La minuta no tiene archivo." });
      const dl = u.searchParams.get("dl") === "1";
      const s = await storage(`object/sign/${BUCKET}/${m.archivo}`, { expiresIn: 120 });
      const url = SBU() + "/storage/v1" + s.signedURL + (dl ? "&download=" + encodeURIComponent(m.archivo_nombre || "minuta") : "");
      res.statusCode = 302; res.setHeader("Location", url); res.setHeader("Cache-Control", "no-store"); return res.end();
    }
    try {
      const rows = await sb("minutas?select=id,datos,texto,archivo,archivo_nombre,archivo_tipo,por,creado,actualizado&order=creado.desc&limit=2000");
      return send(res, 200, { minutas: rows || [], ia: !!process.env.ANTHROPIC_API_KEY });
    } catch (e) { if (tableMissing(e)) return send(res, 200, { minutas: [], falta: true, ia: !!process.env.ANTHROPIC_API_KEY }); throw e; }
  }

  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  if (!adm) return send(res, 403, { error: "Solo administradores" });
  const b = await readBody(req);

  if (b.accion === "subida") {
    const path = `${new Date().getFullYear()}/${nuevoId()}_${limpio(b.nombre)}`;
    const s = await storage(`object/upload/sign/${BUCKET}/${path}`, {});
    return send(res, 200, { path, url: SBU() + "/storage/v1" + s.url });
  }
  if (b.accion === "ia") {
    try { return send(res, 200, await leerIA(b.texto, b.imagenes, b.instrucciones)); }
    catch (e) { return send(res, 502, { error: String(e.message || e) }); }
  }
  if (b.accion === "guardar") {
    const f = b.ficha || {};
    const id = f.id || nuevoId();
    const row = { id, datos: f.datos || {}, texto: String(f.texto || "").slice(0, 400000), archivo: f.archivo || null, archivo_nombre: f.archivo_nombre || null, archivo_tipo: f.archivo_tipo || null, por: me.usuario, actualizado: new Date().toISOString() };
    try { await sb("minutas?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: row }); }
    catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear la tabla de minutas en Supabase: ejecuta supabase/schema.sql." }); throw e; }
    await logAct(me.usuario, f.id ? "minuta editada" : "minuta agregada", `${(f.datos || {}).organizacion || ""} ${(f.datos || {}).fecha || ""}`);
    return send(res, 200, { ok: true, id });
  }
  if (b.accion === "borrar") {
    const rows = await sb(`minutas?id=eq.${encodeURIComponent(b.id)}&select=archivo`);
    const a = rows && rows[0] && rows[0].archivo;
    if (a) { try { await fetch(`${SBU()}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: hdr(), body: JSON.stringify({ prefixes: [a] }) }); } catch { /* el archivo puede no existir */ } }
    await sb(`minutas?id=eq.${encodeURIComponent(b.id)}`, { method: "DELETE", prefer: "return=minimal" });
    await logAct(me.usuario, "minuta eliminada", b.id);
    return send(res, 200, { ok: true });
  }
  return send(res, 400, { error: "Acción desconocida" });
});
