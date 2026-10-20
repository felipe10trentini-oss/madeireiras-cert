// Preenche o Word (.docx) de declaração que a empresa já usa, sem mexer no layout: troca só o
// texto depois de cada rótulo ("EXPORTADOR/SHIPPER: …"), as linhas da tabela do tratamento e a
// data do "LOCAL/PLACE". Formatação, timbre, imagens e assinatura ficam como no modelo.
// Roda no navegador e no Node (JSZip).
import JSZip from "jszip";
import {
  periodoTratamento,
  type DadosDeclaracao,
  type LinhaTratamento,
} from "./declaracao";

type Campo =
  | "exportador"
  | "importador"
  | "destinatario"
  | "master"
  | "ciclo"
  | "lote"
  | "navio"
  | "fatura"
  | "nfe"
  | "booking"
  | "bl"
  | "container"
  | "marcas"
  | "volumes"
  | "produto"
  | "pesoLiquido"
  | "pesoBruto"
  | "origem"
  | "destino"
  | "programacao"
  | "dataTratamento"
  | "duracao"
  | "localTratamento"
  | "observacao"
  | "localEmissao"
  | "fixo";

const S = "\\s*\\/\\s*";
// Rótulos das declarações das empresas. "fixo" = rótulo conhecido que não se preenche (só delimita).
const ROTULOS: [Campo, RegExp][] = [
  ["exportador", new RegExp(`Exportador${S}Shipper\\s*:`)],
  ["importador", new RegExp(`Importador${S}(?:Importer|Buyer)\\s*:`)],
  [
    "destinatario",
    new RegExp(
      `Destinat[áa]rio(?:\\s+e\\s+Notificar)?${S}Consignee(?:\\s+and\\s+Notify)?\\s*:`,
    ),
  ],
  ["master", /Master HT Certificate\s*:/],
  ["ciclo", new RegExp(`Ciclo de Tratamento${S}Treatment Cycle\\s*:`)],
  ["lote", new RegExp(`N[ºo°]?\\s*do lote${S}Lot number\\s*:`)],
  ["navio", new RegExp(`Navio${S}Vessel\\s*:`)],
  ["fatura", /\bFatura(?:\s*\/\s*Invoice)?\s*:|\bInvoice(?:\s*#)?\s*:/],
  ["nfe", /\bNF-?e\s*:|\bNf[’']s\s*:|\bNF\s*:/],
  ["booking", /\bBooking\s*:/],
  ["bl", /\bB\/L\s*:/],
  ["container", /\bContainer\s*:/],
  ["marcas", new RegExp(`Marcas?${S}Marks?\\s*:`)],
  ["volumes", new RegExp(`(?:Cubagem${S}Volume|Quantidade${S}Quantity)\\s*:`)],
  ["produto", new RegExp(`Natureza do produto${S}Kind of product\\s*:`)],
  [
    "fixo",
    new RegExp(`Descri[çc][ãa]o do produto${S}Product description\\s*:`),
  ],
  ["pesoLiquido", new RegExp(`Peso L[íi]quido${S}Net Weight\\s*:`)],
  ["pesoBruto", new RegExp(`Peso Bruto${S}Gross Weight\\s*:`)],
  ["origem", new RegExp(`Proced[êe]ncia${S}Origin\\s*:`)],
  ["destino", new RegExp(`Destino${S}Destination\\s*:`)],
  [
    "programacao",
    /Programa[çc][ãa]o MAPA\s*:|Comunicado de tratamento\s*\/\s*Treatment notice\s*:/,
  ],
  [
    "fixo",
    new RegExp(`(?:Transporte${S}Transport|Contratante${S}Contractor)\\s*:`),
  ],
  [
    "dataTratamento",
    new RegExp(`Data do tratamento${S}Time of treatment\\s*:`),
  ],
  [
    "duracao",
    new RegExp(`Dura[çc][ãa]o do tratamento${S}Duration of treatment\\s*:`),
  ],
  ["fixo", new RegExp(`Umidade[^:]{0,25}${S}[^:]{0,25}Moisture\\s*:`)],
  [
    "localTratamento",
    new RegExp(`Local d[eo] Tratamento${S}Place of Treatment\\s*:`),
  ],
  ["observacao", new RegExp(`Observa[çc][ãa]o(?:es)?${S}Remarks?\\s*:`)],
  ["localEmissao", new RegExp(`\\bLocal${S}Place\\s*:`)],
];

/** Campos que mudam a cada declaração (em branco = vazio, nunca o dado do modelo). */
export const VARIAVEIS = new Set<Campo>([
  "exportador", "importador", "master", "ciclo", "lote", "navio", "fatura", "nfe", "booking", "bl", "container", "marcas",
  "volumes", "pesoLiquido", "pesoBruto", "programacao", "dataTratamento", "observacao",
]);
/** Campos que continuam nos parágrafos seguintes do modelo (endereço do exportador, itens). */
const MULTILINHA = new Set<Campo>(["exportador", "volumes", "master"]);

/**
 * Certificado mestre no formato do modelo da empresa: a 1ª entrada do modelo vira o molde e cada
 * pedaço é trocado pelo dado do mestre, na mesma ordem e com as mesmas palavras.
 *   "Lote 972 - UR010972PR031026 - 200 paletes" (Paletes Maringá, uma por linha)
 *   "Ciclo 249 - 1606/2026" (Mann) · "051/2026 - Ciclo 189" · "203/2026 Ciclo 769" · "Ciclo 788"
 */
export function mestreComoModelo(antigo: string, linhas: LinhaTratamento[]): string {
  const entradas = antigo.split(/\s+\/\s+(?=\S)|\s*;\s*/).filter((e) => e.trim());
  const molde = (entradas[0] ?? "").trim();
  const codigo = (s: string) => /^[A-Z]{2}\d{6,}[A-Z0-9]*$/i.test(s.trim());
  const pecas = molde.split(/(\s+-\s+|\s+(?=(?:Ciclo|Lote)\b))/i);
  const uma = (l: LinhaTratamento) => {
    // Ciclo "curto": quando o ciclo é o código da curva (UR010972PR031026), o nº é o do lote.
    const cicloCurto = codigo(l.ciclo) ? l.lote || l.ciclo : l.ciclo;
    const out = pecas.map((p, i) => {
      if (i % 2 === 1) return p; // separador
      const t = p.trim();
      if (/^ciclo\b/i.test(t)) return cicloCurto ? `${t.match(/^ciclo/i)![0]} ${cicloCurto}` : "";
      if (/^lote\b/i.test(t)) return l.lote || cicloCurto ? `${t.match(/^lote/i)![0]} ${l.lote || cicloCurto}` : "";
      if (/^\d{1,5}\/\d{4}/.test(t)) return l.certificado;
      if (codigo(t)) return codigo(l.ciclo) ? l.ciclo : "";
      if (/^\d[\d.]*\s+\D/.test(t)) return l.quantidade ?? "";
      return t;
    });
    // Pedaço sem dado: sai junto com o separador da frente.
    let s = "";
    for (let i = 0; i < out.length; i += 2) {
      if (!out[i]) continue;
      s += (s && i > 0 ? out[i - 1] : "") + out[i];
    }
    return s.trim() || [l.ciclo && `Ciclo ${cicloCurto}`, l.certificado].filter(Boolean).join(" - ");
  };
  const unicas = [...new Map(linhas.map((l) => [`${l.ciclo}|${l.lote}|${l.certificado}`, l])).values()];
  const textos = [...new Set(unicas.map(uma))];
  // Várias no modelo numa linha ("… / …" ou "…; …"): junta igual; uma só com quantidade/lote: uma por linha.
  const sep = /;/.test(antigo) ? "; " : entradas.length > 1 || pecas.length < 5 ? " / " : "\n";
  return textos.join(sep);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Parágrafos sem outro parágrafo dentro (os de tabela e de caixa de texto também). */
const RE_PARAGRAFO = /<w:p[ >](?:(?!<w:p[ >])[\s\S])*?<\/w:p>/g;
const RE_T = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g;

interface Trecho {
  ini: number; // posição no texto do parágrafo
  fim: number;
}

/** Texto do parágrafo e onde está cada <w:t>. */
function textoDe(p: string): {
  texto: string;
  ts: (Trecho & { m: RegExpMatchArray })[];
} {
  const ts: (Trecho & { m: RegExpMatchArray })[] = [];
  let texto = "";
  for (const m of p.matchAll(RE_T)) {
    const t = desescapar(m[2]);
    ts.push({ ini: texto.length, fim: texto.length + t.length, m });
    texto += t;
  }
  return { texto, ts };
}

/** Troca o trecho [ini, fim) do texto do parágrafo por `novo`, mantendo a formatação do 1º run. */
function trocarTrecho(
  p: string,
  ini: number,
  fim: number,
  novo: string,
): string {
  const { ts } = textoDe(p);
  let out = "";
  let ultimo = 0;
  let colocado = false;
  for (const t of ts) {
    const idx = t.m.index!;
    const original = desescapar(t.m[2]);
    let txt = original;
    if (t.fim > ini && t.ini < fim) {
      const a = Math.max(0, ini - t.ini);
      const b = Math.min(original.length, fim - t.ini);
      txt = original.slice(0, a) + (colocado ? "" : novo) + original.slice(b);
      colocado = true;
    } else if (!colocado && t.ini >= ini && ini === fim) {
      txt = novo + original;
      colocado = true;
    }
    out +=
      p.slice(ultimo, idx) +
      `${t.m[1].replace(/<w:t(?![^>]*xml:space)/, '<w:t xml:space="preserve"')}${esc(txt)}${t.m[3]}`;
    ultimo = idx + t.m[0].length;
  }
  out += p.slice(ultimo);
  // Valor vazio no modelo (rótulo no fim do parágrafo): acrescenta no último run.
  if (!colocado && novo && ts.length)
    return trocarTrecho(
      out,
      textoDe(out).texto.length,
      textoDe(out).texto.length,
      novo,
    );
  return out;
}

/** Linha extra no mesmo parágrafo (quebra de linha), com a formatação do último run. */
function acrescentarLinha(p: string, texto: string): string {
  const runs = [
    ...p.matchAll(/<w:r[ >](?:(?!<w:r[ >])[\s\S])*?<\/w:r>/g),
  ].filter((r) => /<w:t[ >]/.test(r[0]));
  const ult = runs[runs.length - 1];
  if (!ult) return p;
  const rPr = ult[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
  const novo = `<w:r>${rPr}<w:br/><w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
  const fim = ult.index! + ult[0].length;
  return p.slice(0, fim) + novo + p.slice(fim);
}

const maiusculo = (s: string) => /[A-ZÀ-Ý]/.test(s) && s === s.toUpperCase();
const caixa = (antigo: string, novo: string) =>
  maiusculo(antigo) ? novo.toUpperCase() : novo;

const MESES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Nova data no mesmo formato da do modelo ("15/10/2026" ou "15 de outubro de 2026"). */
function trocarData(texto: string, data: string): string | null {
  const m = data.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const extenso = texto.match(/\d{1,2}\s+de\s+[A-Za-zçÇ]+\s+(?:de\s+)?\d{4}/);
  if (extenso) {
    const mes = MESES_PT[+m[2] - 1];
    const sample = extenso[0];
    const mesTxt = /de\s+[A-Z]/.test(sample) ? mes : mes.toLowerCase();
    return texto.replace(
      sample,
      `${m[1].padStart(2, "0")} de ${mesTxt} ${/de\s+\d{4}$/.test(sample) ? "de " : ""}${m[3]}`,
    );
  }
  if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(texto))
    return texto.replace(
      /\d{1,2}\/\d{1,2}\/\d{4}/,
      `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`,
    );
  return null;
}

export interface ValoresModelo {
  campos: Partial<Record<Campo, string>>; // "\n" = várias linhas (exportador + endereço, itens da quantidade)
  linhas: LinhaTratamento[];
  data: string;
  nfe?: string;
}

/** Valores a preencher a partir da declaração montada (nota + DR ou manual). */
export function valoresDoModelo(d: DadosDeclaracao): ValoresModelo {
  const ciclos = [...new Set(d.linhas.map((l) => l.ciclo).filter(Boolean))];
  const certs = [
    ...new Set(d.linhas.map((l) => l.certificado).filter(Boolean)),
  ];
  const per = periodoTratamento(d.linhas);
  const dur = d.linhas.find((l) => l.duracao)?.duracao.match(/\d+/)?.[0];
  return {
    campos: {
      exportador: [d.exportador, d.enderecoExportador]
        .filter(Boolean)
        .join("\n"),
      importador: d.importador,
      destinatario: d.destinatario,
      master: [
        certs.join("; "),
        ciclos.length ? `Ciclo ${ciclos.join(" / ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      ciclo: ciclos.join(" / "),
      lote: [...new Set(d.linhas.map((l) => l.lote).filter(Boolean))].join(
        " / ",
      ),
      navio: d.navio,
      fatura: d.fatura,
      nfe: d.nfe,
      booking: d.booking,
      bl: d.bl,
      container: d.container,
      marcas: d.marcas,
      volumes: d.volumes,
      produto: d.produto,
      pesoLiquido: d.pesoLiquido,
      pesoBruto: d.pesoBruto,
      origem: d.origem,
      destino: d.destino,
      programacao: d.comunicado
        .replace(/Programa[çc][ãa]o MAPA\s*/gi, "")
        .trim(),
      dataTratamento: per.pt
        ? `${per.pt.replace(/ de (\d{4})/g, " $1")} / ${per.en}`
        : "",
      duracao: dur ? `${dur} minutos / ${dur} minutes` : "",
      localTratamento: d.localTratamento,
      observacao: d.observacao,
    },
    linhas: d.linhas,
    data: d.data,
    nfe: d.observacao.match(/(\d[\d.]*)\s*$/)?.[1] ?? d.nfe,
  };
}

export interface ResultadoModelo {
  bytes: Uint8Array;
  preenchidos: string[];
  avisos: string[];
}

// ---------- tabela do tratamento ----------

type ColunaTab =
  | "ciclo"
  | "lote"
  | "inicio"
  | "fim"
  | "tipo"
  | "temperatura"
  | "duracao"
  | "umidade"
  | "quantidade"
  | null;

function colunaDe(t: string): ColunaTab {
  const s = t.toLowerCase();
  if (/in[íi]cio|start/.test(s)) return "inicio";
  if (/t[ée]rmino|final|end/.test(s)) return "fim";
  if (/temperatura|temperature/.test(s)) return "temperatura";
  if (/umidade|moisture/.test(s)) return "umidade";
  if (/tempo|dura[çc][ãa]o|duration|time/.test(s)) return "duracao";
  if (/ciclo|cycle/.test(s)) return "ciclo";
  if (/lote|batch/.test(s)) return "lote";
  if (/^\s*(?:tratamento|treatment|ht\s*\/\s*kd)/.test(s)) return "tipo";
  if (/quant|qty/.test(s)) return "quantidade";
  return null;
}

const celulas = (tr: string) =>
  [...tr.matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((m) => m[0]);
const textoCelula = (tc: string) =>
  [...tc.matchAll(RE_PARAGRAFO)]
    .map((p) => textoDe(p[0]).texto)
    .join(" ")
    .trim();

/** Troca o texto da célula (1º parágrafo com texto), mantendo a formatação. */
function preencherCelula(tc: string, valor: string): string {
  let feito = false;
  return tc.replace(RE_PARAGRAFO, (p) => {
    const { texto } = textoDe(p);
    if (feito) return texto ? trocarTrecho(p, 0, texto.length, "") : p;
    if (!texto && !/<w:r[ >]/.test(p)) return p;
    feito = true;
    return trocarTrecho(p, 0, texto.length, valor);
  });
}

/** Valor de uma coluna no formato da linha de exemplo do modelo ("12/10/2026 / 17h48m", "56°C", "32 min"). */
function formatar(
  col: ColunaTab,
  l: LinhaTratamento,
  exemplo: string,
  umidade: string,
): string {
  const dh = (v: string) => {
    const m = v.match(/(\d{2}\/\d{2}\/\d{4})\s*(\d{2}h\d{2}m)?/);
    if (!m) return v;
    const sep = exemplo.match(/\d{4}(\s*\/\s*|\s+)\d{1,2}h/)?.[1] ?? " ";
    return m[2] ? `${m[1]}${sep}${m[2]}` : m[1];
  };
  switch (col) {
    case "ciclo":
      return l.ciclo;
    case "lote":
      return l.lote;
    case "inicio":
      return dh(l.inicio);
    case "fim":
      return dh(l.fim);
    case "tipo":
      return l.tipo;
    case "temperatura":
      return /°|º/.test(exemplo)
        ? `${l.temperatura}${exemplo.match(/\s*[°º]\s*C?/)?.[0] ?? "°C"}`
        : l.temperatura;
    case "duracao": {
      const min = l.duracao.match(/\d+/)?.[0] ?? "";
      if (/h\d{2}m/.test(exemplo))
        return `${String(Math.floor(+min / 60)).padStart(2, "0")}h${String(+min % 60).padStart(2, "0")}m`;
      return /min/i.test(exemplo) || !exemplo ? `${min} min` : min;
    }
    case "umidade":
      return l.tipo === "KD" ? umidade : exemplo;
    case "quantidade":
      return l.quantidade ?? "";
    default:
      return exemplo;
  }
}

function preencherTabela(
  doc: string,
  linhas: LinhaTratamento[],
  umidade: string,
  avisos: string[],
): string {
  if (!linhas.length) return doc;
  const tabelas = [...doc.matchAll(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<\/w:tbl>/g)];
  const alvo = tabelas.find(
    (t) => /In[íi]cio|Start/i.test(t[0]) && /T[ée]rmino|End/i.test(t[0]),
  );
  if (!alvo) return doc;
  const tbl = alvo[0];
  const trs = [...tbl.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)];
  const iCab = trs.findIndex((t) => /In[íi]cio|Start/i.test(t[0]));
  const cab = celulas(trs[iCab][0]).map((c) => colunaDe(textoCelula(c)));
  const dados = trs
    .map((t, i) => ({ t, i }))
    .filter(
      ({ t, i }) =>
        i > iCab &&
        /\d{2}\/\d{2}\/\d{4}|\bHT\b|\bKD\b/.test(t[0]) &&
        celulas(t[0]).length === cab.length,
    );
  if (!dados.length) {
    avisos.push(
      "Achei a tabela do tratamento no modelo, mas não a linha de exemplo: as datas ficaram como no modelo.",
    );
    return doc;
  }
  const exemplo = dados[0].t[0];
  const exemplosTxt = celulas(exemplo).map(textoCelula);
  const novasLinhas = linhas.map((l) => {
    const tcs = celulas(exemplo);
    let tr = exemplo;
    tcs.forEach((tc, j) => {
      if (!cab[j]) return;
      tr = tr.replace(
        tc,
        preencherCelula(tc, formatar(cab[j], l, exemplosTxt[j], umidade)),
      );
    });
    return tr;
  });
  // Troca as linhas de exemplo pelas novas (uma por ciclo), no lugar da primeira.
  let nova = tbl;
  const primeira = dados[0].t[0];
  for (const { t } of dados.slice(1)) nova = nova.replace(t[0], "");
  nova = nova.replace(primeira, novasLinhas.join(""));
  return doc.replace(tbl, nova);
}

// ---------- API ----------

/** Preenche o modelo (.docx da empresa) com os dados da declaração. */
export async function preencherModelo(
  modelo: ArrayBuffer | Uint8Array,
  d: DadosDeclaracao,
): Promise<ResultadoModelo> {
  const zip = await JSZip.loadAsync(modelo);
  const arq = zip.file("word/document.xml");
  if (!arq) throw new Error("O modelo não é um Word (.docx) válido.");
  const original = await arq.async("string");
  const v = valoresDoModelo(d);
  const preenchidos: string[] = [];
  const avisos: string[] = [];
  let emissaoFeita = false;

  // Caixas de texto saem do parágrafo onde estão ancoradas (senão o parágrafo de fora — ex.: o
  // "LOCAL/PLACE" com a caixa da assinatura — não é visto) e são preenchidas à parte.
  const caixas: string[] = [];
  const RE_CAIXA =
    /<w:txbxContent>(?:(?!<w:txbxContent>)[\s\S])*?<\/w:txbxContent>/g;
  let mascarado = original;
  while (/<w:txbxContent>/.test(mascarado))
    mascarado = mascarado.replace(
      RE_CAIXA,
      (m) => `<!--cx${caixas.push(m) - 1}-->`,
    );

  const passar = (xmlEntrada: string): string => {
    let doc = xmlEntrada;
    // Parágrafos em ordem; continuação = parágrafo sem rótulo logo depois de um rótulo multilinha.
    const pars = [...doc.matchAll(RE_PARAGRAFO)].map((m) => ({
      xml: m[0],
      ini: m.index!,
    }));
    const novos = pars.map((p) => p.xml);
    let continuar: { campo: Campo; resto: string[]; ultimo: number } | null =
      null;

    pars.forEach((p, i) => {
      const { texto } = textoDe(p.xml);
      const achados = ROTULOS.flatMap(([campo, re]) =>
        [...texto.matchAll(new RegExp(re.source, "gi"))].map((m) => ({
          campo,
          ini: m.index!,
          fim: m.index! + m[0].length,
        })),
      )
        .sort((a, b) => a.ini - b.ini)
        .filter(
          (r, k, arr) =>
            !arr.some(
              (o, j) =>
                j !== k &&
                o.ini <= r.ini &&
                o.fim >= r.fim &&
                o.fim - o.ini > r.fim - r.ini,
            ),
        );

      if (!achados.length) {
        // Linha de continuação (endereço do exportador, 2º item da quantidade).
        if (continuar && texto.trim()) {
          // O parágrafo pode ter várias linhas com quebra ("AV …, 600" ↵ "CHAPECO - SC"): as
          // quebras antigas saem e as linhas novas entram com quebras novas (sem linha em branco).
          const quebras = (novos[i].match(/<w:br\/>/g) ?? []).length;
          const linhas = continuar.resto.splice(0, quebras + 1);
          let xml = novos[i].replace(/<w:br\/>/g, "");
          const t = textoDe(xml).texto;
          xml = trocarTrecho(xml, Math.max(0, t.search(/\S/)), t.trimEnd().length, linhas[0] ?? "");
          novos[i] = linhas.slice(1).reduce(acrescentarLinha, xml);
          continuar.ultimo = i;
          return;
        }
        if (continuar && continuar.resto.length)
          novos[continuar.ultimo] = continuar.resto.reduce(
            acrescentarLinha,
            novos[continuar.ultimo],
          );
        continuar = null;
        // Data da declaração sem rótulo "LOCAL/PLACE" ("Lages, 24 de junho de 2026."): último parágrafo com data.
        return;
      }
      if (continuar && continuar.resto.length)
        novos[continuar.ultimo] = continuar.resto.reduce(
          acrescentarLinha,
          novos[continuar.ultimo],
        );
      continuar = null;

      // Troca do fim para o começo (as posições do começo não mudam).
      let xml = novos[i];
      for (let k = achados.length - 1; k >= 0; k--) {
        const r = achados[k];
        const fimValor =
          k + 1 < achados.length ? achados[k + 1].ini : texto.length;
        const bruto = texto.slice(r.fim, fimValor);
        const ini = r.fim + (bruto.length - bruto.trimStart().length);
        const fim = r.fim + bruto.trimEnd().length;
        const antigo = texto.slice(ini, Math.max(ini, fim));
        if (r.campo === "localEmissao") {
          const trocado = trocarData(antigo, v.data);
          if (trocado != null) {
            xml = trocarTrecho(xml, ini, fim, trocado);
            emissaoFeita = true;
            preenchidos.push("data da declaração");
          }
          continue;
        }
        if (r.campo === "fixo") continue;
        let novo = v.campos[r.campo];
        if (r.campo === "observacao" && v.nfe && /\d{3,}/.test(antigo))
          novo = antigo.replace(/\d[\d.]*(?=\D*$)/, v.nfe);
        if (r.campo === "duracao" && novo && /\d/.test(antigo))
          novo = antigo.replace(/\d+/g, novo.match(/\d+/)![0]);
        // Certificado mestre na ordem do modelo: "Ciclo 249 - 1606/2026" (Mann) ou "203/2026 Ciclo 769".
        if (r.campo === "master" && v.linhas.some((l) => l.ciclo || l.certificado))
          novo = mestreComoModelo(antigo, v.linhas);
        // Em branco: os campos de cada remessa ficam vazios (o modelo é uma declaração antiga e o
        // dado dela não pode ir para a nova); os fixos da empresa ficam como no modelo.
        if (novo == null || novo === "") {
          if (!VARIAVEIS.has(r.campo)) continue;
          novo = "";
        }
        // Campo fixo da empresa igual ao do modelo (só caixa diferente): fica o do modelo.
        if (
          [
            "produto",
            "origem",
            "destino",
            "destinatario",
            "localTratamento",
          ].includes(r.campo) &&
          novo
            .trim()
            .toLowerCase()
            .replace(/\W/g, "")
            .startsWith(
              antigo.trim().toLowerCase().replace(/\W/g, "").slice(0, 12),
            )
        )
          continue;
        // Espaços repetidos dos dados (endereço da nota, descrição do item) saem: um espaço só.
        const linhasValor = novo.split("\n").map((l) => l.replace(/[ \t]{2,}/g, " ").trim());
        xml = trocarTrecho(xml, ini, fim, caixa(antigo, linhasValor[0]));
        preenchidos.push(r.campo);
        // Exportador / quantidade: as próximas linhas vão nos parágrafos seguintes do modelo (as
        // linhas que sobram no modelo — endereço antigo, 2º item antigo — ficam vazias).
        if (k === achados.length - 1 && (linhasValor.length > 1 || MULTILINHA.has(r.campo)))
          continuar = {
            campo: r.campo,
            resto: linhasValor.slice(1).map((l) => caixa(antigo, l)),
            ultimo: i,
          };
        else if (linhasValor.length > 1)
          xml = linhasValor
            .slice(1)
            .reduce((acc, l) => acrescentarLinha(acc, caixa(antigo, l)), xml);
      }
      novos[i] = xml;
    });
    if (continuar) {
      const c = continuar as { resto: string[]; ultimo: number };
      if (c.resto.length)
        novos[c.ultimo] = c.resto.reduce(acrescentarLinha, novos[c.ultimo]);
    }
    // Remonta com os parágrafos trocados (do fim para o começo).
    for (let i = pars.length - 1; i >= 0; i--) {
      if (novos[i] !== pars[i].xml)
        doc =
          doc.slice(0, pars[i].ini) +
          novos[i] +
          doc.slice(pars[i].ini + pars[i].xml.length);
    }
    return doc;
  };

  let doc = passar(mascarado);
  const caixasPreenchidas = caixas.map(passar);
  while (/<!--cx\d+-->/.test(doc))
    doc = doc.replace(/<!--cx(\d+)-->/g, (_, n) => caixasPreenchidas[+n]);

  // Data no fim sem rótulo ("Lages, 24 de junho de 2026."): o último parágrafo com data.
  if (!emissaoFeita) {
    const pars = [...doc.matchAll(RE_PARAGRAFO)];
    for (let i = pars.length - 1; i >= 0; i--) {
      const { texto } = textoDe(pars[i][0]);
      if (
        /\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\s+de\s+[A-Za-zç]+\s+(?:de\s+)?\d{4}/.test(
          texto,
        )
      ) {
        const trocado = trocarData(texto, v.data);
        if (trocado != null) {
          doc =
            doc.slice(0, pars[i].index!) +
            trocarTrecho(pars[i][0], 0, texto.length, trocado) +
            doc.slice(pars[i].index! + pars[i][0].length);
          preenchidos.push("data da declaração");
        }
        break;
      }
    }
  }
  doc = preencherTabela(doc, v.linhas, d.umidade, avisos);
  if (!preenchidos.length)
    avisos.push(
      "Não achei os rótulos de sempre no modelo (ex.: “EXPORTADOR/SHIPPER:”): confira o Word.",
    );

  zip.file("word/document.xml", doc);
  return {
    bytes: await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
    }),
    preenchidos: [...new Set(preenchidos)],
    avisos,
  };
}

/** Texto do modelo (para aprender os campos fixos e mostrar na edição). */
export async function textoDoModelo(
  modelo: ArrayBuffer | Uint8Array,
): Promise<string> {
  const zip = await JSZip.loadAsync(modelo);
  const doc = (await zip.file("word/document.xml")?.async("string")) ?? "";
  return [
    ...doc
      .replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "")
      .matchAll(RE_PARAGRAFO),
  ]
    .map((m) => textoDe(m[0]).texto)
    .join("\n");
}

const NOMES_CAMPO: Partial<Record<Campo, string>> = {
  exportador: "Exportador", importador: "Importador", destinatario: "Destinatário", master: "Certificado mestre", ciclo: "Ciclo",
  lote: "Lote", navio: "Navio", fatura: "Fatura/Invoice", nfe: "NF-e", booking: "Booking", bl: "B/L", container: "Container",
  marcas: "Marcas", volumes: "Quantidade/Volume", produto: "Natureza do produto", pesoLiquido: "Peso líquido", pesoBruto: "Peso bruto",
  origem: "Procedência", destino: "Destino", programacao: "Programação/comunicado", dataTratamento: "Data do tratamento",
  duracao: "Duração", localTratamento: "Local do tratamento", observacao: "Observação", localEmissao: "Local/data",
};

/** O que o site reconhece no modelo: os campos que ele vai preencher e a tabela do tratamento. */
export async function analisarModelo(modelo: ArrayBuffer | Uint8Array): Promise<{ campos: string[]; tabela: boolean; texto: string }> {
  const texto = await textoDoModelo(modelo);
  const plano = texto.replace(/\s+/g, " ");
  const campos = ROTULOS.filter(([c, re]) => c !== "fixo" && new RegExp(re.source, "i").test(plano)).map(([c]) => NOMES_CAMPO[c] ?? c);
  const tabela = /In[íi]cio|Start/i.test(plano) && /T[ée]rmino|End of/i.test(plano);
  return { campos: [...new Set(campos)], tabela, texto };
}

export type CampoModelo = Campo;

/**
 * O que está escrito hoje no modelo em cada campo ("EXPORTADOR/SHIPPER: BRF S.A. …" + as linhas
 * de endereço). É a base para aprender de onde vem cada dado (aprenderRemessa.ts).
 */
export async function valoresAtuaisDoModelo(modelo: ArrayBuffer | Uint8Array): Promise<Partial<Record<Campo, string>>> {
  const zip = await JSZip.loadAsync(modelo);
  let doc = (await zip.file("word/document.xml")?.async("string")) ?? "";
  doc = doc.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  // Texto de cada parágrafo, com as quebras de linha (<w:br/>) como "\n".
  const pars = [...doc.matchAll(RE_PARAGRAFO)].map((m) => {
    let t = "";
    for (const r of m[0].matchAll(/<w:br\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) t += r[0] === "<w:br/>" ? "\n" : desescapar(r[1] ?? "");
    return t;
  });
  const out: Partial<Record<Campo, string>> = {};
  let multilinha = null as Campo | null; // (atribuído dentro do forEach)
  for (const texto of pars) {
    const plano = texto.replace(/\n/g, " ");
    const achados = ROTULOS.flatMap(([campo, re]) => [...plano.matchAll(new RegExp(re.source, "gi"))].map((m) => ({ campo, ini: m.index!, fim: m.index! + m[0].length })))
      .sort((a, b) => a.ini - b.ini)
      .filter((r, k, arr) => !arr.some((o, j) => j !== k && o.ini <= r.ini && o.fim >= r.fim && o.fim - o.ini > r.fim - r.ini));
    if (!achados.length) {
      if (multilinha && texto.trim()) {
        out[multilinha] = `${out[multilinha] ?? ""}\n${texto.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")}`;
        continue;
      }
      multilinha = null;
      continue;
    }
    multilinha = null;
    achados.forEach((r, k) => {
      if (r.campo === "fixo") return;
      const v = texto.slice(r.fim, k + 1 < achados.length ? achados[k + 1].ini : texto.length).split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
      if (out[r.campo] == null) out[r.campo] = v;
      if (k === achados.length - 1 && MULTILINHA.has(r.campo)) multilinha = r.campo;
    });
  }
  return out;
}
