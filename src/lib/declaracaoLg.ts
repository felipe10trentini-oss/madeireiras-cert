// Declaração de tratamento da LG Logística: uma por nota fiscal de venda. O cliente e os lotes
// (com a quantidade) vêm da nota; o tratamento de cada lote vem da planilha DR (aba DADOS).
// Regras tiradas das declarações que a LG já emitia (pasta "Declarações" de out/2026).
import { localDoEndereco } from "./certificado";
import { dadosIniciais, type DadosDeclaracao, type LinhaTratamento } from "./declaracao";
import type { Madeireira } from "./madeireiras";
import type { ItemNota, NotaFiscal } from "./notaFiscal";
import type { LinhaDR } from "./planilhaDR";

export const CNPJ_LG = "50709371000115";

export interface DeclaracaoMontada {
  dados: DadosDeclaracao;
  avisos: string[];
  arquivo: string;
}

const formatar = (n: number) => n.toLocaleString("pt-BR");

/** "PALLET MADEIRA 980X1170X135MM ME PLES02" -> "PALETES DE MADEIRA/ WOODEN PALLETS (980X1170X135MM ME PLES02)". */
export function descreverItem(it: ItemNota, quantidade = it.quantidade): string {
  const d = it.descricao.replace(/\s+/g, " ").trim();
  const resto = (re: RegExp) => d.replace(re, "").replace(/^[\s-]+|[\s-]+$/g, "");
  if (/^TAMPA/i.test(d)) {
    const r = resto(/^TAMPAS?(?:\s+DE)?(?:\s+MADEIRA)?/i);
    return `${formatar(quantidade)} TAMPAS DE MADEIRA/ WOODEN LIDS${r ? ` (${r})` : ""}`;
  }
  if (/^(PALLET|PALETE|PALETTE)/i.test(d)) {
    const r = resto(/^(?:PALLETS?|PALETES?|PALETTES?)(?:\s+DE)?(?:\s+(?:MADEIRA|MAD\.?|EUCALIPTO|PINUS))?/i);
    return `${formatar(quantidade)} PALETES DE MADEIRA/ WOODEN PALLETS${r ? ` (${r})` : ""}`;
  }
  return `${formatar(quantidade)} ${d}`;
}

/**
 * Itens tratados: os que batem com as quantidades dos lotes (a nota da Seara tem 3 itens, mas só
 * 250 + 100 estão nos lotes; a da Pisoforte tem 2 itens de 264 e um lote de 264). Sem par, todos.
 */
function itensTratados(itens: ItemNota[], qtdLotes: number[]): { itens: ItemNota[]; casou: boolean } {
  const total = itens.reduce((a, i) => a + i.quantidade, 0);
  const somaLotes = qtdLotes.reduce((a, b) => a + b, 0);
  if (!qtdLotes.length || total === somaLotes) return { itens, casou: true };
  const usados = new Set<number>();
  const escolhidos: ItemNota[] = [];
  for (const q of qtdLotes) {
    const i = itens.findIndex((it, j) => !usados.has(j) && it.quantidade === q);
    if (i < 0) break;
    usados.add(i);
    escolhidos.push(itens[i]);
  }
  if (escolhidos.length === qtdLotes.length) return { itens: escolhidos, casou: true };
  // Um item só com a soma dos lotes (vários lotes num item).
  const um = itens.find((it) => it.quantidade === somaLotes);
  if (um) return { itens: [um], casou: true };
  return { itens, casou: false };
}

const primeiraPalavra = (razao: string) =>
  razao
    .replace(/\b(S\.?\/?A\.?|LTDA\.?|EIRELI|ME|EPP)\b/gi, " ")
    .trim()
    .split(/\s+/)[0]
    ?.toUpperCase() ?? "";

/** Nome no padrão da pasta: "DECL. BRF CHAPECO NFE 6302.docx" (filial leva a cidade). */
export function nomeArquivoLg(nf: NotaFiscal): string {
  const filial = !/\/0001-/.test(nf.destinatario.cnpj ?? "/0001-");
  const cidade = filial && nf.destinatario.municipio ? ` ${nf.destinatario.municipio.toUpperCase()}` : "";
  return `DECL. ${primeiraPalavra(nf.destinatario.razao ?? "CLIENTE")}${cidade} NFE ${nf.numero ?? ""}`.replace(/[\\/:*?"<>|]/g, "-").trim() + ".pdf";
}

export function montarDeclaracaoLg(nf: NotaFiscal, dr: Map<string, LinhaDR> | null, empresa: Madeireira | null, hoje: string): DeclaracaoMontada {
  const avisos: string[] = [];
  const base = dadosIniciais([], empresa, hoje);

  // Lotes da observação (o mesmo lote em dois pedidos soma).
  const porLote = new Map<string, number | null>();
  for (const l of nf.lotes) {
    const atual = porLote.get(l.lote);
    porLote.set(l.lote, l.quantidade == null ? (atual ?? null) : (atual ?? 0) + l.quantidade);
  }
  if (!porLote.size) avisos.push("Não achei o lote na observação da nota (ex.: “600 UN LOTE/UR 715”): preencha a linha do tratamento.");

  const linhas: LinhaTratamento[] = [];
  const meses = new Set<string>();
  for (const [lote, qtd] of porLote) {
    const t = dr?.get(lote);
    if (!t) avisos.push(dr ? `Lote ${lote} não está na DR: confira a planilha ou preencha à mão.` : `Envie a DR para preencher o tratamento do lote ${lote}.`);
    if (t?.dataInicio) meses.add(t.dataInicio.slice(3));
    if (t && !t.horaInicio) avisos.push(`Lote ${lote}: a DR está sem o horário de início.`);
    linhas.push({
      certificado: t?.certificado ?? "",
      ciclo: t?.ciclo ?? lote,
      lote,
      inicio: t ? `${t.dataInicio} ${t.horaInicio}`.trim() : "",
      fim: t ? `${t.dataFim} ${t.horaFim}`.trim() : "",
      tipo: /KD/i.test(t?.tipo ?? "") ? "KD" : "HT",
      temperatura: t?.temperatura || "56",
      duracao: t?.duracao ? (/^\d+$/.test(t.duracao) ? `${t.duracao} min` : t.duracao) : "",
      quantidade: qtd != null ? formatar(qtd) : "",
    });
  }

  // Para casar com os itens vale a quantidade de cada pedido ("250 UN LOTE/UR 715, … 100 UN LOTE/UR 715").
  const qtdLotes = nf.lotes.map((l) => l.quantidade).filter((q): q is number => q != null);
  const { itens, casou } = itensTratados(nf.itens, qtdLotes);
  const totalItens = itens.reduce((a, i) => a + i.quantidade, 0);
  const somaLotes = qtdLotes.reduce((a, b) => a + b, 0);
  if (!casou && qtdLotes.length) avisos.push(`A nota tem ${formatar(totalItens)} unidades nos itens e ${formatar(somaLotes)} nos lotes: confira a quantidade.`);
  if (!nf.itens.length) avisos.push("Não li os itens da nota: preencha a quantidade.");
  if (casou && itens.length < nf.itens.length)
    avisos.push(`Entraram só os itens que batem com os lotes (${formatar(totalItens)} de ${formatar(nf.itens.reduce((a, i) => a + i.quantidade, 0))} unidades da nota): confira.`);
  // Um item só: a quantidade é a dos lotes (o restante da nota não foi tratado).
  const volumes =
    itens.length === 1 && qtdLotes.length && somaLotes !== itens[0].quantidade && casou
      ? descreverItem(itens[0], somaLotes)
      : itens.map((i) => descreverItem(i)).join("\n");

  const d = nf.destinatario;
  const cidadeUf = [d.municipio, d.uf].filter(Boolean).join(" - ");
  return {
    dados: {
      ...base,
      exportador: [d.razao, d.cnpj ? `CNPJ ${d.cnpj}` : ""].filter(Boolean).join(" – "),
      enderecoExportador: [d.endereco, cidadeUf].filter(Boolean).join(" – "),
      destinatario: "Nihil",
      volumes,
      produto: "Madeira de eucalipto / Eucalyptus wood",
      origem: "Brasil / Brazil",
      destino: "Nihil",
      comunicado: [...meses].sort((a, b) => a.slice(3).localeCompare(b.slice(3)) || a.localeCompare(b)).map((m) => `Programação MAPA ${m}`).join("; "),
      localTratamento: "Linha Barra Seca S/N – CEP 89.728-000 – Concórdia - SC",
      sujeito: itens.every((i) => /^(PALLET|PALETE)/i.test(i.descricao)) ? "paletes" : "material",
      linhas,
      observacao: nf.numero ? `Ref. à NF-e ${nf.numero}` : "",
      localEmissao: (localDoEndereco(empresa?.endereco) || "Concórdia - SC").replace(/^Concordia/i, "Concórdia"),
    },
    avisos,
    arquivo: nomeArquivoLg(nf),
  };
}

/** Declaração da LG em branco (manual): os campos fixos da LG já preenchidos. */
export function manualLg(empresa: Madeireira | null, hoje: string): DadosDeclaracao {
  return {
    ...dadosIniciais([], empresa, hoje),
    exportador: "",
    destinatario: "Nihil",
    produto: "Madeira de eucalipto / Eucalyptus wood",
    origem: "Brasil / Brazil",
    destino: "Nihil",
    localTratamento: "Linha Barra Seca S/N – CEP 89.728-000 – Concórdia - SC",
    sujeito: "paletes",
    linhas: [{ certificado: "", ciclo: "", lote: "", inicio: "", fim: "", tipo: "HT", temperatura: "56", duracao: "32 min", quantidade: "" }],
    localEmissao: (localDoEndereco(empresa?.endereco) || "Concórdia - SC").replace(/^Concordia/i, "Concórdia"),
  };
}
