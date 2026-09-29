/**
 * Análise em lote: para cada pasta de empresa (curvas + "CERT <curva>.pdf" + comunicados),
 * gera o certificado e compara campo a campo com o emitido, gravando um JSON por
 * certificado com o valor gerado e o valor emitido de cada campo diferente.
 *
 *   npx tsx scripts/analisar.ts "<pasta com uma subpasta por empresa>" saida.jsonl
 */
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { montarCertificado, sugerirTipo, type TipoTratamento } from "../src/lib/certificado";
import { lerComunicado, type Comunicado } from "../src/lib/comunicado";
import { curvaSemTexto, lerCurva } from "../src/lib/curvas";
import { identificarEmpresa, lerNomeArquivo } from "../src/lib/madeireiras";
import { camposDoModelo, textoModalidade } from "../src/lib/modelos";
import { ocrPrimeiraPagina } from "../src/lib/ocr";
import { lerPlanilhaMadeireiras } from "../src/lib/planilhaMadeireiras";

async function texto(arquivo: string): Promise<string> {
  const p = new PDFParse({ data: fs.readFileSync(arquivo) });
  try {
    return (await p.getText()).text;
  } finally {
    await p.destroy();
  }
}

const norm = (s: string) => s.replace(/\s+/g, "").replace(/[–—]/g, "-").toLowerCase();
const umaLinha = (s: string) => s.replace(/\s+/g, " ").trim();

/** Valor emitido depois de um rótulo, até o próximo rótulo numerado ("2.5.", "3. Local"). */
function valorEmitido(cert: string, rotulo: string): string | null {
  const t = umaLinha(cert);
  const r = umaLinha(rotulo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
  const m = t.match(new RegExp(`${r}\\s*(.*?)(?=\\s\\d{1,2}\\.\\d{0,2}\\.?\\s?[A-ZÁÉÍÓÚÂÊÔÃÕÇN]|\\s-\\sDECLARO|\\sCertificado\\s|$)`, "i"));
  return m ? m[1].trim().slice(0, 160) : null;
}

function modeloEmitido(cert: string): { tipo: TipoTratamento; rodape: string } {
  const rodape = cert.match(/Certificado\s*-?\s*TFQ[^\n(]*/i)?.[0].trim() ?? "";
  const t = umaLinha(cert);
  if (/Estufa/i.test(rodape) || /secagem em estufa/i.test(t)) {
    return { tipo: /estufa:?\s*HT\b/i.test(t) ? "HT" : "KD", rodape };
  }
  return { tipo: "AQF", rodape };
}

async function main() {
  const raiz = process.argv[2];
  const saida = process.argv[3] ?? "analise.jsonl";
  const { empresas } = await lerPlanilhaMadeireiras(fs.readFileSync("tests/fixtures/PlanilhaGeral.xlsx"));
  fs.writeFileSync(saida, "");

  for (const pasta of fs.readdirSync(raiz)) {
    const dir = path.join(raiz, pasta);
    if (!fs.statSync(dir).isDirectory()) continue;
    const arquivos = fs.readdirSync(dir);
    const comunicados: Comunicado[] = [];
    for (const f of arquivos.filter((x) => /^COMUNICADO/i.test(x) && x.endsWith(".pdf"))) {
      try {
        comunicados.push(lerComunicado(await texto(path.join(dir, f))));
      } catch {
        // ignora comunicado ilegível
      }
    }
    const certs = arquivos.filter((f) => /^CERT\.?\s/i.test(f) && f.toLowerCase().endsWith(".pdf"));
    for (const cert of certs) {
      const nomeCurva = cert.replace(/^CERT\.?\s+/i, "");
      const reg: Record<string, unknown> = { pasta, cert };
      const escrever = () => fs.appendFileSync(saida, JSON.stringify(reg) + "\n");
      const arqCurva = arquivos.find((f) => f.toLowerCase() === nomeCurva.toLowerCase());
      if (!arqCurva) {
        reg.erro = "curva não encontrada";
        escrever();
        continue;
      }
      let tCert: string;
      let tCurva: string;
      try {
        tCert = await texto(path.join(dir, cert));
        tCurva = await texto(path.join(dir, arqCurva));
      } catch (e) {
        reg.erro = `falha ao ler PDF: ${e instanceof Error ? e.message : e}`;
        escrever();
        continue;
      }
      if (curvaSemTexto(tCurva)) {
        // Com OCR=1, lê a curva-imagem por OCR (como o site faz); senão só registra.
        if (process.env.OCR === "1") {
          tCurva = await ocrPrimeiraPagina(fs.readFileSync(path.join(dir, arqCurva)));
          reg.ocr = true;
        }
        if (curvaSemTexto(tCurva)) {
          reg.erro = "curva sem texto (imagem)";
          reg.inicioCurva = "";
          escrever();
          continue;
        }
      }
      const curva = lerCurva(tCurva);
      if (!curva) {
        reg.erro = "sistema não reconhecido";
        reg.inicioCurva = umaLinha(tCurva).slice(0, 300);
        escrever();
        continue;
      }
      reg.sistema = curva.sistema;
      const nomeEmp = lerNomeArquivo(nomeCurva).nome;
      const ident = identificarEmpresa(empresas, { cnpj: curva.cnpj, regMapa: curva.regMapa, nomeArquivo: nomeEmp });
      if (!ident) {
        reg.erro = "empresa não identificada";
        reg.nomeArquivo = nomeEmp;
        reg.cnpjCurva = curva.cnpj;
        escrever();
        continue;
      }
      reg.empresa = ident.empresa.apelido;
      reg.identPor = ident.por;
      reg.modalidade = ident.empresa.modalidade;
      reg.tratamentos = ident.empresa.tratamentos.join("/");
      reg.documento = ident.empresa.documento;

      const emitido = modeloEmitido(tCert);
      reg.rodape = emitido.rodape;
      reg.tipoEmitido = emitido.tipo;
      // Comunicado: o da pasta cujo número aparece no certificado emitido.
      const numEmitido = (valorEmitido(tCert, "Número do Comunicado de Tratamento:") ?? "").split(/\s/)[0];
      const comunicado = comunicados.find((c) => c.numero && c.numero === numEmitido) ?? null;
      reg.comunicado = comunicado?.numero ?? null;

      const entrada = { curva, empresa: ident.empresa, comunicado, nomeArquivo: nomeCurva };
      const sug = sugerirTipo(entrada);
      reg.tipoSugerido = sug.tipo;
      reg.motivo = sug.motivo;
      reg.umidadeFinal = curva.umidadeFinal;
      const r = montarCertificado(entrada, emitido.tipo);
      reg.modelo = r.modelo.id;
      reg.avisos = r.avisos;

      const nc = norm(tCert);
      const diffs: { campo: string; gerado: string; emitido: string | null }[] = [];
      let ok = 0;
      const conferir: [string, string, string][] = [["Número", r.valores.numero ?? "", "Quarentenários:"]];
      for (const cel of camposDoModelo(r.modelo)) {
        const v = r.valores[cel.k] ?? "";
        conferir.push([cel.k, cel.fixo ? textoModalidade(cel, v) : v, cel.r]);
      }
      for (const [campo, valor, rotulo] of conferir) {
        if (!valor) {
          diffs.push({ campo, gerado: "", emitido: valorEmitido(tCert, rotulo) });
          continue;
        }
        if (nc.includes(norm(valor))) ok++;
        else diffs.push({ campo, gerado: valor, emitido: valorEmitido(tCert, rotulo) });
      }
      reg.ok = ok;
      reg.total = conferir.length;
      reg.diffs = diffs;
      escrever();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
