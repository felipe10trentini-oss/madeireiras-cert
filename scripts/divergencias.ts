/**
 * Testa a trava de divergência nos certificados já emitidos (que passaram pela equipe):
 * cada divergência aqui é um alarme a conferir (falso positivo ou erro de emissão).
 *
 *   npx tsx scripts/divergencias.ts <pasta com subpastas por empresa>
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { montarCertificado, sugerirTipo } from "../src/lib/certificado";
import { lerComunicado, type Comunicado } from "../src/lib/comunicado";
import { curvaSemTexto, lerCurva } from "../src/lib/curvas";
import { validarComunicado } from "../src/lib/divergencias";
import { identificarEmpresa, lerNomeArquivo } from "../src/lib/madeireiras";
import { lerPlanilhaMadeireiras } from "../src/lib/planilhaMadeireiras";

async function texto(arquivo: string): Promise<string> {
  const p = new PDFParse({ data: fs.readFileSync(arquivo) });
  try {
    return (await p.getText()).text;
  } finally {
    await p.destroy();
  }
}

async function main() {
  const raiz = process.argv[2];
  const { empresas } = await lerPlanilhaMadeireiras(fs.readFileSync("tests/fixtures/PlanilhaGeral.xlsx"));
  let total = 0;
  let comAlarme = 0;
  for (const pasta of fs.readdirSync(raiz)) {
    const dir = path.join(raiz, pasta);
    if (!fs.statSync(dir).isDirectory()) continue;
    const arquivos = fs.readdirSync(dir);
    const comunicados: Comunicado[] = [];
    for (const f of arquivos.filter((x) => /^COMUNICADO/i.test(x) && /\.pdf$/i.test(x))) {
      try {
        comunicados.push(lerComunicado(await texto(path.join(dir, f))));
      } catch {}
    }
    if (!comunicados.length) continue;
    for (const cert of arquivos.filter((f) => /^CERT\.?\s/i.test(f))) {
      const nomeCurva = cert.replace(/^CERT\.?\s+/i, "");
      if (!arquivos.includes(nomeCurva)) continue;
      const t = await texto(path.join(dir, nomeCurva));
      if (curvaSemTexto(t)) continue;
      const curva = lerCurva(t);
      if (!curva) continue;
      const ident = identificarEmpresa(empresas, { cnpj: curva.cnpj, regMapa: curva.regMapa, nomeArquivo: lerNomeArquivo(nomeCurva).nome });
      if (!ident) continue;
      const tCert = (await texto(path.join(dir, cert))).replace(/\s+/g, " ");
      const num = tCert.match(/Comunicado de [Tt]ratamento:\s*(\S+)/)?.[1];
      const comunicado = comunicados.find((c) => c.numero === num);
      if (!comunicado) continue;
      const entrada = { curva, empresa: ident.empresa, comunicado, nomeArquivo: nomeCurva };
      const tipo = sugerirTipo(entrada).tipo;
      const { valores } = montarCertificado(entrada, tipo);
      const divs = validarComunicado({ curva, comunicado, valores, tipo });
      total++;
      if (divs.some((x) => x.nivel === "erro")) comAlarme++;
      for (const x of divs) console.log(`${pasta} | ${nomeCurva} | ${x.nivel} ${x.campo}: comunicado=${x.comunicado} | curva=${x.curva.slice(0, 80)} | ${x.detalhe}`);
    }
  }
  console.log(`\n${total} certificados com comunicado; ${comAlarme} com divergência que trava.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
