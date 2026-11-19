// Respaldos de la base de desembarque (solo administradores).
// Antes de cada carga o restauración se guarda la versión vigente, para poder descargarla o volver a ella.
// Se guardan en la tabla «vistas» con claves reservadas que empiezan con «#» (ningún usuario puede tener ese carácter):
//   «#datos-respaldos»        → índice con los datos de cada respaldo (sin la base)
//   «#datos-respaldo-<fecha>» → la base completa comprimida de ese respaldo
//   GET                         → índice de respaldos y datos de la versión vigente
//   GET ?id=actual | ?id=<id>   → base completa comprimida (vigente o de un respaldo)
//   POST {accion:"restaurar", id} → vuelve a la versión del respaldo (respalda antes la vigente)
//   POST {accion:"eliminar", id}  → borra un respaldo
import { handler, send, readBody, current, sb, logAct } from "../lib/core.js";

const IDX = "#datos-respaldos", PRE = "#datos-respaldo-", MAX = 6;
async function kv(k) { const r = await sb(`vistas?usuario=eq.${encodeURIComponent(k)}&select=data`); return r && r[0] ? r[0].data : null; }
async function kvSet(k, data) { await sb("vistas?on_conflict=usuario", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { usuario: k, data, actualizado: new Date().toISOString() } }); }
async function kvDel(k) { await sb(`vistas?usuario=eq.${encodeURIComponent(k)}`, { method: "DELETE", prefer: "return=minimal" }); }
const lista = async () => { const x = await kv(IDX); return Array.isArray(x && x.items) ? x.items : []; };
async function vigente() { const r = await sb("datos?id=eq.1&select=*"); return (r && r[0]) || null; }

// Guarda la versión vigente como respaldo (se llama antes de reemplazarla). Mantiene los últimos MAX respaldos.
export async function respaldarVigente(por, motivo) {
  const d = await vigente();
  if (!d || !d.gz) return null;
  const id = String(Date.now());
  await kvSet(PRE + id, { gz: d.gz });
  const items = await lista();
  items.unshift({ id, archivo: d.archivo || "", filas: d.filas || 0, desde: d.desde || "", hasta: d.hasta || "", cargadoPor: d.por || "", cargado: d.actualizado || null, respaldado: new Date().toISOString(), respaldadoPor: por, motivo: String(motivo || "").slice(0, 120) });
  const quedan = items.slice(0, MAX), sobran = items.slice(MAX);
  await kvSet(IDX, { items: quedan });
  for (const x of sobran) { try { await kvDel(PRE + x.id); } catch {} }
  return id;
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  if (me.rol !== "administrador") return send(res, 403, { error: "Solo un administrador puede descargar o restaurar respaldos de la base." });
  const url = new URL(req.url, "http://x");
  if (req.method === "GET") {
    const id = url.searchParams.get("id");
    if (id === "actual") {
      const d = await vigente();
      if (!d) return send(res, 404, { error: "Aún no hay datos cargados." });
      await logAct(me.usuario, "Respaldo de datos", "Descargó la base vigente");
      return send(res, 200, { gz: d.gz, meta: { archivo: d.archivo, filas: d.filas, desde: d.desde, hasta: d.hasta, por: d.por, actualizado: d.actualizado } });
    }
    if (id) {
      const it = (await lista()).find((x) => x.id === id);
      const b = it && await kv(PRE + id);
      if (!it || !b || !b.gz) return send(res, 404, { error: "El respaldo ya no existe." });
      await logAct(me.usuario, "Respaldo de datos", `Descargó el respaldo del ${it.respaldado}`);
      return send(res, 200, { gz: b.gz, meta: it });
    }
    const d = await vigente();
    return send(res, 200, { items: await lista(), max: MAX, vigente: d ? { archivo: d.archivo, filas: d.filas, desde: d.desde, hasta: d.hasta, por: d.por, actualizado: d.actualizado } : null });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  const b = await readBody(req);
  const id = String(b.id || "");
  const it = (await lista()).find((x) => x.id === id);
  if (!it) return send(res, 404, { error: "El respaldo ya no existe." });
  if (b.accion === "eliminar") {
    await kvDel(PRE + id);
    await kvSet(IDX, { items: (await lista()).filter((x) => x.id !== id) });
    await logAct(me.usuario, "Respaldo de datos", `Eliminó el respaldo del ${it.respaldado}`);
    return send(res, 200, { ok: true, items: await lista() });
  }
  if (b.accion !== "restaurar") return send(res, 400, { error: "Acción no reconocida." });
  const x = await kv(PRE + id);
  if (!x || !x.gz) return send(res, 404, { error: "El respaldo ya no existe." });
  await respaldarVigente(me.usuario, "Antes de restaurar un respaldo");
  await sb("datos?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 1, gz: x.gz, archivo: it.archivo, filas: it.filas, desde: it.desde, hasta: it.hasta, por: me.usuario, actualizado: new Date().toISOString() } });
  await sb("cargas", { method: "POST", prefer: "return=minimal", body: { por: me.usuario, archivo: it.archivo, modo: "restauración", nuevas: 0, filas: it.filas } });
  await logAct(me.usuario, "Respaldo de datos", `Restauró la base del ${it.cargado || it.respaldado} (${it.archivo || "sin nombre"}, ${it.filas} filas)`);
  send(res, 200, { ok: true, items: await lista() });
});
