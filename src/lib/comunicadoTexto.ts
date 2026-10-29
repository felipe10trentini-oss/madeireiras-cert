// Interpreta o pedido do cliente (mensagem do WhatsApp, e-mail, Word, planilha, print) para o comunicado
// de tratamento: separa os tratamentos, acha tomador, data, horário, itens/quantidade e volume. O estilo
// segue o último comunicado da empresa (o modelo): se lá a quantidade é só o número, sai só o número; se é
// "30,0 m³", sai em m³; o produto fica o do modelo quando é o mesmo tipo de item. O que não vier no texto
// fica como no modelo, e o operador confere.
import type { CampoComunicado } from "./comunicadoModelo";
import type { Tomador } from "./relatorio";
import { snMinusculo, soDigitos } from "./util";

export interface Interpretado {
  valores: Partial<Record<CampoComunicado, string>>;
  /** Campos achados no texto (os outros ficam como no modelo). */
  achados: CampoComunicado[];
  avisos: string[];
}

export interface OpcoesPedido {
  /** Cadastro de terceiros da empresa (e a própria empresa). */
  tomadores: Tomador[];
  /** Trata no cliente (Mann móvel, ALR): o local é o do tomador. */
  prestadora: boolean;
  /** Credenciada: sem tomador no texto, o tomador é a própria empresa. */
  credenciada?: boolean;
  empresa?: { razaoSocial: string; cnpj: string };
  hoje?: Date;
  /** Valores do último comunicado (o modelo). */
  modelo: Partial<Record<CampoComunicado, string>>;
  /** Comunicados emitidos antes (data e horário), para "três amanhã, mesmos horários". */
  historico?: { data: string; horario: string }[];
  /** Horários de sempre, quando ainda não há histórico (DM: 07h, 11h e 15h). */
  horariosPadrao?: string[];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/** Itens de madeira que aparecem no texto, com a forma que vai no "Produto a ser tratado". */
const ITENS: { re: RegExp; produto: string; plural: string }[] = [
  { re: /kits?\s+(?:de\s+)?caixas?/i, produto: "Kit caixas", plural: "kit caixas" },
  { re: /kits?\s+(?:de\s+)?embalage\w*/i, produto: "Kit embalagens", plural: "kit embalagens" },
  { re: /kits?\s+(?:de\s+)?engradados?|engradados?\s+em\s+kits?/i, produto: "Kit engradados", plural: "kit engradados" },
  { re: /kits?/i, produto: "Kit caixas", plural: "kits" },
  { re: /pal+et+e?s?|pal+ets?/i, produto: "Paletes", plural: "paletes" },
  { re: /engradados?/i, produto: "Engradados", plural: "engradados" },
  { re: /caixas?/i, produto: "Caixas", plural: "caixas" },
  { re: /skids?|suportes?/i, produto: "Suportes", plural: "suportes" },
  { re: /t[áa]buas?|ripas?|sarrafos?/i, produto: "Tábuas", plural: "tábuas" },
  { re: /tampas?/i, produto: "Tampas", plural: "tampas" },
  { re: /cavaletes?/i, produto: "Cavaletes", plural: "cavaletes" },
  { re: /bobinas?|carret[ée]is/i, produto: "Bobinas", plural: "bobinas" },
  { re: /caibros?/i, produto: "Caibros", plural: "caibros" },
  { re: /grades?|fardos?/i, produto: "Madeira serrada", plural: "fardos" },
];

type Item = { qtd: string; item: (typeof ITENS)[number]; medida: string };

/**
 * Quadro com um item por coluna (TLP: "CLIENTE | CAIXA | ENG | PALLET | TÁBUAS | CAIBROS" e a linha "TOTAL"):
 * vira "28 kit caixas" / "5 paletes" — pela linha TOTAL, ou somando as linhas dos clientes. Null se não for esse quadro.
 */
function quadroDeItens(linhas: string[]): { inicio: number; fim: number; frases: string[] } | null {
  const nomeColuna = (c: string) => {
    const t = semAcento(c).toLowerCase().trim();
    if (/^eng(?:radados?)?\.?$/.test(t)) return "engradados";
    // No quadro da TLP, a coluna CAIXA é kit caixas (confirmado em 29/10/2026).
    if (/^caixas?$/.test(t)) return "kit caixas";
    const item = ITENS.find((i) => new RegExp(`^(?:${i.re.source})$`, "i").test(t));
    return item ? t : null;
  };
  const iCab = linhas.findIndex((l) => l.includes("|") && l.split("|").filter((c) => nomeColuna(c)).length >= 2);
  if (iCab < 0) return null;
  const cab = linhas[iCab].split("|").map((c) => nomeColuna(c));
  let fim = iCab + 1;
  while (fim < linhas.length && linhas[fim].includes("|")) fim++;
  const corpo = linhas.slice(iCab + 1, fim).map((l) => l.split("|").map((c) => c.trim()));
  const total = corpo.find((c) => /^total\b/i.test(c[0] ?? ""));
  const num = (s: string | undefined) => +(s ?? "").replace(/\D/g, "") || 0;
  const frases: string[] = [];
  cab.forEach((nome, j) => {
    if (!nome) return;
    const q = total ? num(total[j]) : corpo.reduce((s, c) => s + num(c[j]), 0);
    if (q > 0) frases.push(`${q} ${nome}`);
  });
  return frases.length ? { inicio: iCab, fim, frases } : null;
}

/** "50 kit caixas (1000x1200x680mm)", "300 paletes 1000x1200", "352 - PALLETS", "40-Engradados em kits". */
function itensDoTexto(texto: string): Item[] {
  const out: Item[] = [];
  const nomes = ITENS.map((i) => i.re.source).join("|");
  const re = new RegExp(
    `(?<![\\d.,/])(\\d{1,3}(?:\\.\\d{3})+|\\d+)\\s*-?\\s*(?:un(?:idades?|d\\.?)?\\s*(?:de\\s+)?)?(${nomes})(?:\\s+de\\s+madeiras?)?\\s*(\\(?\\s*\\d{2,4}\\s*[xX×]\\s*\\d{2,4}(?:\\s*[xX×]\\s*\\d{2,4})?\\s*(?:mm|cm)?\\s*\\)?)?`,
    "gi"
  );
  for (const m of texto.matchAll(re)) {
    const item = ITENS.find((i) => new RegExp(`^(?:${i.re.source})$`, "i").test(m[2].trim())) ?? ITENS.find((i) => i.re.test(m[2]))!;
    const medida = (m[3] ?? "").replace(/[()\s]/g, "").replace(/×/g, "x").toLowerCase();
    out.push({ qtd: m[1], item, medida: medida && !/mm|cm$/.test(medida) ? `${medida}mm` : medida });
  }
  return out;
}

/** Quantidade sem item: "Quantidade 300", "Quantidade: 720", "450 unidades", "2 de 413" (413). */
function qtdSolta(t: string): string | null {
  const m =
    t.match(/\bquantidade\s*:?\s*(\d[\d.]*)/i) ??
    t.match(/(?<![\d.,])(\d[\d.]*)\s*(?:unidades|unid\.?|und\.?|pe[çc]as|p[çc]s)\b/i) ??
    t.match(/^\s*\d{1,2}\s+de\s+(\d[\d.]*)\s*$/im);
  return m ? m[1].replace(/\./g, "") : null;
}

/** Volume em m³: "85,000m³", "30 m cubicos", "48m3", "48m pinus", "Total de 21.86 m3". */
function volumeDoTexto(t: string): string | null {
  const m =
    t.match(/\btotal\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:m3|m³|m\s*c[uú]bicos?)/i) ??
    t.match(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:m3|m³|m\s*c[uú]bicos?|metros?\s*c[uú]bicos?|m(?=\s+(?:de\s+)?(?:pinus|eucalipto|madeira)))/i);
  return m ? m[1] : null;
}

const NUM_POR_EXTENSO: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8 };
const DIAS_SEMANA = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
const fmtData = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

/** Data do texto: "27/10", "27/10/2026", "19.08.26", "dia 27", "segunda", "amanhã", "hoje". */
function dataDoTexto(t: string, hoje: Date): string | null {
  // "dd/mm(/aa)"; com ponto ou hífen só com o ano ("19.08.26"), para não pegar "1.500" ou "352-PALLETS".
  // Vírgula colada ("24/09," / ",19.08.26") vale; "85,000" ou "1.500" não.
  for (const m of t.matchAll(/(?<!\d)(?<!\d[.,/])(\d{1,2})(?:\/(\d{1,2})(?:\/(\d{2,4}))?|([.-])(\d{1,2})\4(\d{2,4}))(?!\d|[.,/]\d)/g)) {
    const dia = +m[1];
    const mes = +(m[2] ?? m[5]);
    const a = m[3] ?? m[6];
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    const ano = a ? (a.length === 2 ? 2000 + +a : +a) : hoje.getFullYear();
    return `${pad2(dia)}/${pad2(mes)}/${ano}`;
  }
  const rel = semAcento(t).toLowerCase();
  // "dia 27" (sem mês; não o "Bom dia" nem "dia 2º"): este mês, ou o próximo se o dia já passou há mais
  // de alguns dias (mensagem lida com atraso continua no mês).
  const dia = rel.match(/(?<!\bbom\s)\bdia\s+(\d{1,2})(?![\dº°ª]|\s*[/.:h]|\s*(?:o|a)\s)/);
  if (dia && +dia[1] >= 1 && +dia[1] <= 31) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), +dia[1]);
    if (hoje.getDate() - +dia[1] > 3) d.setMonth(d.getMonth() + 1);
    return fmtData(d);
  }
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (/\bamanha\b/.test(rel)) {
    d.setDate(d.getDate() + 1);
    return fmtData(d);
  }
  if (/\bhoje\b/.test(rel)) return fmtData(d);
  // "segunda", "segunda-feira", "domingo": o próximo dia com esse nome.
  const ds = rel.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[-\s]feira)?\b/);
  if (ds) {
    const alvo = DIAS_SEMANA.indexOf(ds[1]);
    let n = (alvo - d.getDay() + 7) % 7;
    if (n === 0) n = 7;
    d.setDate(d.getDate() + n);
    return fmtData(d);
  }
  return null;
}

const SEM_DATAS = (t: string) => t.replace(/(?<!\d)(?<!\d[.,/])\d{1,2}(?:\/\d{1,2}(?:\/\d{2,4})?|([.-])\d{1,2}\1\d{2,4})(?!\d|[.,/]\d)/g, " ");

/** Horários: "13:30", "13h30", "9h00", "7 horas", "9hs", "19hs", "9hrs", "8,30 horas", "07:00hs" -> "07h00m". */
function horasDoTexto(t: string): string[] {
  const out: string[] = [];
  const re = /(?<![\d.,/])(\d{1,2})(?:\s*[:h]\s*(\d{2})(?!\d)|[,.](\d{2})\s*(?=h)|\s*(?=(?:hs|hrs?|horas?|h)\b))\s*(?:hs|hrs?|horas?|h|m(?:in)?)?\b/gi;
  for (const m of SEM_DATAS(t).matchAll(re)) {
    const h = +m[1];
    const min = m[2] ?? m[3] ?? "00";
    if (h > 23 || +min > 59) continue;
    out.push(`${pad2(h)}h${min}m`);
  }
  return out;
}
const horaDoTexto = (t: string) => horasDoTexto(t)[0] ?? null;

/**
 * Tabela (planilha ou Word: células com " | "): pela linha de títulos (quantidade/qtd, produto/material/
 * descrição, medida), cada linha vira uma frase como a da mensagem ("300 Paletes 1000x1200 | 27/10/2026").
 */
function tabelaEmFrases(texto: string): { texto: string; itensTabela: string[] } {
  const linhas = texto.split("\n");
  const itensTabela: string[] = [];
  const quadro = quadroDeItens(linhas);
  if (quadro) return { texto: [...linhas.slice(0, quadro.inicio), quadro.frases.join(" e "), ...linhas.slice(quadro.fim)].join("\n"), itensTabela };
  const iCab = linhas.findIndex((l) => l.includes("|") && /quant|qtd|qtde/i.test(l) && /produto|material|mercadoria|descri|item|embalage/i.test(l));
  if (iCab < 0) return { texto, itensTabela };
  const cab = linhas[iCab].split("|").map((c) => semAcento(c).toLowerCase().trim());
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
  const cQtd = col(/quant|qtd|qtde/);
  const cProd = col(/produto|material|mercadoria|descri|item|embalage/);
  const cMed = col(/medida|dimens|tamanho|bitola/);
  const frases: string[] = [];
  for (const l of linhas.slice(iCab + 1)) {
    if (!l.includes("|")) continue;
    const c = l.split("|").map((x) => x.trim());
    const qtd = c[cQtd]?.match(/\d[\d.,]*/)?.[0];
    if (!qtd || !c[cProd]) continue;
    const item = `${qtd.replace(/[.,]0+$/, "")} ${c[cProd]}${cMed >= 0 && c[cMed] ? ` ${c[cMed]}` : ""}`;
    itensTabela.push(item);
    frases.push(`${item} | ${c.filter((_, i) => i !== cQtd && i !== cProd && i !== cMed).join(" | ")}`);
  }
  return { texto: [...linhas.slice(0, iCab), ...frases].join("\n"), itensTabela };
}

/**
 * Separa o pedido em tratamentos (um comunicado cada), linha a linha: uma linha com data quando o bloco atual
 * já tem data ou horário, ou com horário quando o bloco já tem horário, começa outro tratamento ("30/10/26 ↵
 * 19hs ↵ 82 kits ↵ 31/10/26 ↵ 03hs…", "352 - PALLETS (AS 9HS) ↵ 352 - PALLETS (14HS)", uma linha por cliente
 * na Madeval). Lista numerada ("1º Tratamento - 07:00") também separa. As linhas sem dado antes do primeiro
 * tratamento (saudação, "Tomador Embafort") valem para todos, e a data passa para os seguintes.
 */
export function separarPedidos(texto: string): string[] {
  // Vários arquivos soltos juntos (os Word da Madepallete): cada arquivo é um pedido.
  const porArquivo = texto.split(/\n?^-{3,} próximo arquivo -{3,}$\n?/m).filter((p) => p.trim());
  if (porArquivo.length > 1) return porArquivo.flatMap(separarPedidos);
  const { texto: t } = tabelaEmFrases(texto.replace(/\r/g, ""));
  const linhas = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const numerado = (l: string) => /^(?:\d{1,2}\s*[)º°ª.-]\s+|(?:comunicado|pedido|tratamento|carga)\s*(?:n[º°o.]*\s*)?\d{1,2}\b)/i.test(l);

  type Bloco = { linhas: string[]; data: boolean; hora: boolean };
  const blocos: Bloco[] = [];
  let cur: Bloco = { linhas: [], data: false, hora: false };
  const contexto: string[] = [];
  const hoje = new Date();
  for (const l of linhas) {
    const temData = !!dataDoTexto(l, hoje) && !/^\s*(?:hoje|amanh[ãa])\b.*\b(?:hoje|amanh[ãa])\b/i.test(l);
    const temHora = horasDoTexto(l).length > 0;
    const nova = (temData && (cur.data || cur.hora)) || (temHora && cur.hora) || (numerado(l) && (cur.data || cur.hora) && cur.hora);
    if (nova) {
      blocos.push(cur);
      cur = { linhas: [], data: false, hora: false };
    }
    // Linhas sem dado antes do 1º tratamento: contexto de todos.
    if (!blocos.length && !temData && !temHora && !cur.data && !cur.hora && !itensDoTexto(l).length && !qtdSolta(l) && !volumeDoTexto(l)) {
      contexto.push(l);
      continue;
    }
    cur.linhas.push(l);
    cur.data ||= temData;
    cur.hora ||= temHora;
  }
  blocos.push(cur);
  const validos = blocos.filter((b) => b.linhas.length);
  if (validos.length < 2) return [texto];
  return validos.map((b) => [...contexto, ...b.linhas].join("\n"));
}

/** Tomador escrito no estilo do modelo ("X - CNPJ: 00…", "X; CNPJ 00…"). */
function tomadorNoEstilo(razao: string, cnpj: string, modelo: string | undefined): string {
  const sep = (modelo ?? "").match(/^.*?(\s*[-–;,:]?\s*CNPJ\s*:?\s*)\d/i)?.[1];
  return `${razao}${sep ?? " - CNPJ: "}${fmtCnpj(soDigitos(cnpj))}`;
}

const GENERICAS = new Set(
  "LTDA ME EIRELI SA EPP IND COM CIA E DE DO DA DOS DAS INDUSTRIA COMERCIO MADEIRA MADEIRAS MADEIREIRA EMBALAGEM EMBALAGENS PALLET PALLETS PALETE PALETES PALLETE ARTEFATOS TRANSPORTES SOLUCOES EMPRESARIAIS EXPORTACAO IMPORTACAO LIMITADA AMANHA HOJE AGENDA AGENDAR TRATAMENTO HORAS".split(" ")
);

function acharTomador(t: string, op: OpcoesPedido): { tom: Tomador | null; cnpj: string | null; nome: string | null } {
  const plano = t.replace(/\s+/g, " ");
  const chave = (s: string) => semAcento(s).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  // "62.468.466/0001-73", "13428397/0001-69" e até "62.468.466.0001-73" (ponto no lugar da barra).
  const cnpjs = [...plano.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\s*[/.]?\s*\d{4}\s*-?\s*\d{2}\b/g)].map((m) => soDigitos(m[0]));
  const porCnpj = op.tomadores.find((x) => cnpjs.includes(soDigitos(x.cnpj)));
  if (porCnpj) return { tom: porCnpj, cnpj: soDigitos(porCnpj.cnpj), nome: null };
  const palavras = (s: string) => chave(s).split(" ").filter((p) => p.length >= 3 && !GENERICAS.has(p) && !/^\d+$/.test(p));
  const casa = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
  // "Tomador Embafort", "Contratante: ML Madeiras…", "EMPRESA: TLP EMBALAGENS": o terceiro com essas palavras.
  const rotulo = t.match(/(?:^|\n)\s*(?:empresa|tomador(?:\s+de\s+servi[çc]o)?|contratante|cliente)\s*[:-]?\s*\|?\s*([^|\n]+)/i)?.[1]?.replace(/\bCNPJ.*$/i, "").trim();
  if (rotulo) {
    const ps = palavras(rotulo);
    const cands = op.tomadores.filter((x) => {
      const nome = palavras(x.razao);
      return ps.length > 0 && ps.every((p) => nome.some((n) => casa(p, n)));
    });
    if (cands.length === 1) return { tom: cands[0], cnpj: soDigitos(cands[0].cnpj), nome: null };
  }
  // Nome no meio do texto ("pallets flamingos", "Select pack", "Elisangela barbosa"): o terceiro com mais
  // palavras próprias (sem as genéricas: madeiras, pallets, ltda…) no texto; empate não chuta.
  const doTexto = new Set(palavras(plano));
  const notas = op.tomadores
    .map((x) => ({ x, n: palavras(x.razao).filter((p) => [...doTexto].some((q) => p === q || (casa(p, q) && Math.min(p.length, q.length) >= 4))).length }))
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n);
  if (notas.length && (notas.length === 1 || notas[0].n > notas[1].n)) return { tom: notas[0].x, cnpj: soDigitos(notas[0].x.cnpj), nome: null };
  if (cnpjs.length) {
    const nome =
      rotulo ||
      t
        .split("\n")
        .find((l) => /\b(ltda|s\/?a|eireli|me|epp)\b/i.test(l))
        ?.replace(/cnpj.*$/i, "")
        .replace(/[-–:;,]+\s*$/, "")
        .trim() ||
      null;
    return { tom: null, cnpj: cnpjs[0], nome };
  }
  return { tom: null, cnpj: null, nome: null };
}

/** Número com vírgula e as casas decimais do modelo ("30" + modelo "30,0 m³" -> "30,0"). */
function numeroNoEstilo(v: string, modelo: string | undefined): string {
  const casas = (modelo ?? "").match(/\d+,(\d+)/)?.[1]?.length;
  const n = parseFloat(v.replace(",", "."));
  if (!Number.isFinite(n)) return v;
  if (casas != null) return n.toFixed(casas).replace(".", ",");
  return v.replace(".", ",");
}

/** Interpreta um tratamento (um bloco do pedido). */
export function interpretarTexto(texto: string, op: OpcoesPedido): Interpretado {
  const tab = tabelaEmFrases(texto.replace(/\r/g, ""));
  const t = tab.texto;
  const plano = t.replace(/\s+/g, " ");
  const m = op.modelo;
  const v: Partial<Record<CampoComunicado, string>> = {};
  const achados: CampoComunicado[] = [];
  const avisos: string[] = [];
  const marcar = (c: CampoComunicado, valor: string | null | undefined) => {
    if (!valor) return;
    v[c] = valor;
    achados.push(c);
  };

  // Tomador. O mesmo do último comunicado (pelo CNPJ) fica escrito como lá, com o mesmo local.
  const cnpjModelo = soDigitos((m.tomador ?? "").match(/\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2}/)?.[0] ?? "");
  const { tom, cnpj, nome } = acharTomador(t, op);
  if (cnpj && cnpj === cnpjModelo) {
    marcar("tomador", m.tomador);
    if (m.local) marcar("local", m.local);
  } else if (tom) {
    marcar("tomador", tomadorNoEstilo(tom.razao, tom.cnpj, m.tomador));
    // Prestadora (trata no cliente): o local é o do cliente.
    if (op.prestadora && tom.endereco) marcar("local", snMinusculo(tom.endereco));
  } else if (cnpj) {
    marcar("tomador", tomadorNoEstilo(nome || "?", cnpj, m.tomador));
    avisos.push("O tomador do CNPJ do texto não está no Cadastro de terceiros: confira o nome e cadastre-o para os próximos.");
  } else if (op.credenciada && op.empresa) {
    // Credenciada sem tomador no texto: a própria empresa (como estava, se o último já era ela).
    const proprio = soDigitos(op.empresa.cnpj);
    if (cnpjModelo === proprio) v.tomador = m.tomador;
    else {
      v.tomador = tomadorNoEstilo(op.empresa.razaoSocial, op.empresa.cnpj, m.tomador);
      if (op.prestadora) avisos.push("Sem tomador no texto: ficou a própria empresa — confira o local.");
    }
  }

  // Local explícito ("local: …", "endereço: …"), se não veio do tomador do último comunicado.
  const local = t.match(/(?:local(?: do tratamento)?|endere[çc]o)\s*:\s*(.+)/i)?.[1]?.trim();
  if (local && !(cnpj && cnpj === cnpjModelo)) marcar("local", snMinusculo(local));

  const hoje = op.hoje ?? new Date();
  marcar("data", dataDoTexto(plano, hoje));
  marcar("horario", horaDoTexto(plano));

  // Quantidade e produto, no estilo do último comunicado.
  const emM3 = /m³|m3/i.test(m.volumes ?? "") || /m³|m3/i.test(m.quantidade ?? "");
  const volume = volumeDoTexto(plano);
  const itens = itensDoTexto(plano);
  const especie = plano.match(/\b(pinus|eucalipto|pinho|tropical)\b/i)?.[1]?.toLowerCase();
  const espessura = SEM_DATAS(plano).match(/(?<![\dxX×])(\d{1,3})\s*mm\b(?!\s*[xX×])/)?.[1];
  if (volume && emM3) {
    const vol = numeroNoEstilo(volume, m.quantidade);
    const fardos = itens.find((i) => i.item.plural === "fardos");
    const comContagem = (m.quantidade ?? "").match(/^\s*\d+\s+(\S+)\s*-\s*[\d.,]+\s*m[³3]/i);
    if (comContagem && fardos) marcar("quantidade", `${fardos.qtd} ${comContagem[1]} - ${vol} m³`);
    else if (/m[³3]/i.test(m.quantidade ?? "")) marcar("quantidade", `${vol} m³`);
    else marcar("quantidade", vol);
    // "Madeira serrada de pinus 18 mm": troca a espécie (e a espessura) do produto do modelo.
    const pm = m.produto ?? "";
    if (especie && /^madeira serrada de \w+/i.test(pm)) {
      let p = pm.replace(/^(madeira serrada de )\w+/i, `$1${especie}`);
      if (espessura) p = /\d+\s*mm/i.test(p) ? p.replace(/\d+\s*mm/i, `${espessura} mm`) : `${p} ${espessura} mm`;
      marcar("produto", p);
    } else if (especie && !pm) marcar("produto", `Madeira serrada de ${especie}`);
  } else if (volume && !itens.length) {
    marcar("quantidade", `${volume.replace(".", ",")} m³`);
    if (especie) marcar("produto", `Madeira serrada de ${especie}`);
  } else if (itens.filter((i) => i.item.plural !== "fardos").length) {
    const ii = itens.filter((i) => i.item.plural !== "fardos");
    const um = ii.length === 1;
    // Só o número quando o último comunicado era só o número ("720"); senão com o item ("600 paletes").
    const soNumero = um && !ii[0].medida && /^\s*\d[\d.]*\s*$/.test(m.quantidade ?? "");
    marcar("quantidade", ii.map((i) => (soNumero ? i.qtd : `${i.qtd} ${i.item.plural}${i.medida ? ` (${i.medida})` : ""}`)).join("\n"));
    // "Kit caixas e palete de madeira", "Paletes de madeira". Mesmo tipo do modelo: fica o do modelo
    // ("82 kits" na Pallet do Brasil = "Kit embalagens de madeira").
    const nomes = [...new Set(ii.map((i) => i.item.produto))];
    const tipo = (s: string) => semAcento(s).toLowerCase().split(/\s+/)[0].replace(/s$/, "");
    if (nomes.length === 1 && m.produto && tipo(m.produto) === tipo(nomes[0])) marcar("produto", m.produto);
    else
      marcar(
        "produto",
        nomes.length === 1
          ? `${nomes[0]} de madeira`
          : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1].toLowerCase().replace(/s$/, "")} de madeira`
      );
  } else if (tab.itensTabela.length) {
    // Tabela com um item que não é palete/caixa/kit…: vai como veio ("300 PBR").
    marcar("quantidade", tab.itensTabela.join("\n"));
  } else {
    marcar("quantidade", qtdSolta(t));
  }

  // Aviso da Mann/Exata ("aviso 1764/2026", "AV 1764") e unidade volante ("unidade 3").
  // Sufixo só em maiúsculas e colado ("-AH", "-AMH", "-C"): "1770/2026 - Gelprime" não é sufixo.
  const av = plano.match(/\baviso\s*(?:n[º°o.]*\s*)?(\d{1,5}\s*\/\s*\d{4})/i);
  const sufixo = av ? plano.slice(av.index! + av[0].length).match(/^-(A[CHMQU]{0,3}|C)\b/)?.[1] : null;
  marcar("aviso", av ? `${av[1].replace(/\s+/g, "")}${sufixo ? `-${sufixo}` : ""}` : null);
  const unidade = plano.match(/\bunidade\s*(?:volante\s*)?(?:n[º°o.]*\s*)?(\d{1,2})\b/i)?.[1];
  if (unidade) marcar("unidade", `Unidade ${+unidade}`);

  const temp = plano.match(/\b(\d{2})\s*°\s*C\b/)?.[1];
  if (temp) marcar("temperatura", `${temp}°C`);
  const destino = t.match(/destino\s*:\s*(.+)/i)?.[1]?.trim();
  if (destino) marcar("destino", destino);

  if (!achados.includes("tomador") && op.prestadora && !v.tomador) avisos.push("Não achei o tomador no texto: escolha o cliente ou digite o CNPJ.");
  if (!achados.includes("data")) {
    // Sem data: amanhã (confirmado em 29/10/2026); o operador confere.
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1);
    v.data = fmtData(d);
    avisos.push(`Sem data no texto: ficou amanhã (${v.data}) — confira.`);
  }
  if (!achados.includes("horario")) avisos.push("Não achei o horário do início no texto: confira.");
  if (!achados.includes("quantidade")) avisos.push(`Sem quantidade no texto: ficou a do último comunicado (${m.quantidade || "—"}).`);
  return { valores: { ...m, ...v }, achados, avisos };
}

/**
 * O pedido inteiro: separa os tratamentos e interpreta cada um. A data passa para os seguintes; "2 de 413 ↵
 * 2:00 e 9:00" (Kaule) e "Três amanhã msm horários" (DM) viram um comunicado por horário.
 */
export function interpretarPedido(texto: string, op: OpcoesPedido): Interpretado[] {
  const blocos = separarPedidos(texto);
  const out: Interpretado[] = [];
  let data = "";
  for (const bloco of blocos) {
    const r = interpretarTexto(bloco, op);
    if (r.achados.includes("data")) data = r.valores.data!;
    else if (data) {
      r.valores.data = data;
      r.avisos = r.avisos.filter((a) => !/^Sem data/.test(a));
    }
    const plano = semAcento(bloco).toLowerCase();
    // Vários horários numa linha só ("2:00 e 9:00"): um comunicado por horário.
    const linhaHoras = bloco.split("\n").map((l) => horasDoTexto(l)).find((h) => h.length > 1);
    // "Três amanhã msm horários": N comunicados nos horários do último dia (ou os de sempre).
    const nPorExtenso = plano.match(/(?:^|\n)\s*(\d|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito)\b(?!\s*(?:de\s+\d|[/:.,h]|\d))/)?.[1];
    const mesmosHorarios = /\bm(?:esmos?|sm)\s+hor[aá]rios?\b/.test(plano);
    let horas: string[] | null = linhaHoras ?? null;
    if (!horas && mesmosHorarios && nPorExtenso) {
      const n = /^\d$/.test(nPorExtenso) ? +nPorExtenso : NUM_POR_EXTENSO[nPorExtenso];
      const ultimaData = [...(op.historico ?? [])].map((h) => h.data).sort((a, b) => a.split("/").reverse().join("").localeCompare(b.split("/").reverse().join(""))).pop();
      const doDia = (op.historico ?? []).filter((h) => h.data === ultimaData).map((h) => h.horario).sort();
      horas = doDia.length === n ? doDia : op.horariosPadrao?.length === n ? op.horariosPadrao : Array.from({ length: n }, () => r.valores.horario ?? "");
      if (doDia.length !== n && op.horariosPadrao?.length !== n) r.avisos.push("Não sei os horários do último dia: confira o horário de cada comunicado.");
      r.avisos = r.avisos.filter((a) => !/horário do início/.test(a));
      r.achados.push("horario");
    }
    if (horas && horas.length > 1) {
      // "2 de 413": a quantidade de cada um.
      for (const h of horas) out.push({ valores: { ...r.valores, horario: h }, achados: [...r.achados], avisos: [...r.avisos] });
    } else out.push(r);
  }
  return out;
}
