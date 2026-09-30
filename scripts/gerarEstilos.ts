/**
 * Gera o estilo de preenchimento do relatório do MAPA
 * de cada empresa, aprendido das planilhas "<EMPRESA> - 2026.xlsx" (aba TÉRMICO).
 *
 *   npx tsx --env-file=.env.local scripts/gerarEstilos.ts <relatorios.json> <saida estilos.json> [--gravar]
 * Com --gravar, salva cada estilo no Supabase (empresas.relatorio.estilo). O JSON de saída contém
 * dados dos clientes (processos, RT): mantenha fora do repositório.
 * (relatorios.json: { "<arquivo>": { header: string[], rows: Celula[][] } }, exportado das planilhas)
 */
import fs from "node:fs";
import { derivarEstilo, type Celula, type EstiloRelatorio } from "../src/lib/estiloRelatorio";
import { gravarEstilos } from "../src/lib/madeireirasDb";
import { lerPlanilhaMadeireiras } from "../src/lib/planilhaMadeireiras";
import { chaveNome, levenshtein, soDigitos } from "../src/lib/util";

const IGNORAR = new Set(["MADEIREIRA", "MADEIRAS", "MADEIRA", "LTDA", "2026", "CADASTRADA", "CREDENCIADA", "SERRARIA", "IND", "COM", "E", "DE"]);
const palavras = (s: string) =>
  s
    .split(/[\s().&/\-]+/)
    .map(chaveNome)
    .filter((p) => p.length >= 2 && !IGNORAR.has(p));

async function main() {
  const rels: Record<string, { header: string[]; rows: Celula[][] }> = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { empresas } = await lerPlanilhaMadeireiras(fs.readFileSync("tests/fixtures/PlanilhaGeral.xlsx"));
  const saida: Record<string, { arquivo: string; estilo: unknown; nota: number }> = {};

  /** Empresas cujo apelido ou razão social casa com o nome do arquivo (e a nota do casamento). */
  function empresasDoArquivo(nome: string) {
    const pa = palavras(nome);
    // Empresas cujo apelido ou razão social casa com o nome do arquivo.
    const cands = empresas
      .map((e) => {
        const pe = [...new Set([...palavras(e.apelido), ...palavras(e.razaoSocial)])];
        const comuns = pa.filter((p) => pe.some((q) => q === p || (p.length >= 5 && levenshtein(p, q) <= 1))).length;
        // Nome inteiro igual ("PACK TOGO" = "Packtogo") vale mais; senão, proporção de palavras em comum
        // em relação à maior lista (evita "HENRIQUE" casar com "Henrique Grando").
        const inteiro = chaveNome(nome) === chaveNome(e.apelido) ? 2 : 0;
        return { e, s: inteiro || comuns / Math.max(pa.length, palavras(e.apelido).length || 1) };
      })
      .filter((x) => x.s >= 0.5)
      .sort((a, b) => b.s - a.s);
    if (!cands.length) return null;
    let melhor = cands.filter((c) => c.s === cands[0].s).map((c) => c.e);
    // Empate ("HENRIQUE. MAD" x Henrique, Henrique Grando, Mad. Pontal): vale o apelido que abre o nome do arquivo.
    const prefixo = melhor.filter((e) => chaveNome(nome).startsWith(chaveNome(e.apelido)));
    if (melhor.length > 1 && prefixo.length) melhor = prefixo;
    return { melhor, nota: cands[0].s };
  }

  for (const [arquivo, rel] of Object.entries(rels)) {
    if (!rel.rows.length) continue;
    const achou = empresasDoArquivo(arquivo.replace(/\s*-\s*2026.*$/i, "").replace(/\.xlsx$/i, ""));
    if (!achou) {
      console.log(`?? ${arquivo}: nenhuma empresa`);
      continue;
    }
    const { melhor } = achou;
    const cands = [{ s: achou.nota }];
    const estilo = derivarEstilo(rel.header, rel.rows);
    if (!estilo) continue;
    for (const e of melhor) {
      const k = soDigitos(e.cnpj);
      if (!saida[k] || saida[k].nota < cands[0].s) saida[k] = { arquivo, estilo, nota: cands[0].s };
    }
    console.log(`${arquivo} -> ${melhor.map((e) => e.apelido).join(", ")}`);
  }
  // DR (Demonstrativo de Rastreabilidade): em que colunas da aba DADOS se digita o fim
  // (e, na Pinustan, o início e o fim do HT na aba DADOS HT).
  const iDrs = process.argv.indexOf("--drs");
  if (iDrs > 0) {
    const drs: Record<string, Record<string, { header: string[] }>> = JSON.parse(fs.readFileSync(process.argv[iDrs + 1], "utf8"));
    const letra = (i: number) => String.fromCharCode(65 + i);
    for (const [arquivo, abas] of Object.entries(drs)) {
      const achou = empresasDoArquivo(arquivo.replace(/\s*-\s*DR.*$/i, ""));
      if (!achou || !Object.keys(abas).length) {
        console.log(`?? DR ${arquivo}: nenhuma empresa`);
        continue;
      }
      const dr = {
        arquivo,
        abas: Object.entries(abas).map(([aba, v]) => {
          const datas = v.header.map((h, i) => (/^data$/i.test(h.trim()) ? i : -1)).filter((i) => i >= 0);
          return { aba, colunaInicio: datas[0] != null ? letra(datas[0]) : null, colunaFim: datas[1] != null ? letra(datas[1]) : null };
        }),
      };
      for (const e of achou.melhor) {
        const k = soDigitos(e.cnpj);
        saida[k] ??= { arquivo: "", estilo: {}, nota: 0 };
        (saida[k].estilo as { dr?: unknown }).dr = dr;
      }
      console.log(`DR ${arquivo} -> ${achou.melhor.map((e) => e.apelido).join(", ")} ${dr.abas.map((a) => `${a.aba}:${a.colunaFim}`).join(" ")}`);
    }
  }
  const final = Object.fromEntries(Object.entries(saida).map(([k, v]) => [k, { arquivo: v.arquivo, estilo: v.estilo }]));
  fs.writeFileSync(process.argv[3], JSON.stringify(final, null, 1));
  console.log(`\n${Object.keys(saida).length} empresas com estilo.`);
  if (process.argv.includes("--gravar")) {
    const n = await gravarEstilos(Object.fromEntries(Object.entries(saida).map(([k, v]) => [k, v.estilo as EstiloRelatorio])));
    console.log(`${n} empresas atualizadas no Supabase.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
