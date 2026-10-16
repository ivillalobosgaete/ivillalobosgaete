// Público: solo el período de los datos (para la pantalla de inicio). No entrega datos personales.
import { handler, send, sb } from "../lib/core.js";
export default handler(async (req, res) => {
  const r = await sb("datos?id=eq.1&select=desde,hasta,filas,actualizado");
  const d = r && r[0];
  send(res, 200, d ? { desde: d.desde, hasta: d.hasta, filas: d.filas } : {});
});
