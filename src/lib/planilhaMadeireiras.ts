import ExcelJS from "exceljs";
import { lerDocumento, lerTratamentos, type Madeireira } from "./madeireiras";
import { COLUNAS_CADASTRO, empresaDaLinha } from "./cadastroColunas";
import { chaveNome, soDigitos } from "./util";

/** Aba CADASTRO da planilha nova: cabeçalho com os títulos de COLUNAS_CADASTRO. */
function lerCadastro(wb: ExcelJS.Workbook): { empresas: Madeireira[]; ignoradas: number } | null {
  const ws = wb.worksheets.find((w) => w.name.trim().toUpperCase() === "CADASTRO");
  if (!ws) return null;
  const titulos = new Set(COLUNAS_CADASTRO.map((c) => c.titulo));
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const colunas = new Map<number, string>();
    ws.getRow(r).eachCell((cell, col) => {
      const t = textoDaCelula(cell.value);
      if (t && titulos.has(t)) colunas.set(col, t);
    });
    if (!colunas.size || ![...colunas.values()].includes("CNPJ")) continue;
    const empresas: Madeireira[] = [];
    let ignoradas = 0;
    for (let i = r + 1; i <= ws.rowCount; i++) {
      const linha: Record<string, string | null> = {};
      const row = ws.getRow(i);
      for (const [col, t] of colunas) linha[t] = textoDaCelula(row.getCell(col).value);
      if (!Object.values(linha).some(Boolean)) continue;
      const lida = empresaDaLinha(linha);
      if (!lida || soDigitos(lida.empresa.cnpj).length !== 14) ignoradas++;
      else empresas.push(lida.empresa);
    }
    return { empresas, ignoradas };
  }
  return null;
}

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
  // Planilha nova "Cadastro Madeireiras.xlsx" (aba CADASTRO, com as colunas de configuração).
  const novo = lerCadastro(wb);
  if (novo) return novo;
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
  const programacoes = lerProgramacoes(wb);
  if (programacoes) aplicarProgramacoes(empresas, programacoes);
  return { empresas, ignoradas };
}

interface LinhaProgramacao {
  nome: string;
  status: string;
  processo: string | null;
}

/**
 * Aba PROGRAMAÇÕES da Planilha Geral: RT | EMPRESA | OK / ASSINADO | SEI - PETICIONAMENTO | meses...
 * Quem está nela (e não está CANCELADO) trabalha com programação mensal; o nº
 * do peticionamento é o processo da programação no SEI.
 */
function lerProgramacoes(wb: ExcelJS.Workbook): LinhaProgramacao[] | null {
  const ws = wb.worksheets.find((w) => /^PROGRAMA/i.test(chaveNome(w.name)));
  if (!ws) return null;
  let colEmpresa = -1;
  let colStatus = -1;
  let colProcesso = -1;
  let inicio = -1;
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && inicio < 0; r++) {
    ws.getRow(r).eachCell((cell, col) => {
      const c = chaveNome(textoDaCelula(cell.value));
      if (c === "EMPRESA") colEmpresa = col;
      else if (c.includes("ASSINADO")) colStatus = col;
      else if (c.includes("SEI") || c.includes("PETICION")) colProcesso = col;
    });
    if (colEmpresa > 0) inicio = r + 1;
  }
  if (colEmpresa < 0) return null;

  const linhas: LinhaProgramacao[] = [];
  for (let r = inicio; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nome = textoDaCelula(row.getCell(colEmpresa).value);
    const processo =
      (colProcesso > 0 ? textoDaCelula(row.getCell(colProcesso).value) : null)?.match(/\d{5}\.\d{6}\/\d{4}-\d{2}/)?.[0] ??
      null;
    const status = colStatus > 0 ? (textoDaCelula(row.getCell(colStatus).value) ?? "") : "";
    // Linhas de rodapé/anotações não têm nem processo nem status (ex.: "Inexport (Capivari)" tem só o status).
    if (!nome || /^\d+([.,]\d+)?$/.test(nome) || (!processo && !status)) continue;
    linhas.push({ nome, status, processo });
  }
  return linhas;
}

const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");
const IGNORAR = new Set(["MAD", "MADEIRAS", "MADEIREIRA", "LTDA", "DE", "DA", "DO", "TRIMESTRAL", "MATRIZ", ...UFS]);
const palavras = (s: string) =>
  new Set(
    s
      .split(/[\s().\-/]+/)
      .map(chaveNome)
      .filter((p) => p.length >= 2 && !IGNORAR.has(p))
  );

/** "Mad. Reis" ↔ "Reis", "Giuliano GM" ↔ "GM", "Inexport (Capivari)" ↔ "Inexport Capivari". */
function semelhanca(a: string, b: string): number {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.size || !pb.size) return 0;
  const comuns = [...pa].filter((p) => pb.has(p)).length;
  return comuns / Math.max(pa.size, pb.size) + (comuns === Math.min(pa.size, pb.size) ? 0.5 : 0);
}

function aplicarProgramacoes(empresas: Madeireira[], programacoes: LinhaProgramacao[]) {
  const usadas = new Set<Madeireira>();
  for (const p of programacoes) {
    let melhor: { e: Madeireira; s: number } | null = null;
    for (const e of empresas) {
      if (usadas.has(e)) continue;
      const s = Math.max(semelhanca(p.nome, e.apelido), semelhanca(p.nome, e.razaoSocial) - 0.2);
      if (s >= 0.8 && (!melhor || s > melhor.s)) melhor = { e, s };
    }
    if (!melhor) continue;
    usadas.add(melhor.e);
    if (/cancel/i.test(p.status)) continue;
    melhor.e.processoProgramacao = p.processo;
    if (!melhor.e.documento) melhor.e.documento = "programacao";
  }
  // Com a aba de programações disponível, quem não está nela usa comunicado.
  for (const e of empresas) if (!e.documento) e.documento = "comunicado";
}
