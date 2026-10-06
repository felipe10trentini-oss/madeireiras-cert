// Planilha de clientes da MANN MÓVEL (aba DADOS da "COMUNICADO ...xlsx"): quem recebe o serviço
// (tomador). Lida no navegador, como as outras planilhas do projeto.
import ExcelJS from "exceljs";
import type { Tomador } from "./relatorio";
import { soDigitos } from "./util";

export interface LeituraClientes {
  clientes: Tomador[];
  /** Linhas sem nome ou sem CNPJ válido (14 dígitos). */
  ignoradas: number;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function texto(valor: ExcelJS.CellValue): string | null {
  if (valor == null) return null;
  if (typeof valor === "object") {
    if ("richText" in valor) return valor.richText.map((r) => r.text).join("").trim() || null;
    if ("text" in valor) return String(valor.text).trim() || null; // e-mail com hiperlink
    if ("result" in valor) return valor.result == null ? null : String(valor.result).trim() || null;
    return null;
  }
  const t = String(valor).trim();
  return t === "" ? null : t;
}

type CampoCliente = "apelido" | "nome" | "cnpj" | "endereco" | "email" | "telefone" | "enderecoEscritorio";

const COLUNAS: Record<string, CampoCliente> = {
  cliente: "apelido",
  nome: "nome",
  cnpj: "cnpj",
  endereco: "endereco",
  "e-mail": "email",
  email: "email",
  telefone: "telefone",
  "endereco escritorio": "enderecoEscritorio",
};

/** Lê a aba DADOS (ou a primeira) achando as colunas pelo cabeçalho. */
export async function lerPlanilhaClientes(buffer: ArrayBuffer | Buffer): Promise<LeituraClientes> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => /^dados$/i.test(w.name.trim())) ?? wb.worksheets[0];
  if (!ws) throw new Error("A planilha não tem nenhuma aba.");

  let cabecalho = -1;
  const colunas = new Map<number, CampoCliente>();
  for (let r = 1; r <= Math.min(ws.rowCount, 15) && cabecalho < 0; r++) {
    const achadas = new Map<number, CampoCliente>();
    ws.getRow(r).eachCell((cell, col) => {
      const campo = COLUNAS[semAcento(texto(cell.value) ?? "")];
      if (campo) achadas.set(col, campo);
    });
    const campos = [...achadas.values()];
    if (campos.includes("cnpj") && campos.includes("nome")) {
      cabecalho = r;
      achadas.forEach((v, k) => colunas.set(k, v));
    }
  }
  if (cabecalho < 0) throw new Error('Não encontrei as colunas "Nome" e "CNPJ" no topo da planilha.');

  const porCnpj = new Map<string, Tomador>();
  let ignoradas = 0;
  for (let r = cabecalho + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const d: Partial<Record<CampoCliente, string | null>> = {};
    colunas.forEach((campo, col) => {
      d[campo] = texto(row.getCell(col).value);
    });
    if (!d.nome && !d.cnpj) continue; // linha vazia
    const cnpj = soDigitos(d.cnpj);
    if (!d.nome || cnpj.length !== 14) {
      ignoradas++;
      continue;
    }
    porCnpj.set(cnpj, {
      razao: d.nome,
      cnpj: d.cnpj!,
      // O certificado usa o endereço do escritório (com CEP); sem ele, o do local.
      endereco: d.enderecoEscritorio || d.endereco || "",
      // Vários telefones: o certificado separa com " / ".
      telefone: (d.telefone ?? "").replace(/\s*\/\s*/g, " / "),
      email: d.email ?? "",
    });
  }
  return { clientes: [...porCnpj.values()], ignoradas };
}
