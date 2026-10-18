// Regenera rca/index.json con la lista de PDF de la carpeta rca/.
// Ejecutar después de agregar o renombrar PDF: npm run rca-index
import { readdirSync, writeFileSync } from "node:fs";
const files = readdirSync(new URL("../rca/", import.meta.url)).filter(f => /\.pdf$/i.test(f)).sort();
writeFileSync(new URL("../rca/index.json", import.meta.url), JSON.stringify(files, null, 0) + "\n");
console.log(`rca/index.json: ${files.length} PDF`);
