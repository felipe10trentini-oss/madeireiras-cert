/**
 * Compara a linha do relatório do MAPA gerada pelo site com as linhas já lançadas
 * nas planilhas de relatório (aba TÉRMICO), para os certificados de uma pasta de análise.
 *
 *   npx tsx scripts/compararRelatorio.ts <pasta com subpastas por empresa> <relatorios.json> <estilos.json>
 * (relatorios.json: exportado das planilhas "<EMPRESA> - 2026.xlsx")
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { montarCertificado, sugerirTipo } from "../src/lib/certificado";
import { lerComunicado, type Comunicado } from "../src/lib/comunicado";
import { curvaSemTexto, lerCurva } from "../src/lib/curvas";
import { identificarEmpresa, lerNomeArquivo } from "../src/lib/madeireiras";
import { lerPlanilhaMadeireiras } from "../src/lib/planilhaMadeireiras";
import type { EstiloRelatorio } from "../src/lib/estiloRelatorio";
import { colunasRelatorio, montarLinhaRelatorio } from "../src/lib/relatorio";
import { chaveNome, levenshtein } from "../src/lib/util";

type Cel = string | { d: string } | { t: string } | { n: number } | null;
interface Rel {
  header: string[];
  rows: Cel[][];
}

async function texto(arquivo: string): Promise<string> {
  const p = new PDFParse({ data: fs.readFileSync(arquivo) });
  try {
    return (await p.getText()).text;
  } finally {
    await p.destroy();
  }
}

const celTexto = (c: Cel): string =>
  c == null ? "" : typeof c === "string" ? c.trim() : "d" in c ? c.d : "t" in c ? c.t : String(c.n);

function iguais(nosso: string, deles: Cel): boolean {
  const a = nosso.trim();
  const b = celTexto(deles);
  if (!a && !b) return true;
  if (deles && typeof deles === "object" && "n" in deles) {
    const n = parseFloat(a.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    if (Number.isFinite(n) && Math.abs(n - deles.n) < 0.0015) return true;
  }
  if (deles && typeof deles === "object" && "t" in deles) return a.replace(/h|m$/g, ":").replace(/:$/, "") === b;
  return chaveNome(a) === chaveNome(b);
}

async function main() {
  const raiz = process.argv[2];
  const rels: Record<string, Rel> = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const estilos: Record<string, { estilo: EstiloRelatorio }> = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
  const estiloDaEmpresa = (cnpj: string) => estilos[cnpj.replace(/\D/g, "")]?.estilo ?? null;
  const { empresas } = await lerPlanilhaMadeireiras(fs.readFileSync("tests/fixtures/PlanilhaGeral.xlsx"));
  const nomesRel = Object.keys(rels);
  const difs = new Map<string, { n: number; total: number; ex: string[] }>();
  const porEmpresa = new Map<string, { ok: number; total: number }>();
  const cabecalhos = new Map<string, string>();

  for (const pasta of fs.readdirSync(raiz)) {
    const dir = path.join(raiz, pasta);
    if (!fs.statSync(dir).isDirectory()) continue;
    const arquivos = fs.readdirSync(dir);
    const comunicados: Comunicado[] = [];
    for (const f of arquivos.filter((x) => /^COMUNICADO/i.test(x))) {
      try {
        comunicados.push(lerComunicado(await texto(path.join(dir, f))));
      } catch {}
    }
    for (const cert of arquivos.filter((f) => /^CERT\.?\s/i.test(f))) {
      const nomeCurva = cert.replace(/^CERT\.?\s+/i, "");
      if (!arquivos.includes(nomeCurva)) continue;
      const t = await texto(path.join(dir, nomeCurva));
      if (curvaSemTexto(t)) continue;
      const curva = lerCurva(t);
      if (!curva) continue;
      const ident = identificarEmpresa(empresas, {
        cnpj: curva.cnpj,
        regMapa: curva.regMapa,
        nomeArquivo: lerNomeArquivo(nomeCurva).nome,
      });
      if (!ident) continue;
      const emp = ident.empresa;
      // Planilha de relatório da empresa: nome do arquivo mais parecido com o apelido/razão social.
      const alvo = chaveNome(emp.apelido.replace(/\(.*?\)/g, ""));
      const arqRel = nomesRel
        .map((n) => ({ n, k: chaveNome(n.replace(/- 2026.*$/i, "")) }))
        .map((x) => ({ ...x, d: x.k.includes(alvo) || alvo.includes(x.k) ? 0 : levenshtein(x.k, alvo) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!arqRel || arqRel.d > 3) continue;
      const rel = rels[arqRel.n];
      const tCert = (await texto(path.join(dir, cert))).replace(/\s+/g, " ");
      const numCert = tCert.match(/Quarentenários:\s*(\S+)/)?.[1] ?? "";
      const colCert = rel.header.findIndex((h) => /N[º°o] do Certificado/i.test(h));
      const linha = rel.rows.find((r) => celTexto(r[colCert]) === numCert);
      if (!linha) continue;

      const numCom = tCert.match(/Comunicado de [Tt]ratamento:\s*(\S+)/)?.[1];
      const comunicado = comunicados.find((c) => c.numero === numCom) ?? null;
      const entrada = { curva, empresa: emp, comunicado, nomeArquivo: nomeCurva };
      const tipo = sugerirTipo(entrada).tipo;
      const r = montarCertificado(entrada, tipo);
      const nossa = montarLinhaRelatorio({ empresa: emp, valores: r.valores, tipo, camara: curva.camara, padrao: {}, estilo: estiloDaEmpresa(emp.cnpj) });
      const cols = colunasRelatorio(emp);
      if (cols.length !== rel.header.filter(Boolean).length) console.error("MODELO DIFERENTE", arqRel.n, cols.length, rel.header.filter(Boolean).length);
      cabecalhos.set(arqRel.n, `${rel.header.length} colunas no relatório x ${cols.length} no site`);
      const pe = porEmpresa.get(arqRel.n) ?? { ok: 0, total: 0 };
      cols.forEach((c, i) => {
        // Estes vêm dos dados salvos por empresa (processo, data, RT, volume da câmara) ou do SEI depois.
        if (["dataDocumento", "processoCertificado", "dataEmissao"].includes(c.key)) return;
        const chave = `${String.fromCharCode(65 + i)} ${c.titulo}`;
        const d = difs.get(chave) ?? { n: 0, total: 0, ex: [] };
        d.total++;
        pe.total++;
        if (iguais(nossa[c.key] ?? "", linha[i])) pe.ok++;
        else {
          d.n++;
          if (d.ex.length < 40) d.ex.push(`${arqRel.n.replace(/ - 2026.*/, "")}: site=${JSON.stringify(nossa[c.key])} planilha=${JSON.stringify(celTexto(linha[i]))}`);
        }
        difs.set(chave, d);
      });
      porEmpresa.set(arqRel.n, pe);
    }
  }
  console.log("== Colunas");
  for (const [k, d] of [...difs.entries()].sort()) {
    console.log(`${k}: ${d.n}/${d.total} diferentes`);
    for (const e of d.ex) console.log(`     ${e}`);
  }
  console.log("\n== Por empresa");
  for (const [k, v] of porEmpresa) console.log(`${k}: ${v.ok}/${v.total}  (${cabecalhos.get(k)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
