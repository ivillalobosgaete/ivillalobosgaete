// Exigencias ambientales: base de RCA (fichas por numeral) y su categorización.
// GET: cualquier usuario activo. Los visualizadores reciben solo las RCA visibles y solo
//      las categorías habilitadas (sin notas internas). PUT y POST: solo administradores.
import { handler, send, readBody, current, sb, tableMissing, logAct, zlib } from "../lib/core.js";

const CATS_MAX = 4;      // 0..3 categorías de la base, 4 = Otro
const DESCARTADO = -2;

function filtrarBase(gzB64, ocultas) {
  if (!ocultas.size) return gzB64;
  const o = JSON.parse(zlib.gunzipSync(Buffer.from(gzB64, "base64")).toString("utf8"));
  const map = new Map(); const rcas = [];
  o.rcas.forEach((r, i) => { if (!ocultas.has(r.id)) { map.set(i, rcas.length); rcas.push(r); } });
  const f = o.f.filter((x) => map.has(x[0])).map((x) => [map.get(x[0]), ...x.slice(1)]);
  const vivas = new Set(f.map((x) => x[1]));
  const g = Array.isArray(o.g) ? o.g.map((x) => (x && vivas.has(x[0]) ? x : null)) : o.g;
  return zlib.gzipSync(Buffer.from(JSON.stringify({ ...o, rcas, f, g }))).toString("base64");
}

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const admin = me.rol === "administrador";

  if (req.method === "GET") {
    let base, estado, vis, seg = [], hist = [];
    try {
      [base, estado, vis] = await Promise.all([
        sb("rca_base?id=eq.1&select=gz,archivo,rcas,fichas,generado,por,actualizado"),
        sb("rca_estado?select=id,categoria,habilitado,nota"),
        sb("rca_visibilidad?select=rca,visible"),
      ]);
    } catch (e) { if (tableMissing(e)) return send(res, 200, { falta: true }); throw e; }
    try {
      [seg, hist] = await Promise.all([
        sb("rca_seguimiento?select=gid,fichas,items,por,actualizado"),
        admin ? sb("rca_seguimiento_hist?select=gid,item,verificador,pct,obs,usuario,fecha") : Promise.resolve([]),
      ]);
    } catch (e) { if (!tableMissing(e)) throw e; seg = []; hist = []; }
    const b = base && base[0];
    const ocultas = new Set((vis || []).filter((v) => v.visible === false).map((v) => v.rca));
    if (!b) return send(res, 200, { gz: null, estado: [], ocultas: [] });
    const meta = { archivo: b.archivo, rcas: b.rcas, fichas: b.fichas, generado: b.generado, actualizado: b.actualizado };
    if (admin) return send(res, 200, {
      gz: b.gz, meta, estado: (estado || []).map((e) => ({ id: e.id, c: e.categoria, h: e.habilitado, n: e.nota || "" })), ocultas: [...ocultas],
      seg: seg || [],
      hist: (hist || []).map((h) => ({ g: h.gid, i: h.item, t: h.verificador, p: h.pct, o: h.obs || "", u: h.usuario, f: h.fecha })),
    });
    const rcaDe = (id) => String(id).replace(/-\d+$/, "");
    const pub = (estado || []).filter((e) => e.habilitado && e.categoria !== null && e.categoria !== DESCARTADO && !ocultas.has(rcaDe(e.id))).map((e) => ({ id: e.id, c: e.categoria, h: true }));
    const hab = new Set(pub.map((e) => e.id));
    // Usuarios: solo el avance de compromisos con alguna ficha habilitada, sin observaciones internas.
    const segPub = (seg || []).filter((x) => (Array.isArray(x.fichas) ? x.fichas : []).some((id) => hab.has(id)))
      .map((x) => ({ gid: x.gid, items: (Array.isArray(x.items) ? x.items : []).map((i) => ({ t: i.t, p: i.p, f: i.f || "" })), actualizado: x.actualizado }));
    return send(res, 200, { gz: filtrarBase(b.gz, ocultas), meta, estado: pub, ocultas: [], seg: segPub });
  }

  if (!admin) return send(res, 403, { error: "Solo un administrador puede modificar las exigencias ambientales." });
  const b = await readBody(req);

  if (req.method === "PUT") {
    let o;
    try { o = JSON.parse(zlib.gunzipSync(Buffer.from(String(b.gz || ""), "base64")).toString("utf8")); } catch { return send(res, 400, { error: "El archivo enviado no es válido." }); }
    if (!o || !Array.isArray(o.rcas) || !Array.isArray(o.f)) return send(res, 400, { error: "El archivo no tiene el formato de la base de RCA." });
    try {
      await sb("rca_base?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { id: 1, gz: b.gz, archivo: String(b.archivo || "").slice(0, 200), rcas: o.rcas.length, fichas: o.f.length, generado: String(o.generado || ""), por: me.usuario, actualizado: new Date().toISOString() } });
    } catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear las tablas de RCA: vuelve a ejecutar supabase/schema.sql en Supabase." }); throw e; }
    await logAct(me.usuario, "Exigencias ambientales", `Cargó la base de RCA (${o.rcas.length} RCA, ${o.f.length} fichas)`);
    return send(res, 200, { ok: true });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  try {
    if (b.accion === "visibilidad") {
      const rca = String(b.rca || "").slice(0, 60);
      if (!rca) return send(res, 400, { error: "Falta la RCA." });
      await sb("rca_visibilidad?on_conflict=rca", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { rca, visible: !!b.visible, por: me.usuario, actualizado: new Date().toISOString() } });
      await logAct(me.usuario, "Exigencias ambientales", `RCA ${rca} ${b.visible ? "visible" : "oculta"} para usuarios`);
      return send(res, 200, { ok: true });
    }
    if (b.accion === "seg") {
      const gid = String(b.gid || "").slice(0, 60);
      if (!gid) return send(res, 400, { error: "Falta el compromiso." });
      const ahora = new Date().toISOString();
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 40).map((i) => ({
        t: String(i.t || "").trim().slice(0, 400), p: Math.max(0, Math.min(100, Math.round(Number(i.p) || 0))),
        o: String(i.o || "").trim().slice(0, 300), f: String(i.f || "").slice(0, 40), u: String(i.u || "").slice(0, 60),
      })).filter((i) => i.t);
      if (!items.length) return send(res, 400, { error: "Debe quedar al menos un verificador." });
      const fichas = (Array.isArray(b.fichas) ? b.fichas : []).slice(0, 200).map((x) => String(x).slice(0, 60));
      const cambios = (Array.isArray(b.cambios) ? b.cambios : []).slice(0, 60).map((c) => ({
        gid, item: Number.isInteger(c.i) ? c.i : -1, verificador: String(c.t || "").slice(0, 400),
        pct: Math.max(0, Math.min(100, Math.round(Number(c.p) || 0))), obs: String(c.o || "").slice(0, 300), usuario: me.usuario, fecha: ahora,
      }));
      items.forEach((i) => { if (i.f) i.u = i.u || me.usuario; });
      await sb("rca_seguimiento?on_conflict=gid", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: { gid, fichas, items, por: me.usuario, actualizado: ahora } });
      if (cambios.length) await sb("rca_seguimiento_hist", { method: "POST", prefer: "return=minimal", body: cambios });
      const av = Math.round(items.reduce((a, i) => a + i.p, 0) / items.length);
      await logAct(me.usuario, "Exigencias ambientales", `Avance ${av}% en el compromiso ${gid}`);
      return send(res, 200, { ok: true });
    }
    if (b.accion === "estado") {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 5000);
      const up = [], del = [];
      for (const it of items) {
        const id = String(it.id || "").slice(0, 60); if (!id) continue;
        const c = it.c === null || it.c === undefined || it.c === "" ? null : Number(it.c);
        const valid = c === null || c === DESCARTADO || (Number.isInteger(c) && c >= 0 && c <= CATS_MAX);
        if (!valid) continue;
        const nota = String(it.n || "").slice(0, 300);
        if (c === null && !nota) { del.push(id); continue; }
        up.push({ id, categoria: c, habilitado: c !== null && c !== DESCARTADO && !!it.h, nota, por: me.usuario, actualizado: new Date().toISOString() });
      }
      if (up.length) await sb("rca_estado?on_conflict=id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: up });
      for (let i = 0; i < del.length; i += 100) await sb(`rca_estado?id=in.(${del.slice(i, i + 100).map((x) => `"${x.replace(/"/g, "")}"`).join(",")})`, { method: "DELETE", prefer: "return=minimal" });
      await logAct(me.usuario, "Exigencias ambientales", `Actualizó ${up.length + del.length} ficha(s)`);
      return send(res, 200, { ok: true });
    }
  } catch (e) { if (tableMissing(e)) return send(res, 400, { error: "Falta crear las tablas de RCA: vuelve a ejecutar supabase/schema.sql en Supabase." }); throw e; }
  return send(res, 400, { error: "Acción no válida." });
});
