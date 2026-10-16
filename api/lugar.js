// Lugar aproximado de la conexión según la IP (cabeceras que agrega Vercel). No guarda nada.
import { handler, send } from "../lib/core.js";
const dec = (v) => { try { return decodeURIComponent(String(v || "")); } catch { return String(v || ""); } };
export default handler(async (req, res) => {
  const h = req.headers || {};
  send(res, 200, { ciudad: dec(h["x-vercel-ip-city"]), region: dec(h["x-vercel-ip-country-region"]), pais: dec(h["x-vercel-ip-country"]) });
});
