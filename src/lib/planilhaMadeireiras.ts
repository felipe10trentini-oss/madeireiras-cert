import ExcelJS from "exceljs";
import { lerDocumento, lerTratamentos, type Madeireira } from "./madeireiras";
import { chaveNome, soDigitos } from "./util";

function textoDaCelula(valor: ExcelJS.CellValue): string | null {
  if (valor == null) return null;
  if (typeof valor === "object") {
    if ("richText" in valor) return valor.richText.map((r) => r.text).join("").trim() || null;
    if ("text" in valor) return String(valor.text).trim() || null; // e-mail com hiperlink
    if ("result" in valor) return valor.result == null ? null : String(valor.result).trim() || null;
    return null;
  }
  const t = String(valor).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

type Campo = keyof Madeireira | "_modalidade" | "_tratamentos" | "_documento";

/** Cabeçalho da planilha (sem acento, só letras) -> campo. */
function campoDoCabecalho(cab: string): Campo | null {
  const c = chaveNome(cab);
  if (!c) return null;
  if (c === "EMPRESA") return "apelido";
  if (c === "RT") return "rt";
  if (c === "UF") return "uf";
  if (c === "MODALIDADE") return "_modalidade";
  if (c.startsWith("TRAT")) return "_tratamentos";
  if (c.startsWith("RAZAO")) return "razaoSocial";
  if (c === "CNPJ") return "cnpj";
  if (c.includes("CREA")) return "crea";
  if (c.startsWith("TELEFONE")) return "telefone";
  if (c.startsWith("ENDERECO")) return "endereco";
  if (c.includes("MAPA")) return "regMapa";
  if (c.startsWith("EMAIL")) return "email";
  if (c.includes("PROGRAM") || c.includes("COMUNIC") || c.startsWith("DOCUMENTO")) return "_documento";
  if (c.includes("UNIDADE") || c.includes("VOLUME")) return "unidadeVolumes";
  return null;
}

/**
 * Lê a planilha de madeireiras (aba DADOS CADASTRAIS ou a primeira), achando a
 * linha de cabeçalho pelas colunas "RAZÃO SOCIAL" e "CNPJ". As colunas extras
 * "PROGRAMAÇÃO/COMUNICADO" e "UNIDADE" são opcionais.
 */
export async function lerPlanilhaMadeireiras(
  buffer: Buffer | ArrayBuffer
): Promise<{ empresas: Madeireira[]; ignoradas: number }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = wb.worksheets.find((w) => /cadastr/i.test(w.name)) ?? wb.worksheets[0];
  if (!ws) throw new Error("A planilha não tem nenhuma aba.");

  let cabecalho = -1;
  const mapa = new Map<number, Campo>();
  for (let r = 1; r <= Math.min(ws.rowCount, 20) && cabecalho < 0; r++) {
    const tentativa = new Map<number, Campo>();
    ws.getRow(r).eachCell((cell, col) => {
      const campo = campoDoCabecalho(textoDaCelula(cell.value) ?? "");
      if (campo && ![...tentativa.values()].includes(campo)) tentativa.set(col, campo);
    });
    const campos = [...tentativa.values()];
    if (campos.includes("razaoSocial") && campos.includes("cnpj")) {
      cabecalho = r;
      tentativa.forEach((v, k) => mapa.set(k, v));
    }
  }
  if (cabecalho < 0) throw new Error('Não encontrei as colunas "RAZÃO SOCIAL" e "CNPJ" na planilha.');

  const empresas: Madeireira[] = [];
  const vistos = new Set<string>();
  let ignoradas = 0;
  for (let r = cabecalho + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const d: Partial<Record<Campo, string | null>> = {};
    mapa.forEach((campo, col) => (d[campo] = textoDaCelula(row.getCell(col).value)));
    if (!d.razaoSocial && !d.cnpj) continue;
    const cnpj = soDigitos(d.cnpj);
    if (!d.razaoSocial || cnpj.length !== 14 || vistos.has(cnpj)) {
      ignoradas++;
      continue;
    }
    vistos.add(cnpj);
    empresas.push({
      apelido: (d.apelido ?? d.razaoSocial).trim(),
      rt: d.rt?.trim() ?? null,
      uf: d.uf?.trim() ?? null,
      modalidade: /credenc/i.test(d._modalidade ?? "") ? "Credenciada" : "Cadastrada",
      tratamentos: lerTratamentos(d._tratamentos),
      razaoSocial: d.razaoSocial.trim(),
      cnpj: (d.cnpj ?? "").trim(),
      crea: d.crea?.trim() ?? null,
      telefone: d.telefone?.trim() ?? null,
      endereco: d.endereco?.trim() ?? null,
      regMapa: d.regMapa?.trim() ?? null,
      email: d.email?.trim() ?? null,
      documento: lerDocumento(d._documento),
      unidadeVolumes: d.unidadeVolumes?.trim() ?? null,
    });
  }
  return { empresas, ignoradas };
}
