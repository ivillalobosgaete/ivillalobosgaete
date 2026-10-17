// Clave pública de Google Maps (Maps JavaScript API). Se configura en Vercel como GOOGLE_MAPS_KEY.
// Es una clave de navegador: protégela restringiéndola en Google Cloud a tu dominio y a "Maps JavaScript API".
import { handler, send } from "../lib/core.js";
export default handler(async (req, res) => {
  send(res, 200, { key: String(process.env.GOOGLE_MAPS_KEY || "").trim() });
});
