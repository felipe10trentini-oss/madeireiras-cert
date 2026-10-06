// Monta a planilha "Cadastro Madeireiras.xlsx" (aba CADASTRO + INSTRUÇÕES) a partir do cadastro
// salvo — usada no backup da aba Madeireiras (no navegador) e por scripts/gerarPlanilhaCadastro.ts.
// O arquivo gerado pode ser editado e enviado de volta pelo upload da mesma aba.
// Também a planilha de backup dos acessos do SEI dos RTs (mesmas colunas da aba ACESSO SEI).
import ExcelJS from "exceljs";
import { COLUNAS_CADASTRO } from "./cadastroColunas";
import { REGRAS_EMPRESA, type RegraEmpresa } from "./certificado";
import type { ConfigEmpresa } from "./madeireiras";
import type { MadeireiraSalva } from "./madeireirasDb";
import { rtCompleto } from "./responsaveis";
import { soDigitos } from "./util";

function formatoLote(r: RegraEmpresa & ConfigEmpresa): string {
  if (r.loteTresDigitos) return "Ciclo com 3 dígitos (4-043)";
  if (r.loteSemHifen) return "Sem hífen (1514)";
  if (r.loteEhNumero) return "Lote = nº do certificado";
  if (r.numeroEhLote) return "Nº do certificado = lote";
  if (r.loteSequencial) return "Sequencial da empresa";
  if (r.loteAnoSemana) return "Ano + semana (2640)";
  return "Padrão (estufa-ciclo)";
}

const cnpjFormatado = (c: string) => soDigitos(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/**
 * Empresa salva -> valores das colunas da aba CADASTRO (por título). Usado no backup e para
 * abrir o formulário de edição já preenchido. `extra` deixa o script completar o que não está
 * salvo (sistema da curva lido das curvas, empresas desativadas antes da coluna "Ativa").
 */
export function linhaDaEmpresa(
  e: MadeireiraSalva,
  extra: { sistema?: string | null; planilhaControle?: boolean; inativa?: boolean } = {}
): Record<string, string> {
  const r: RegraEmpresa & ConfigEmpresa = { ...(REGRAS_EMPRESA[soDigitos(e.cnpj)] ?? {}), ...(e.config ?? {}) };
  const doc =
    e.documento === "comunicado"
      ? "Comunicado"
      : e.documento === "programacao"
        ? r.programacaoTrimestral
          ? "Programação trimestral"
          : "Programação mensal"
        : "";
  const dr = e.estilo?.dr;
  const sn = (b: unknown) => (b ? "Sim" : "Não");
  const valores: Record<string, string | number | null | undefined> = {
    Apelido: e.apelido,
    "Razão social": e.razaoSocial,
    CNPJ: e.cnpj,
    Modalidade: e.modalidade,
    Tratamentos: e.tratamentos.join("/"),
    "Registro MAPA": e.regMapa,
    CREA: e.crea,
    "Responsável técnico": rtCompleto(e.rt) || e.estilo?.rt || null,
    UF: e.uf,
    "Endereço completo": e.endereco,
    Telefone: e.telefone,
    "E-mail": e.email,
    Ativa: extra.inativa || r.inativa ? "Não" : "Sim",
    Documento: doc,
    "Nº do processo da programação": e.relatorio?.processo ?? null,
    "Sistema da curva": extra.sistema ?? r.sistemaCurva ?? "",
    "Unidade dos volumes": e.unidadeVolumes ?? r.unidadeVolumes ?? null,
    "Descrição do produto fixa": r.produto ?? null,
    "Bitola padrão (mm)": r.bitolaPadraoMm ?? null,
    "Formato do lote": formatoLote(r),
    "Formato do ciclo": r.cicloSV520 ?? null,
    "Ciclo com 3 dígitos": sn(r.cicloTresDigitos),
    "E-mail no certificado": r.email ?? null,
    "Kit de paletes = AQF": sn(r.kitEhAqf),
    "Curva SV580 HT = AQF": sn(r.htEhAqf),
    'Embalagem "de madeira"': sn(r.embalagemDeMadeira),
    "Planilha de controle do cliente": sn(r.planilhaControle ?? extra.planilhaControle),
    "Prestadora de serviço": sn(r.prestadora),
    "CNPJ do prestador (matriz)": r.prestadorCnpj ? cnpjFormatado(r.prestadorCnpj) : null,
    "Tomador fixo - razão social": r.tomadorFixo?.razao ?? null,
    "Tomador fixo - CNPJ": r.tomadorFixo?.cnpj ?? null,
    "Tomador fixo - endereço": r.tomadorFixo?.endereco ?? null,
    "Tomador fixo - telefone": r.tomadorFixo?.telefone ?? null,
    "Tomador fixo - e-mail": r.tomadorFixo?.email ?? null,
    "Tem DR": sn(r.temDR ?? !!dr),
    "DR com KD e HT separados": sn(r.drKdHt ?? (dr?.abas.length ?? 0) > 1),
    Observações: r.observacoes ?? null,
  };
  return Object.fromEntries(COLUNAS_CADASTRO.map((c) => [c.titulo, valores[c.titulo] == null ? "" : String(valores[c.titulo])]));
}

const CORES: Record<string, string> = {
  "Dados da empresa": "FFDCE6F2",
  Documento: "FFE2EFDA",
  Certificado: "FFFFF2CC",
  "Tomador / prestador": "FFFCE4D6",
  Relatórios: "FFEDE7F6",
};

/** Planilha de cadastro com uma linha por empresa (`linhas` = valores por título da coluna). */
export function montarPlanilhaCadastro(linhas: Record<string, string>[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Certificados Madeireiras";
  const ws = wb.addWorksheet("CADASTRO", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });

  // Linha 1: grupos; linha 2: títulos das colunas.
  COLUNAS_CADASTRO.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.largura;
    const g = ws.getCell(1, i + 1);
    g.value = c.grupo;
    g.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CORES[c.grupo] } };
    g.font = { bold: true, size: 9, color: { argb: "FF555555" } };
    const h = ws.getCell(2, i + 1);
    h.value = c.titulo;
    h.font = { bold: true };
    h.alignment = { wrapText: true, vertical: "middle" };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CORES[c.grupo] } };
    h.border = { bottom: { style: "thin" } };
    if (c.ajuda) h.note = `${c.obrigatoria ? "Obrigatória. " : ""}${c.ajuda}`;
  });
  ws.getRow(2).height = 45;
  // Junta as células do grupo na linha 1.
  let ini = 0;
  COLUNAS_CADASTRO.forEach((c, i) => {
    const prox = COLUNAS_CADASTRO[i + 1];
    if (!prox || prox.grupo !== c.grupo) {
      if (i > ini) ws.mergeCells(1, ini + 1, 1, i + 1);
      ini = i + 1;
    }
  });

  for (const l of linhas) {
    ws.addRow(
      COLUNAS_CADASTRO.map((c) => {
        const v = l[c.titulo] ?? "";
        if (c.tipo === "numero" && v && Number.isFinite(Number(v.replace(",", ".")))) return Number(v.replace(",", "."));
        return v || null;
      })
    );
  }

  // Listas suspensas (até a linha 500, para as empresas novas).
  COLUNAS_CADASTRO.forEach((c, i) => {
    if (c.tipo !== "lista" || !c.opcoes) return;
    const letra = ws.getColumn(i + 1).letter;
    for (let row = 3; row <= 500; row++) {
      ws.getCell(`${letra}${row}`).dataValidation = {
        type: "list",
        allowBlank: !c.obrigatoria,
        formulae: [`"${c.opcoes.join(",")}"`],
        showErrorMessage: true,
        errorTitle: c.titulo,
        error: `Escolha uma das opções: ${c.opcoes.join(", ")}`,
      };
    }
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: COLUNAS_CADASTRO.length } };

  const inst = wb.addWorksheet("INSTRUÇÕES");
  inst.columns = [
    { header: "Coluna", key: "c", width: 32 },
    { header: "Grupo", key: "g", width: 20 },
    { header: "Obrigatória", key: "o", width: 11 },
    { header: "Opções", key: "p", width: 40 },
    { header: "Para que serve", key: "a", width: 90 },
  ];
  inst.getRow(1).font = { bold: true };
  inst.addRow({
    c: "Como atualizar o site",
    a: "Preencha/ajuste a aba CADASTRO e envie o arquivo na aba Madeireiras do site (Ver o que vai mudar → Aplicar). A chave é o CNPJ; nada é apagado.",
  });
  inst.addRow({});
  for (const c of COLUNAS_CADASTRO) {
    const row = inst.addRow({ c: c.titulo, g: c.grupo, o: c.obrigatoria ? "Sim" : "", p: c.opcoes?.join(" · ") ?? "", a: c.ajuda });
    row.alignment = { wrapText: true, vertical: "top" };
  }
  return wb;
}

export interface RtAcesso {
  nome: string;
  funcao: string | null;
  empresa: string | null;
  login: string;
  senha: string;
}

/** Backup dos acessos do SEI: aba ACESSO SEI com as colunas que o upload reconhece. */
export function montarPlanilhaRts(rts: RtAcesso[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Certificados Madeireiras";
  const ws = wb.addWorksheet("ACESSO SEI", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "LOGIN RESP.", key: "nome", width: 38 },
    { header: "RESPONSABILIDADE", key: "funcao", width: 20 },
    { header: "EMPRESA", key: "empresa", width: 28 },
    { header: "LOGIN", key: "login", width: 36 },
    { header: "SENHA", key: "senha", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rts) ws.addRow(r);
  return wb;
}

/** Baixa a planilha no navegador ("Cadastro Madeireiras 2026-10-06.xlsx"). */
export async function baixarPlanilha(wb: ExcelJS.Workbook, nome: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
