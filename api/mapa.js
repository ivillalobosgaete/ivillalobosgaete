// Evaluaciones del mapa de poder e interés y organización asignada a cada pescador.
// Clave: RPA del pescador, u "org:<nombre>" para una organización.
// GET: cualquier usuario activo (la nota solo se envía a administradores). POST: solo administradores.
import { handler, send, readBody, current, sb, tableMissing, logAct } from "../lib/core.js";

const lvl = (v) => { const n = Math.round(Number(v)); return n >= 1 && n <= 5 ? n : null; };

export default handler(async (req, res) => {
  const me = await current(req);
  if (!me) return send(res, 401, { error: "Sin sesión" });
  const admin = me.rol === "administrador";

  if (req.method === "GET") {
    try {
      const r = await sb("evaluaciones?select=*");
      return send(res, 200, { evaluaciones: (r || []).map((e) => ({ rpa: e.rpa, poder: e.poder, interes: e.interes, organizacion: e.organizacion || "", nota: admin ? e.nota || "" : "", por: e.por, actualizado: e.actualizado })) });
    } catch (e) {
      if (tableMissing(e)) return send(res, 200, { evaluaciones: [], falta: true });
      throw e;
    }
  }
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido" });
  if (!admin) return send(res, 403, { error: "Solo un administrador puede evaluar." });

  const b = await readBody(req);
  const clave = String(b.rpa || "").trim().slice(0, 120);
  if (!clave) return send(res, 400, { error: "Falta el pescador u organización." });
  const where = `evaluaciones?rpa=eq.${encodeURIComponent(clave)}`;
  const poder = lvl(b.poder), interes = lvl(b.interes);
  const nota = String(b.nota || "").trim().slice(0, 400), organizacion = String(b.organizacion || "").trim().slice(0, 80);
  if (b.borrar || (!poder && !interes && !nota && !organizacion)) {
    await sb(where, { method: "DELETE", prefer: "return=minimal" });
  } else {
    await sb("evaluaciones?on_conflict=rpa", {
      method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { rpa: clave, poder, interes, nota, organizacion, por: me.usuario, actualizado: new Date().toISOString() }
    });
  }
  await logAct(me.usuario, "Mapa de poder e interés", `${clave}: poder ${poder || "auto"}, interés ${interes || "auto"}${organizacion ? ", organización " + organizacion : ""}`);
  send(res, 200, { ok: true });
});
