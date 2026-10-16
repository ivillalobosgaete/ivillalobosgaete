import { handler, send, clearCookie } from "../lib/core.js";
export default handler(async (req, res) => send(res, 200, { ok: true }, { "Set-Cookie": clearCookie() }));
