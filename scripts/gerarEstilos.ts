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

  for (const [arquivo, rel] of Object.entries(rels)) {
    if (!rel.rows.length) continue;
    const nome = arquivo.replace(/\s*-\s*2026.*$/i, "").replace(/\.xlsx$/i, "");
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
    if (!cands.length) {
      console.log(`?? ${arquivo}: nenhuma empresa`);
      continue;
    }
    const melhor = cands.filter((c) => c.s === cands[0].s).map((c) => c.e);
    const estilo = derivarEstilo(rel.header, rel.rows);
    if (!estilo) continue;
    for (const e of melhor) {
      const k = soDigitos(e.cnpj);
      if (!saida[k] || saida[k].nota < cands[0].s) saida[k] = { arquivo, estilo, nota: cands[0].s };
    }
    console.log(`${arquivo} -> ${melhor.map((e) => e.apelido).join(", ")}`);
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
