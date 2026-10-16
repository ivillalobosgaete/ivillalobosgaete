// Genera el hash de una contraseña para restablecerla a mano en Supabase.
// Uso: npm run hash -- "NuevaContraseña"
// Luego, en Supabase > Table editor > usuarios, pega el resultado en la columna "hash" del usuario.
import { hashPw } from "../lib/core.js";
const pw = process.argv[2];
if (!pw || pw.length < 8) { console.error('Uso: npm run hash -- "NuevaContraseña" (mínimo 8 caracteres)'); process.exit(1); }
console.log(hashPw(pw));
