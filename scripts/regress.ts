/**
 * Regressão: gera o certificado de cada curva e compara com o certificado já
 * emitido no SEI (PDF "CERT <nome da curva>.pdf" na mesma pasta).
 *
 *   npm run regress                       # usa tests/fixtures
 *   npm run regress -- "C:\pasta\com\curvas e certificados"
 *
 * Opcional: a planilha de madeireiras em MADEIREIRAS_XLSX (padrão: tests/fixtures/PlanilhaGeral.xlsx, a Planilha Geral).
 * Comunicados: arquivos "COMUNICADO ..." da pasta cujo nome contenha o nome da empresa.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { montarCertificado, sugerirTipo, type TipoTratamento } from "../src/lib/certificado";
import { lerComunicado } from "../src/lib/comunicado";
import { curvaSemTexto, lerCurva } from "../src/lib/curvas";
import { identificarEmpresa, lerNomeArquivo } from "../src/lib/madeireiras";
import { camposDoModelo, textoModalidade } from "../src/lib/modelos";
import { lerPlanilhaMadeireiras } from "../src/lib/planilhaMadeireiras";
import { chaveNome } from "../src/lib/util";

async function texto(arquivo: string): Promise<string> {
  const p = new PDFParse({ data: fs.readFileSync(arquivo) });
  try {
    return (await p.getText()).text;
  } finally {
    await p.destroy();
  }
}

const norm = (s: string) => s.replace(/\s+/g, "").replace(/[–—]/g, "-").toLowerCase();

async function main() {
  const dir = process.argv[2] ?? "tests/fixtures";
  const xlsx = process.env.MADEIREIRAS_XLSX ?? "tests/fixtures/PlanilhaGeral.xlsx";
  const { empresas } = await lerPlanilhaMadeireiras(fs.readFileSync(xlsx));
  const arquivos = fs.readdirSync(dir);
  const certs = arquivos.filter((f) => /^CERT\s/i.test(f) && f.endsWith(".pdf"));

  let ok = 0;
  let total = 0;
  for (const cert of certs) {
    const nomeCurva = cert.replace(/^CERT\s+/i, "");
    if (!arquivos.includes(nomeCurva)) continue;
    const tCurva = await texto(path.join(dir, nomeCurva));
    const tCert = await texto(path.join(dir, cert));
    console.log(`\n=== ${nomeCurva}`);
    if (curvaSemTexto(tCurva)) {
      console.log("   (PDF sem texto — precisa de OCR)");
      continue;
    }
    const curva = lerCurva(tCurva);
    if (!curva) {
      console.log("   sistema de curva não reconhecido");
      continue;
    }
    const nomeEmp = lerNomeArquivo(nomeCurva).nome;
    const ident = identificarEmpresa(empresas, { cnpj: curva.cnpj, regMapa: curva.regMapa, nomeArquivo: nomeEmp });
    if (!ident) {
      console.log(`   empresa não identificada (${curva.sistema})`);
      continue;
    }
    const arqCom = arquivos.find(
      (f) => /^COMUNICADO/i.test(f) && nomeEmp && chaveNome(f).includes(chaveNome(nomeEmp))
    );
    const comunicado = arqCom ? lerComunicado(await texto(path.join(dir, arqCom))) : null;

    const entrada = { curva, empresa: ident.empresa, comunicado, nomeArquivo: nomeCurva };
    const sug = sugerirTipo(entrada);
    // O certificado emitido diz qual modelo foi usado no rodapé ("HT Estufa - Cadastrada").
    const usado: TipoTratamento = /Estufa/i.test(tCert)
      ? /estufa:\s*HT/i.test(tCert.replace(/\s+/g, " ")) ? "HT" : "KD"
      : "AQF";
    const r = montarCertificado(entrada, usado);
    console.log(
      `   ${curva.sistema} · ${ident.empresa.apelido} (por ${ident.por}) · ${r.modelo.nome} · sugerido ${sug.tipo} (${sug.motivo})${sug.tipo !== usado ? `  <-- emitido como ${usado}` : ""}`
    );

    const tc = norm(tCert);
    const conferir: [string, string][] = [["Número", r.valores.numero ?? ""]];
    for (const cel of camposDoModelo(r.modelo)) {
      const v = r.valores[cel.k] ?? "";
      conferir.push([cel.r, cel.fixo ? textoModalidade(cel, v) : v]);
    }
    for (const [rot, valor] of conferir) {
      if (!valor) continue;
      total++;
      if (tc.includes(norm(valor))) ok++;
      else console.log(`   ✗ ${rot} ${JSON.stringify(valor)}`);
    }
    for (const a of r.avisos) console.log(`   ! ${a}`);
  }
  console.log(`\n${ok}/${total} campos iguais ao certificado emitido.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
