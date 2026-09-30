/**
 * Gera "Cadastro Madeireiras.xlsx" (aba CADASTRO + INSTRUÇÕES) já preenchida com o cadastro do
 * Supabase, as regras de cada empresa (REGRAS_EMPRESA) e quem tem DR.
 *
 *   npx tsx --env-file=.env.local scripts/gerarPlanilhaCadastro.ts <saida.xlsx> [pasta de curvas por empresa]
 * (a pasta opcional serve para preencher o "Sistema da curva" lendo uma curva de cada empresa)
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { PDFParse } from "pdf-parse";
import { COLUNAS_CADASTRO } from "../src/lib/cadastroColunas";
import { REGRAS_EMPRESA } from "../src/lib/certificado";
import { curvaSemTexto, lerCurva } from "../src/lib/curvas";
import { identificarEmpresa, lerNomeArquivo } from "../src/lib/madeireiras";
import { listarMadeireiras, type MadeireiraSalva } from "../src/lib/madeireirasDb";
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

function formatoLote(r: (typeof REGRAS_EMPRESA)[string]): string {
  if (r.loteTresDigitos) return "Ciclo com 3 dígitos (4-043)";
  if (r.loteSemHifen) return "Sem hífen (1514)";
  if (r.loteEhNumero) return "Lote = nº do certificado";
  if (r.numeroEhLote) return "Nº do certificado = lote";
  if (r.loteSequencial) return "Sequencial da empresa";
  if (r.loteAnoSemana) return "Ano + semana (2640)";
  return "Padrão (estufa-ciclo)";
}

async function main() {
  const saida = process.argv[2];
  const empresas = (await listarMadeireiras()).sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  const sis = await sistemas(process.argv[3], empresas);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Certificados Madeireiras";
  const ws = wb.addWorksheet("CADASTRO", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });

  // Linha 1: grupos; linha 2: títulos das colunas.
  const cores: Record<string, string> = {
    "Dados da empresa": "FFDCE6F2",
    Documento: "FFE2EFDA",
    Certificado: "FFFFF2CC",
    "Tomador / prestador": "FFFCE4D6",
    Relatórios: "FFEDE7F6",
  };
  COLUNAS_CADASTRO.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.largura;
    const g = ws.getCell(1, i + 1);
    g.value = c.grupo;
    g.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cores[c.grupo] } };
    g.font = { bold: true, size: 9, color: { argb: "FF555555" } };
    const h = ws.getCell(2, i + 1);
    h.value = c.titulo;
    h.font = { bold: true };
    h.alignment = { wrapText: true, vertical: "middle" };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cores[c.grupo] } };
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

  for (const e of empresas) {
    const k = soDigitos(e.cnpj);
    const r = { ...(REGRAS_EMPRESA[k] ?? {}), ...(e.config ?? {}) };
    const doc = e.documento === "comunicado" ? "Comunicado" : e.documento === "programacao" ? (r.programacaoTrimestral ? "Programação trimestral" : "Programação mensal") : "";
    const sistema = sis.get(k) ?? r.sistemaCurva ?? "";
    const dr = e.estilo?.dr;
    const sn = (b: unknown) => (b ? "Sim" : "Não");
    const valores: Record<string, string | number | null> = {
      Apelido: e.apelido,
      "Razão social": e.razaoSocial,
      CNPJ: e.cnpj,
      Modalidade: e.modalidade,
      Tratamentos: e.tratamentos.join("/"),
      "Registro MAPA": e.regMapa,
      CREA: e.crea,
      "Responsável técnico": e.relatorio?.rt || e.estilo?.rt || e.rt,
      UF: e.uf,
      "Endereço completo": e.endereco,
      Telefone: e.telefone,
      "E-mail": e.email,
      Ativa: INATIVAS.test(e.apelido) || r.inativa ? "Não" : "Sim",
      Documento: doc,
      "Nº do processo da programação": e.relatorio?.processo ?? null,
      "Sistema da curva": sistema,
      "Unidade dos volumes": e.unidadeVolumes ?? r.unidadeVolumes ?? null,
      "Descrição do produto fixa": r.produto ?? null,
      "Bitola padrão (mm)": r.bitolaPadraoMm ?? null,
      "Formato do lote": formatoLote(r),
      "Formato do ciclo": r.cicloSV520 ?? null,
      "E-mail no certificado": r.email ?? null,
      "Kit de paletes = AQF": sn(r.kitEhAqf),
      "Curva SV580 HT = AQF": sn(r.htEhAqf),
      'Embalagem "de madeira"': sn(r.embalagemDeMadeira),
      "Planilha de controle do cliente": sn(r.planilhaControle ?? (COM_PLANILHA_CONTROLE.test(e.apelido) && /SV520|Mahild/.test(sistema))),
      "Prestadora de serviço": sn(r.prestadora),
      "CNPJ do prestador (matriz)": r.prestadorCnpj ? r.prestadorCnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : null,
      "Tomador fixo - razão social": r.tomadorFixo?.razao ?? null,
      "Tomador fixo - CNPJ": r.tomadorFixo?.cnpj ?? null,
      "Tomador fixo - endereço": r.tomadorFixo?.endereco ?? null,
      "Tomador fixo - telefone": r.tomadorFixo?.telefone ?? null,
      "Tomador fixo - e-mail": r.tomadorFixo?.email ?? null,
      "Tem DR": sn(r.temDR ?? !!dr),
      "DR com KD e HT separados": sn(r.drKdHt ?? (dr?.abas.length ?? 0) > 1),
      Observações: r.observacoes ?? null,
    };
    ws.addRow(COLUNAS_CADASTRO.map((c) => valores[c.titulo] ?? null));
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
  inst.addRow({ c: "Como atualizar o site", a: "Preencha/ajuste a aba CADASTRO e envie o arquivo na aba Madeireiras do site (Ver o que vai mudar → Aplicar). A chave é o CNPJ; nada é apagado." });
  inst.addRow({});
  for (const c of COLUNAS_CADASTRO) {
    const row = inst.addRow({ c: c.titulo, g: c.grupo, o: c.obrigatoria ? "Sim" : "", p: c.opcoes?.join(" · ") ?? "", a: c.ajuda });
    row.alignment = { wrapText: true, vertical: "top" };
  }

  await wb.xlsx.writeFile(saida);
  console.log(`${empresas.length} empresas -> ${saida}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
