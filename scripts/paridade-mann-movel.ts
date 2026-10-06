/**
 * Paridade MANN Móvel: passa os serviços já emitidos (curva + comunicado + certificado + linha do
 * relatório do MAPA) pelas funções deste projeto e mostra o que sairia diferente do que foi emitido.
 *
 *   npx tsx scripts/paridade-mann-movel.ts "<pasta com os arquivos>" "<linhas.json do relatório>"
 *
 * Pasta: "<N> MANN <lote>.pdf", "CERT <N> MANN <lote>.pdf" e "COMUNICADO <N> - ....pdf".
 * linhas.json: { "1490/2026": [26 colunas da aba TÉRMICO] }.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { montarCertificado } from "../src/lib/certificado";
import { lerComunicado } from "../src/lib/comunicado";
import { curvaSemTexto, lerCurva } from "../src/lib/curvas";
import { validarComunicado } from "../src/lib/divergencias";
import { identificarEmpresa, lerNomeArquivo } from "../src/lib/madeireiras";
import { camposDoModelo, textoModalidade } from "../src/lib/modelos";
import { lerPlanilhaMadeireiras } from "../src/lib/planilhaMadeireiras";
import { COLUNAS_CREDENCIADA, montarLinhaRelatorio } from "../src/lib/relatorio";

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
  const dir = process.argv[2];
  const jsonLinhas = process.argv[3];
  if (!dir || !jsonLinhas) throw new Error("Uso: paridade-mann-movel.ts <pasta> <linhas.json>");
  const reais: Record<string, string[]> = JSON.parse(fs.readFileSync(jsonLinhas, "utf-8"));
  const xlsx = process.env.MADEIREIRAS_XLSX ?? "tests/fixtures/PlanilhaGeral.xlsx";
  const { empresas } = await lerPlanilhaMadeireiras(fs.readFileSync(xlsx));

  const arquivos = fs.readdirSync(dir);
  const curvas = arquivos.filter((f) => /^\d+ MANN \d+\.pdf$/i.test(f)).sort();

  let okCert = 0, totCert = 0, okLinha = 0, totLinha = 0;
  const lacunasCert = new Map<string, number>();
  const lacunasLinha = new Map<string, number>();
  const divergs = new Map<string, number>();

  for (const nomeCurva of curvas) {
    const num = nomeCurva.match(/^(\d+) /)![1];
    const cert = `CERT ${nomeCurva}`;
    const arqCom = arquivos.find((f) => f.startsWith(`COMUNICADO ${num} - `));
    console.log(`\n=== ${num} (${nomeCurva})`);
    if (!arquivos.includes(cert) || !arqCom) {
      console.log("   faltam arquivos");
      continue;
    }
    const tCurva = await texto(path.join(dir, nomeCurva));
    const tCert = await texto(path.join(dir, cert));
    if (curvaSemTexto(tCurva)) {
      console.log("   curva sem texto");
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
      console.log(`   empresa NÃO identificada (${curva.sistema}; cnpj ${curva.cnpj}; reg ${curva.regMapa}; nome ${nomeEmp})`);
      continue;
    }
    const comunicado = lerComunicado(await texto(path.join(dir, arqCom)));
    const r = montarCertificado({ curva, empresa: ident.empresa, comunicado, nomeArquivo: nomeCurva }, "AQF");
    console.log(`   ${curva.sistema} · ${ident.empresa.apelido} (por ${ident.por}) · ${r.modelo.nome}`);

    // 1) Campos do certificado x certificado emitido
    const tc = norm(tCert);
    const conferir: [string, string][] = [["Número", r.valores.numero ?? ""]];
    for (const cel of camposDoModelo(r.modelo)) {
      const v = r.valores[cel.k] ?? "";
      conferir.push([cel.r, cel.fixo ? textoModalidade(cel, v) : v]);
    }
    let falhas = 0;
    for (const [rot, valor] of conferir) {
      if (!valor) continue;
      totCert++;
      if (tc.includes(norm(valor))) okCert++;
      else {
        falhas++;
        lacunasCert.set(rot, (lacunasCert.get(rot) ?? 0) + 1);
        console.log(`   ✗ cert  ${rot} ${JSON.stringify(valor)}`);
      }
    }
    if (!falhas) console.log("   cert: todos os campos iguais");
    for (const a of r.avisos) console.log(`   ! ${a}`);

    // 2) Conferência comunicado x curva
    const dv = validarComunicado({ curva, comunicado, valores: r.valores, tipo: "AQF" });
    for (const x of dv) {
      divergs.set(`${x.nivel}: ${x.campo}`, (divergs.get(`${x.nivel}: ${x.campo}`) ?? 0) + 1);
      console.log(`   ⚑ [${x.nivel}] ${x.campo}: comunicado ${x.comunicado} | curva ${x.curva.replace(/\s+/g, " ")} | ${x.detalhe}`);
    }

    // 3) Linha do relatório x linha lançada na planilha do MAPA
    const real = reais[`${num}/2026`];
    if (!real) {
      console.log("   (sem linha real do relatório)");
      continue;
    }
    const linha = montarLinhaRelatorio({ empresa: ident.empresa, valores: r.valores, tipo: "AQF", camara: null, padrao: {} });
    COLUNAS_CREDENCIADA.forEach((col, i) => {
      if (/^(processoCertificado|dataEmissao)$/.test(col.key)) return;
      totLinha++;
      const gerado = String(linha[col.key] ?? "").trim();
      const esperado = String(real[i] ?? "").trim();
      if (gerado === esperado) okLinha++;
      else {
        lacunasLinha.set(col.titulo, (lacunasLinha.get(col.titulo) ?? 0) + 1);
        console.log(`   ✗ linha ${col.titulo}: gerado=${JSON.stringify(gerado)} | planilha=${JSON.stringify(esperado)}`);
      }
    });
  }

  console.log(`\n##### RESUMO`);
  console.log(`Certificado: ${okCert}/${totCert} campos iguais ao emitido.`);
  for (const [k, n] of [...lacunasCert].sort((a, b) => b[1] - a[1])) console.log(`   - ${k}: ${n}`);
  console.log(`Linha do relatório: ${okLinha}/${totLinha} células iguais à planilha.`);
  for (const [k, n] of [...lacunasLinha].sort((a, b) => b[1] - a[1])) console.log(`   - ${k}: ${n}`);
  console.log(`Divergências apontadas (comunicado x curva):`);
  for (const [k, n] of [...divergs].sort()) console.log(`   - ${k}: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
