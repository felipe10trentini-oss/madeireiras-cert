/**
 * Gera "Cadastro Madeireiras.xlsx" (aba CADASTRO + INSTRUÇÕES) já preenchida com o cadastro do
 * Supabase, as regras de cada empresa (REGRAS_EMPRESA) e quem tem DR.
 *
 *   npx tsx --env-file=.env.local scripts/gerarPlanilhaCadastro.ts <saida.xlsx> [pasta de curvas por empresa]
 * (a pasta opcional serve para preencher o "Sistema da curva" lendo uma curva de cada empresa)
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { curvaSemTexto, lerCurva } from "../src/lib/curvas";
import { identificarEmpresa, lerNomeArquivo } from "../src/lib/madeireiras";
import { listarMadeireiras, type MadeireiraSalva } from "../src/lib/madeireirasDb";
import { linhaDaEmpresa, montarPlanilhaCadastro } from "../src/lib/planilhaCadastro";
import { soDigitos } from "../src/lib/util";

const INATIVAS = /^(WAS|Andreazza)/i; // desativadas (30/09/2026)
const COM_PLANILHA_CONTROLE = /NASA|Ponte Alta|Videpinus|IR Madeiras|Artemobili|Rio Verde|Palletimber|Selva Norte|Salamoni/i;

async function sistemas(pasta: string | undefined, empresas: MadeireiraSalva[]): Promise<Map<string, string>> {
  const r = new Map<string, string>();
  if (!pasta) return r;
  for (const sub of fs.readdirSync(pasta)) {
    const dir = path.join(pasta, sub);
    if (!fs.statSync(dir).isDirectory()) continue;
    const curvas = fs.readdirSync(dir).filter((f) => /^\d+\s.*\.pdf$/i.test(f)).slice(0, 4);
    for (const f of curvas) {
      const p = new PDFParse({ data: fs.readFileSync(path.join(dir, f)) });
      const t = (await p.getText()).text;
      await p.destroy();
      const c = curvaSemTexto(t) ? null : lerCurva(t);
      const ident = identificarEmpresa(empresas, { cnpj: c?.cnpj, regMapa: c?.regMapa, nomeArquivo: lerNomeArquivo(f).nome });
      if (!ident) continue;
      const k = soDigitos(ident.empresa.cnpj);
      const s = c?.sistema ?? (/SALAMONI/i.test(f) ? "Mahild" : null);
      if (s && !r.get(k)?.includes(s)) r.set(k, r.get(k) ? `${r.get(k)} / ${s}` : s);
    }
  }
  return r;
}

async function main() {
  const saida = process.argv[2];
  const empresas = (await listarMadeireiras()).sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  const sis = await sistemas(process.argv[3], empresas);
  const linhas = empresas.map((e) => {
    const sistema = sis.get(soDigitos(e.cnpj)) ?? e.config?.sistemaCurva ?? "";
    return linhaDaEmpresa(e, {
      sistema,
      inativa: INATIVAS.test(e.apelido),
      planilhaControle: COM_PLANILHA_CONTROLE.test(e.apelido) && /SV520|Mahild/.test(sistema),
    });
  });
  await montarPlanilhaCadastro(linhas).xlsx.writeFile(saida);
  console.log(`${empresas.length} empresas -> ${saida}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
