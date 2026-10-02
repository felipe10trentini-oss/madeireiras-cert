import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { lerDR } from "./src/lib/certificadoMestre";
import { valoresConsolidado, materialDaDR } from "./src/lib/documentos";
import { listarMadeireiras } from "./src/lib/madeireirasDb";
import { soDigitos } from "./src/lib/util";
(async () => {
  const emp = await listarMadeireiras();
  for (const f of fs.readdirSync(process.argv[2])) {
    const p = new PDFParse({ data: fs.readFileSync(path.join(process.argv[2], f)) }); const t = (await p.getText()).text; await p.destroy();
    const dr = lerDR(t); if (!dr) { console.log("NAO LIDA", f); continue; }
    const e = emp.find((x) => soDigitos(x.cnpj) === soDigitos(dr.cnpj ?? "")) ?? null;
    const v = valoresConsolidado(dr, e, materialDaDR(dr));
    console.log(`${f.slice(0, 45).padEnd(45)} | ${e?.apelido ?? "SEM EMPRESA"} | n=${v.numero} | linhas=${dr.linhas.length} | local=${JSON.stringify(v.local)}`);
  }
})();
