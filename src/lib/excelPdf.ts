// PDF de uma aba do Excel desenhada como o Excel imprime: larguras das colunas, alturas das linhas,
// células mescladas, fontes, bordas, preenchimentos, alinhamento, quebra de texto, imagens (logo) na
// posição da âncora e a configuração de impressão do modelo (papel, orientação, margens, ajustar à
// página, centralizar). Usado no comunicado: o modelo preenchido vira o PDF idêntico ao Excel.
// Roda no navegador (e no Node para testes). Fontes: Arimo (métrica da Arial) no lugar das sem serifa.
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { clip, endPath, PDFDocument, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { FontesPdf } from "./declaracaoLgPdf";

type Cor = [number, number, number];

interface Fonte {
  nome: string;
  tam: number;
  b: boolean;
  i: boolean;
  u: boolean;
  cor: Cor;
}

interface Borda {
  estilo: string;
  cor: Cor;
}

interface Estilo {
  fonte: Fonte;
  fundo: Cor | null;
  bordas: { l?: Borda; r?: Borda; t?: Borda; b?: Borda };
  h: string; // general | left | center | right | justify | centerContinuous | fill
  v: string; // bottom | center | top
  quebra: boolean;
  recuo: number;
  encolher: boolean;
  numFmt: number;
}

interface Trecho {
  texto: string;
  fonte: Fonte;
}

interface Celula {
  col: number;
  lin: number;
  trechos: Trecho[];
  numero: boolean;
  estilo: Estilo;
}

const PAPEL: Record<string, [number, number]> = {
  "1": [612, 792], // Carta
  "5": [612, 1008], // Ofício (Legal)
  "9": [595.28, 841.89], // A4
  "8": [841.89, 1190.55], // A3
};

// Paleta "indexed" padrão do Excel (0–63).
const INDEXADAS = (
  "000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF 000000 FFFFFF FF0000 00FF00 0000FF FFFF00 FF00FF 00FFFF " +
  "800000 008000 000080 808000 800080 008080 C0C0C0 808080 9999FF 993366 FFFFCC CCFFFF 660066 FF8080 0066CC CCCCFF " +
  "000080 FF00FF FFFF00 00FFFF 800080 800000 008080 0000FF 00CCFF CCFFFF CCFFCC FFFF99 99CCFF FF99CC CC99FF FFCC99 " +
  "3366FF 33CCCC 99CC00 FFCC00 FF9900 FF6600 666699 969696 003366 339966 003300 333300 993300 993366 333399 333333"
).split(" ");

const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/_x000D_/g, "")
    .replace(/_x([0-9A-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
const attr = (tag: string, nome: string) => tag.match(new RegExp(`\\s${nome}="([^"]*)"`))?.[1];
const colunaDe = (ref: string) => ref.replace(/[^A-Z]/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const linhaDe = (ref: string) => +ref.replace(/[^0-9]/g, "");
const hex = (h: string): Cor => {
  const s = h.slice(-6);
  return [parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255];
};

/** Tom (tint) do Excel aplicado à cor do tema, em HSL. */
function comTom([r, g, b]: Cor, tom: number): Cor {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tom < 0 ? l * (1 + tom) : l * (1 - tom) + tom;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/** Lê uma cor (<color rgb|theme|indexed tint>) do XML. */
function corDe(tag: string | undefined, tema: Cor[], padrao: Cor | null): Cor | null {
  if (!tag) return padrao;
  const rgbA = attr(tag, "rgb");
  const theme = attr(tag, "theme");
  const idx = attr(tag, "indexed");
  const tint = +(attr(tag, "tint") ?? 0);
  let c: Cor | null = padrao;
  if (rgbA) c = hex(rgbA);
  else if (theme != null) c = tema[+theme] ?? padrao;
  else if (idx != null) c = +idx === 64 ? [0, 0, 0] : +idx === 65 ? [1, 1, 1] : INDEXADAS[+idx] ? hex(INDEXADAS[+idx]) : padrao;
  if (c && tint) c = comTom(c, tint);
  return c;
}

/** Cores do tema na ordem que o Excel indexa (0 = lt1, 1 = dk1, 2 = lt2, 3 = dk2, 4… = acentos). */
function coresDoTema(xml: string): Cor[] {
  const bloco = xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/)?.[0] ?? "";
  const cor = (n: string): Cor => {
    const m = bloco.match(new RegExp(`<a:${n}>([\\s\\S]*?)</a:${n}>`))?.[1] ?? "";
    const v = m.match(/srgbClr val="([0-9A-Fa-f]{6})"/)?.[1] ?? m.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1];
    return v ? hex(v) : [0, 0, 0];
  };
  return ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"].map(cor);
}

function lerFonte(xml: string, tema: Cor[], base?: Fonte): Fonte {
  const val = (n: string) => attr(xml.match(new RegExp(`<${n}\\b[^>]*>`))?.[0] ?? "", "val");
  const tem = (n: string) => {
    const t = xml.match(new RegExp(`<${n}\\b[^>]*/?>`))?.[0];
    return t ? attr(t, "val") !== "0" && attr(t, "val") !== "false" : undefined;
  };
  return {
    nome: val("name") ?? val("rFont") ?? base?.nome ?? "Calibri",
    tam: +(val("sz") ?? base?.tam ?? 11),
    b: tem("b") ?? base?.b ?? false,
    i: tem("i") ?? base?.i ?? false,
    u: (xml.match(/<u\b[^>]*\/?>/) ? attr(xml.match(/<u\b[^>]*\/?>/)![0], "val") !== "none" : undefined) ?? base?.u ?? false,
    cor: corDe(xml.match(/<color\b[^>]*\/?>/)?.[0], tema, null) ?? base?.cor ?? [0, 0, 0],
  };
}

async function lerEstilos(zip: JSZip, tema: Cor[]) {
  const xml = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const fontes = [...(xml.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)?.[1] ?? "").matchAll(/<font\b[^>]*>([\s\S]*?)<\/font>|<font\b[^>]*\/>/g)].map((m) => lerFonte(m[1] ?? "", tema));
  const fundos = [...(xml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? "").matchAll(/<fill>([\s\S]*?)<\/fill>/g)].map((m) => {
    const p = m[1].match(/<patternFill\b[^>]*>/)?.[0] ?? "";
    const tipo = attr(p, "patternType");
    if (!tipo || tipo === "none") return null;
    return corDe(m[1].match(/<fgColor\b[^>]*\/?>/)?.[0], tema, tipo === "solid" ? [0, 0, 0] : null);
  });
  const bordas = [...(xml.match(/<borders[^>]*>([\s\S]*?)<\/borders>/)?.[1] ?? "").matchAll(/<border\b[^>]*>([\s\S]*?)<\/border>|<border\b[^>]*\/>/g)].map((m) => {
    const out: Estilo["bordas"] = {};
    for (const [lado, k] of [["left", "l"], ["right", "r"], ["top", "t"], ["bottom", "b"], ["start", "l"], ["end", "r"]] as const) {
      const t = (m[1] ?? "").match(new RegExp(`<${lado}\\b([^>]*)(?:/>|>([\\s\\S]*?)</${lado}>)`));
      const estilo = t ? attr(`<x${t[1]}>`, "style") : undefined;
      if (t && estilo && estilo !== "none") out[k] = { estilo, cor: corDe(t[2]?.match(/<color\b[^>]*\/?>/)?.[0], tema, [0, 0, 0]) ?? [0, 0, 0] };
    }
    return out;
  });
  const xfs = [...(xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").matchAll(/<xf\b([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g)].map((m): Estilo => {
    const a = `<x${m[1]}>`;
    const al = m[2]?.match(/<alignment\b[^>]*\/?>/)?.[0] ?? "";
    return {
      fonte: fontes[+(attr(a, "fontId") ?? 0)] ?? fontes[0],
      fundo: fundos[+(attr(a, "fillId") ?? 0)] ?? null,
      bordas: bordas[+(attr(a, "borderId") ?? 0)] ?? {},
      h: attr(al, "horizontal") ?? "general",
      v: attr(al, "vertical") ?? "bottom",
      quebra: attr(al, "wrapText") === "1" || attr(al, "wrapText") === "true",
      recuo: +(attr(al, "indent") ?? 0),
      encolher: attr(al, "shrinkToFit") === "1",
      numFmt: +(attr(a, "numFmtId") ?? 0),
    };
  });
  const formatos = new Map([...xml.matchAll(/<numFmt\b[^>]*\/>/g)].map((m) => [+(attr(m[0], "numFmtId") ?? 0), desescapar(attr(m[0], "formatCode") ?? "")]));
  return { fontes, xfs, formatos };
}

/** Número com o formato da célula: data (dd/mm/aaaa), hora, porcentagem ou o número como o Excel mostra. */
function formatarNumero(v: string, fmt: number, formatos: Map<number, string>): string {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return v;
  const codigo = formatos.get(fmt) ?? "";
  const ehData = (fmt >= 14 && fmt <= 22) || (fmt >= 45 && fmt <= 47) || /(^|[^"\\])[dmyhs]/i.test(codigo.replace(/"[^"]*"/g, ""));
  if (ehData && !/^0|#/.test(codigo)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    const p = (x: number) => String(x).padStart(2, "0");
    const data = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    const hora = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    if (fmt >= 18 && fmt <= 21) return hora;
    if (/h/i.test(codigo) && !/[dy]/i.test(codigo)) return /s/i.test(codigo) ? `${hora}:${p(d.getUTCSeconds())}` : hora;
    return /h/i.test(codigo) ? `${data} ${hora}` : data;
  }
  if (fmt === 9 || fmt === 10 || /%$/.test(codigo)) return `${(n * 100).toFixed(fmt === 10 ? 2 : 0)}%`;
  if (fmt === 1) return String(Math.round(n));
  if (fmt === 2) return n.toFixed(2).replace(".", ",");
  return String(+n.toPrecision(11)).replace(".", ",");
}

/** O texto é medido pela largura real da fonte (o Excel imprime assim; a diferença está nas colunas). */
const MEDIDA_EXCEL = 1;

/** Largura do dígito "0" (em em) das fontes padrão comuns, que define a largura impressa das colunas. */
const DIGITO_EM: [RegExp, number][] = [
  [/calibri|carlito/i, 1038 / 2048],
  [/aptos narrow/i, 0.46],
  [/aptos/i, 0.54],
  [/arial|arimo|helvetica|liberation sans/i, 1139 / 2048],
  [/times|tinos/i, 0.5],
  [/century gothic/i, 0.552],
];

/**
 * Largura impressa da coluna: na impressão o Excel usa caracteres × largura real do dígito da fonte
 * padrão + o recuo (5 px), não os pixels da tela — por isso no papel as colunas saem ~6% mais largas
 * que na tela (conferido com os PDFs do Excel: coluna de 55,71 em Calibri 11 = 314,3 pt).
 */
const larguraPt = (w: number, digito: number) => (w > 0 ? w * digito + 3.75 : 0);

interface Fontes {
  r: PDFFont;
  b: PDFFont;
  i: PDFFont;
  bi: PDFFont;
}

/** Fonte do PDF para a fonte do Excel; fontes estreitas (Aptos Narrow) um pouco menores para caber igual. */
function fontePdf(f: Fonte, fs: Fontes): { pdf: PDFFont; tam: number } {
  const pdf = f.b && f.i ? fs.bi : f.b ? fs.b : f.i ? fs.i : fs.r;
  // Sem a fonte original, a Arimo (Arial) no tamanho que dá a mesma largura média.
  const fator = /narrow|condensed/i.test(f.nome) ? 0.84 : /calibri|carlito/i.test(f.nome) ? 0.9 : /aptos/i.test(f.nome) ? 0.95 : /century gothic/i.test(f.nome) ? 1.06 : 1;
  return { pdf, tam: f.tam * fator };
}

/** Linhas de texto (com os trechos de fonte), quebradas na largura quando a célula tem "quebrar texto". */
function quebrarTrechos(trechos: Trecho[], larg: number, quebra: boolean, fs: Fontes): Trecho[][] {
  // Palavras com a fonte de cada trecho; "\n" força linha nova.
  type Palavra = { texto: string; fonte: Fonte; espaco: string } | "\n";
  const palavras: Palavra[] = [];
  for (const t of trechos) {
    const partes = t.texto.split(/(\n)/);
    for (const p of partes) {
      if (p === "\n") {
        palavras.push("\n");
        continue;
      }
      for (const m of p.replace(/\r/g, "").matchAll(/(\s*)(\S+|\s+$)/g)) {
        // O Excel também quebra depois do hífen ("15.104.340/0001-" ↵ "30").
        const pedacos = m[2].split(/(?<=-)(?=[^-])/);
        pedacos.forEach((x, k) => palavras.push({ texto: x, fonte: t.fonte, espaco: k ? "" : m[1] }));
      }
    }
  }
  const largura = (texto: string, f: Fonte) => {
    const { pdf, tam } = fontePdf(f, fs);
    return pdf.widthOfTextAtSize(texto, tam) * MEDIDA_EXCEL;
  };
  const linhas: Trecho[][] = [[]];
  let x = 0;
  // Começo de parágrafo (início do texto ou depois de Enter): os espaços da frente contam — é assim que
  // muitos cabeçalhos "centralizam" o texto. Linha quebrada pela largura começa sem espaço.
  let inicio = true;
  for (const p of palavras) {
    const atual = linhas[linhas.length - 1];
    if (p === "\n") {
      if (!quebra) {
        atual.push({ texto: " ", fonte: trechos[0]?.fonte });
        continue;
      }
      linhas.push([]);
      x = 0;
      inicio = true;
      continue;
    }
    // Espaços como estão no Excel ("0001-40     Reg. CREA").
    const sep = atual.length || inicio ? p.espaco : "";
    inicio = false;
    const w = largura(sep + p.texto, p.fonte);
    if (quebra && atual.length && x + w > larg) {
      linhas.push([{ texto: p.texto, fonte: p.fonte }]);
      x = largura(p.texto, p.fonte);
      continue;
    }
    const ult = atual[atual.length - 1];
    if (ult && ult.fonte === p.fonte) ult.texto += sep + p.texto;
    else atual.push({ texto: sep + p.texto, fonte: p.fonte });
    x += w;
  }
  return linhas;
}

const larguraLinha = (l: Trecho[], fs: Fontes) =>
  l.reduce((s, t) => {
    const { pdf, tam } = fontePdf(t.fonte, fs);
    return s + pdf.widthOfTextAtSize(t.texto, tam);
  }, 0);
/** Altura de cada linha de texto como a do Excel impresso (Arial 12 → 14,76 pt). */
const alturaLinha = (l: Trecho[], base: Fonte) => Math.max(base.tam, ...l.map((t) => t.fonte.tam)) * 1.23;

export interface OpcoesExcelPdf {
  /** Caminho da aba no zip ("xl/worksheets/sheet1.xml"); sem ele, a primeira aba. */
  aba?: string;
  /**
   * Células preenchidas agora ("B16"): a linha delas cresce para o texto quebrado, como o Excel faz ao
   * digitar. As outras linhas ficam com a altura gravada (o Excel não reajusta sozinho ao abrir).
   */
  ajustar?: string[];
}

/** Desenha a aba do Excel numa página PDF (como o Excel imprime) e devolve os bytes do PDF. */
export async function excelParaPdf(bytes: ArrayBuffer | Uint8Array, fontesPdf: FontesPdf, op: OpcoesExcelPdf = {}): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const relsWb = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const abas = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m, i) => {
    const rid = attr(m[0], "r:id") ?? "";
    const alvo = relsWb.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`))?.[0] ?? "";
    return { idx: i, caminho: `xl/${(attr(alvo, "Target") ?? "").replace(/^\/?xl\//, "")}` };
  });
  const aba = abas.find((a) => a.caminho === op.aba) ?? abas[0];
  const xml = (await zip.file(aba.caminho)?.async("string")) ?? "";
  const tema = coresDoTema((await zip.file("xl/theme/theme1.xml")?.async("string")) ?? "");
  const { fontes, xfs, formatos } = await lerEstilos(zip, tema);
  const estiloPadrao: Estilo = xfs[0] ?? { fonte: fontes[0], fundo: null, bordas: {}, h: "general", v: "bottom", quebra: false, recuo: 0, encolher: false, numFmt: 0 };

  // Textos compartilhados (com trechos de fonte, o "rich text").
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const compartilhados = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => {
    const runs = [...m[1].matchAll(/<r>([\s\S]*?)<\/r>/g)];
    if (!runs.length) return [{ texto: desescapar([...m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, "").matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")), rpr: null as string | null }];
    return runs.map((r) => ({ texto: desescapar(r[1].match(/<t[^>]*>([^<]*)<\/t>/)?.[1] ?? ""), rpr: r[1].match(/<rPr>([\s\S]*?)<\/rPr>/)?.[1] ?? null }));
  });

  // Células.
  const celulas = new Map<string, Celula>();
  for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = `<c${c[1]}>`;
    const ref = attr(a, "r");
    if (!ref) continue;
    const estilo = xfs[+(attr(a, "s") ?? 0)] ?? estiloPadrao;
    const tipo = attr(a, "t");
    const corpo = c[2] ?? "";
    const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    let trechos: Trecho[] = [];
    let numero = false;
    if (tipo === "s" && v != null) trechos = (compartilhados[+v] ?? []).map((t) => ({ texto: t.texto, fonte: t.rpr ? lerFonte(t.rpr, tema, estilo.fonte) : estilo.fonte }));
    else if (tipo === "inlineStr") trechos = [{ texto: desescapar([...corpo.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")), fonte: estilo.fonte }];
    else if ((tipo === "str" || tipo === "e") && v != null) trechos = [{ texto: desescapar(v), fonte: estilo.fonte }];
    else if (tipo === "b" && v != null) trechos = [{ texto: v === "1" ? "VERDADEIRO" : "FALSO", fonte: estilo.fonte }];
    else if (v != null) {
      trechos = [{ texto: formatarNumero(v, estilo.numFmt, formatos), fonte: estilo.fonte }];
      numero = true;
    }
    celulas.set(ref, { col: colunaDe(ref), lin: linhaDe(ref), trechos: trechos.filter((t) => t.texto), numero, estilo });
  }

  // Colunas e linhas.
  const fmtPr = xml.match(/<sheetFormatPr\b[^>]*>/)?.[0] ?? "";
  const alturaPadrao = +(attr(fmtPr, "defaultRowHeight") ?? 15);
  const largPadraoCar = attr(fmtPr, "defaultColWidth") ? +attr(fmtPr, "defaultColWidth")! : +(attr(fmtPr, "baseColWidth") ?? 8) + 0.71;
  // Dígito da fonte padrão da pasta (a 1ª fonte dos estilos: Calibri 11 quase sempre).
  const fPadrao = fontes[0] ?? { nome: "Calibri", tam: 11 };
  const digito = (DIGITO_EM.find(([re]) => re.test(fPadrao.nome))?.[1] ?? 0.53) * fPadrao.tam;
  const largCol = new Map<number, number>();
  const colOculta = new Set<number>();
  for (const m of xml.matchAll(/<col\b[^>]*\/?>/g)) {
    const min = +(attr(m[0], "min") ?? 0);
    const max = +(attr(m[0], "max") ?? 0);
    const w = attr(m[0], "width");
    for (let k = min; k <= Math.min(max, 200); k++) {
      if (w != null) largCol.set(k, larguraPt(+w, digito));
      if (attr(m[0], "hidden") === "1") colOculta.add(k);
    }
  }
  const alturaLin = new Map<number, { ht: number; fixa: boolean }>();
  const linOculta = new Set<number>();
  for (const m of xml.matchAll(/<row\b[^>]*>/g)) {
    const r = +(attr(m[0], "r") ?? 0);
    const ht = attr(m[0], "ht");
    if (ht != null) alturaLin.set(r, { ht: +ht, fixa: attr(m[0], "customHeight") === "1" });
    if (attr(m[0], "hidden") === "1") linOculta.add(r);
  }
  const larg = (c: number) => (colOculta.has(c) ? 0 : (largCol.get(c) ?? larguraPt(largPadraoCar, digito)));

  // Mesclas.
  const mesclas = [...xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)].map((m) => ({
    c1: colunaDe(m[1]),
    l1: linhaDe(m[1]),
    c2: colunaDe(m[2]),
    l2: linhaDe(m[2]),
  }));
  const mesclaDe = (c: number, l: number) => mesclas.find((m) => c >= m.c1 && c <= m.c2 && l >= m.l1 && l <= m.l2);

  // Imagens (logo): âncoras do desenho da aba.
  const relsAba = (await zip.file(aba.caminho.replace(/worksheets\//, "worksheets/_rels/") + ".rels")?.async("string")) ?? "";
  const ridDesenho = attr(xml.match(/<drawing\b[^>]*\/>/)?.[0] ?? "", "r:id");
  const alvoDesenho = ridDesenho ? attr(relsAba.match(new RegExp(`<Relationship[^>]*Id="${ridDesenho}"[^>]*>`))?.[0] ?? "", "Target") : undefined;
  type Ancora = {
    c: number;
    cOff: number;
    l: number;
    lOff: number;
    c2?: number;
    c2Off?: number;
    l2?: number;
    l2Off?: number;
    w?: number;
    h?: number;
    media: string;
    /** Recorte da imagem (frações de cada lado), o "cortar" do Excel. */
    corte: { l: number; t: number; r: number; b: number };
  };
  const ancoras: Ancora[] = [];
  if (alvoDesenho) {
    const caminhoDes = new URL(alvoDesenho, `http://x/${aba.caminho}`).pathname.slice(1);
    const des = (await zip.file(caminhoDes)?.async("string")) ?? "";
    const relsDes = (await zip.file(caminhoDes.replace(/drawings\//, "drawings/_rels/") + ".rels")?.async("string")) ?? "";
    for (const m of des.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[^>]*>([\s\S]*?)<\/xdr:\1>/g)) {
      const corpo = m[2];
      const rid = corpo.match(/<a:blip\b[^>]*r:embed="([^"]+)"/)?.[1];
      if (!rid) continue;
      const alvo = attr(relsDes.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`))?.[0] ?? "", "Target");
      if (!alvo) continue;
      const media = new URL(alvo, `http://x/${caminhoDes}`).pathname.slice(1);
      const pos = (tag: string) => {
        const b = corpo.match(new RegExp(`<xdr:${tag}>([\\s\\S]*?)</xdr:${tag}>`))?.[1];
        if (!b) return null;
        const n = (k: string) => +(b.match(new RegExp(`<xdr:${k}>(-?\\d+)</xdr:${k}>`))?.[1] ?? 0);
        return { c: n("col") + 1, cOff: n("colOff") / 12700, l: n("row") + 1, lOff: n("rowOff") / 12700 };
      };
      const ext = corpo.match(/<xdr:ext\b[^>]*\/>/)?.[0] ?? corpo.match(/<a:ext\b[^>]*\/>/)?.[0];
      const de = pos("from");
      if (!de) continue;
      const ate = m[1] === "twoCellAnchor" ? pos("to") : null;
      const sr = corpo.match(/<a:srcRect\b[^>]*\/?>/)?.[0] ?? "";
      const fr = (k: string) => +(attr(sr, k) ?? 0) / 100000;
      ancoras.push({
        corte: { l: fr("l"), t: fr("t"), r: fr("r"), b: fr("b") },
        ...de,
        ...(ate ? { c2: ate.c, c2Off: ate.cOff, l2: ate.l, l2Off: ate.lOff } : {}),
        w: ext ? +(attr(ext, "cx") ?? 0) / 12700 : undefined,
        h: ext ? +(attr(ext, "cy") ?? 0) / 12700 : undefined,
        media,
      });
    }
  }

  // Área de impressão: a definida no Excel ou a usada (texto, bordas, preenchimento e imagens).
  const nomeArea = [...wb.matchAll(/<definedName\b([^>]*)>([^<]+)<\/definedName>/g)].find(
    (m) => attr(`<x${m[1]}>`, "name") === "_xlnm.Print_Area" && (attr(`<x${m[1]}>`, "localSheetId") ?? "0") === String(aba.idx)
  )?.[2];
  let c1 = Infinity;
  let l1 = Infinity;
  let c2 = 0;
  let l2 = 0;
  const area = nomeArea?.match(/\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/);
  if (area) {
    [c1, l1, c2, l2] = [colunaDe(area[1]), +area[2], colunaDe(area[3]), +area[4]];
  } else {
    const incluir = (c: number, l: number) => {
      c1 = Math.min(c1, c);
      l1 = Math.min(l1, l);
      c2 = Math.max(c2, c);
      l2 = Math.max(l2, l);
    };
    for (const cel of celulas.values()) {
      const visivel = cel.trechos.some((t) => t.texto.trim()) || cel.estilo.fundo || Object.keys(cel.estilo.bordas).length;
      if (visivel) incluir(cel.col, cel.lin);
    }
    for (const m of mesclas) if (celulas.get(`${refDe(m.c1)}${m.l1}`)?.trechos.length) incluir(m.c2, m.l2);
    for (const a of ancoras) {
      incluir(a.c, a.l);
      if (a.c2) incluir(a.c2, a.l2!);
    }
    if (!Number.isFinite(c1)) [c1, l1, c2, l2] = [1, 1, 1, 1];
  }

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const r = await doc.embedFont(fontesPdf.r, { subset: true });
  const b = await doc.embedFont(fontesPdf.b, { subset: true });
  const i = await doc.embedFont(fontesPdf.i, { subset: true });
  const F: Fontes = { r, b, i, bi: b };

  // Alturas: a gravada; a linha de um campo preenchido agora, sem altura fixa, cresce para o texto quebrado.
  const preenchidas = new Set(op.ajustar ?? []);
  const alturas = new Map<number, number>();
  for (let l = l1; l <= l2; l++) {
    if (linOculta.has(l)) {
      alturas.set(l, 0);
      continue;
    }
    const gravada = alturaLin.get(l);
    let h = gravada?.ht ?? alturaPadrao;
    if (!gravada?.fixa) {
      for (const cel of celulas.values()) {
        if (cel.lin !== l || !cel.trechos.length || !cel.estilo.quebra || !preenchidas.has(`${refDe(cel.col)}${cel.lin}`)) continue;
        const m = mesclaDe(cel.col, cel.lin);
        if (m && m.l1 !== m.l2) continue;
        let w = 0;
        for (let c = cel.col; c <= (m?.c2 ?? cel.col); c++) w += larg(c);
        const linhas = quebrarTrechos(cel.trechos, w - 4 - cel.estilo.recuo * 7.5, true, F);
        const precisa = linhas.reduce((s, x) => s + alturaLinha(x, cel.estilo.fonte), 0);
        h = Math.max(h, precisa);
      }
    }
    alturas.set(l, h);
  }

  // Posição de cada coluna/linha dentro da área.
  const xCol = new Map<number, number>();
  let acc = 0;
  for (let c = c1; c <= c2 + 1; c++) {
    xCol.set(c, acc);
    if (c <= c2) acc += larg(c);
  }
  const largTotal = acc;
  const yLin = new Map<number, number>();
  acc = 0;
  for (let l = l1; l <= l2 + 1; l++) {
    yLin.set(l, acc);
    if (l <= l2) acc += alturas.get(l) ?? alturaPadrao;
  }
  const altTotal = acc;
  // Fora da área (imagem que começa acima da área de impressão): posição negativa / além do fim.
  const xDe = (c: number): number => {
    if (c < c1) return xDe(c + 1) - larg(c);
    if (c > c2 + 1) return xDe(c - 1) + larg(c - 1);
    return xCol.get(c)!;
  };
  const yDe = (l: number): number => {
    if (l < l1) return yDe(l + 1) - (linOculta.has(l) ? 0 : (alturaLin.get(l)?.ht ?? alturaPadrao));
    if (l > l2 + 1) return yDe(l - 1) + (alturaLin.get(l - 1)?.ht ?? alturaPadrao);
    return yLin.get(l)!;
  };

  // Página: papel, orientação, margens, escala / ajustar à página, centralizar.
  const ps = xml.match(/<pageSetup\b[^>]*\/?>/)?.[0] ?? "";
  let [pw, ph] = PAPEL[attr(ps, "paperSize") ?? "9"] ?? PAPEL["9"];
  if (attr(ps, "orientation") === "landscape") [pw, ph] = [ph, pw];
  const pm = xml.match(/<pageMargins\b[^>]*\/?>/)?.[0] ?? "";
  const mg = (k: string, p: number) => +(attr(pm, k) ?? p) * 72;
  const [ml, mr, mt, mb] = [mg("left", 0.7), mg("right", 0.7), mg("top", 0.75), mg("bottom", 0.75)];
  const ajustar = /<pageSetUpPr\b[^>]*fitToPage="(1|true)"/.test(xml);
  const dispW = pw - ml - mr;
  const dispH = ph - mt - mb;
  let escala: number;
  if (ajustar) {
    const fw = +(attr(ps, "fitToWidth") ?? 1);
    const fh = +(attr(ps, "fitToHeight") ?? 1);
    escala = Math.min(1, fw ? (dispW * fw) / largTotal : 1, fh ? (dispH * fh) / altTotal : 1);
    escala = Math.floor(escala * 100) / 100;
  } else escala = Math.max(0.1, Math.min(4, +(attr(ps, "scale") ?? 100) / 100));
  const po = xml.match(/<printOptions\b[^>]*\/?>/)?.[0] ?? "";
  const x0 = ml + (attr(po, "horizontalCentered") === "1" ? Math.max(0, (dispW - largTotal * escala) / 2) : 0);
  const y0 = mt + (attr(po, "verticalCentered") === "1" ? Math.max(0, (dispH - altTotal * escala) / 2) : 0);

  const pg: PDFPage = doc.addPage([pw, ph]);
  const X = (x: number) => x0 + x * escala;
  const Y = (y: number) => ph - (y0 + y * escala);
  const cor = (c: Cor) => rgb(c[0], c[1], c[2]);

  // Retângulo da célula (ou da mescla que ela começa); células cobertas por mescla não desenham.
  const retDe = (c: number, l: number) => {
    const m = mesclaDe(c, l);
    if (m && (m.c1 !== c || m.l1 !== l)) return null;
    return { xa: xDe(c), xb: xDe((m?.c2 ?? c) + 1), ya: yDe(l), yb: yDe((m?.l2 ?? l) + 1), m };
  };
  const dentro = (cel: Celula) => cel.col >= c1 && cel.col <= c2 && cel.lin >= l1 && cel.lin <= l2;

  // 1) Preenchimentos.
  for (const cel of celulas.values()) {
    if (!dentro(cel) || !cel.estilo.fundo) continue;
    const ret = retDe(cel.col, cel.lin);
    if (!ret) continue;
    pg.drawRectangle({ x: X(ret.xa), y: Y(ret.yb), width: (ret.xb - ret.xa) * escala, height: (ret.yb - ret.ya) * escala, color: cor(cel.estilo.fundo) });
  }

  // 2) Textos.
  const vazia = (c: number, l: number) => {
    const x = celulas.get(`${refDe(c)}${l}`);
    return !x?.trechos.length && !mesclaDe(c, l);
  };
  for (const cel of celulas.values()) {
    if (!dentro(cel) || !cel.trechos.length) continue;
    const ret = retDe(cel.col, cel.lin);
    if (!ret) continue;
    const e = cel.estilo;
    const pad = 2 + e.recuo * 7.5;
    let xa = ret.xa;
    let xb = ret.xb;
    const h = e.h === "general" ? (cel.numero ? "right" : "left") : e.h === "centerContinuous" ? "center" : e.h;
    let linhas = quebrarTrechos(cel.trechos, xb - xa - 2 * pad, e.quebra, F);
    let reducao = 1;
    if (e.encolher && !e.quebra) {
      const w = larguraLinha(linhas[0] ?? [], F);
      if (w > xb - xa - 2 * pad) reducao = (xb - xa - 2 * pad) / w;
    }
    // Texto sem quebra que não cabe: transborda para as vizinhas vazias (como no Excel).
    if (!e.quebra && !ret.m && !cel.numero) {
      const w = larguraLinha(linhas[0] ?? [], F) * MEDIDA_EXCEL + 2 * pad;
      if (w > xb - xa) {
        if (h === "left") for (let c = cel.col + 1; c <= c2 && xb - xa < w && vazia(c, cel.lin); c++) xb = xDe(c + 1);
        else if (h === "right") for (let c = cel.col - 1; c >= c1 && xb - xa < w && vazia(c, cel.lin); c--) xa = xDe(c);
        else if (h === "center") {
          for (let k = 1; xb - xa < w && k < 30; k++) {
            if (cel.col + k <= c2 && vazia(cel.col + k, cel.lin)) xb = xDe(cel.col + k + 1);
            if (cel.col - k >= c1 && vazia(cel.col - k, cel.lin)) xa = xDe(cel.col - k);
            if (!(cel.col + k <= c2 && vazia(cel.col + k, cel.lin)) && !(cel.col - k >= c1 && vazia(cel.col - k, cel.lin))) break;
          }
        }
      }
    }
    const alts = linhas.map((l) => alturaLinha(l, e.fonte) * reducao);
    const altTexto = alts.reduce((s, a) => s + a, 0);
    const altCel = ret.yb - ret.ya;
    // Texto quebrado mais alto que a célula: se o conteúdo não cabe, o Excel mostra a partir do topo e corta
    // embaixo (Mann, Eco Brasil); se só sobram linhas vazias no fim (Enter final), continua alinhado embaixo
    // e o conteúdo sobe para fora da célula (Castro) — conferido nos PDFs do Excel.
    let ultimaCheia = linhas.length - 1;
    while (ultimaCheia > 0 && !linhas[ultimaCheia].some((t) => t.texto.trim())) ultimaCheia--;
    const altConteudo = alts.slice(0, ultimaCheia + 1).reduce((s, a) => s + a, 0);
    const topo = e.v === "top" || (e.quebra && altTexto > altCel && altConteudo > altCel);
    let y = topo ? ret.ya + 1 : e.v === "center" || e.v === "justify" || e.v === "distributed" ? ret.ya + (altCel - altTexto) / 2 : ret.yb - altTexto - 1.5;
    // Recorte: na altura da célula; na largura, até onde o texto pode transbordar.
    pg.pushOperators(pushGraphicsState(), rectangle(X(xa), Y(ret.yb), (xb - xa) * escala, altCel * escala), clip(), endPath());
    for (const [k, l] of linhas.entries()) {
      const w = larguraLinha(l, F) * reducao;
      let x = h === "right" ? xb - pad - w : h === "center" ? (xa + xb - w) / 2 : xa + pad;
      const base = y + alts[k] * 0.8;
      for (const t of l) {
        const { pdf, tam } = fontePdf(t.fonte, F);
        const tm = tam * reducao;
        const tw = pdf.widthOfTextAtSize(t.texto, tm);
        if (y + alts[k] > ret.ya - 1 && y < ret.yb + 1) {
          pg.drawText(t.texto, { x: X(x), y: Y(base), size: tm * escala, font: pdf, color: cor(t.fonte.cor) });
          if (t.fonte.u) pg.drawLine({ start: { x: X(x), y: Y(base + 1.2) }, end: { x: X(x + tw), y: Y(base + 1.2) }, thickness: 0.5 * escala, color: cor(t.fonte.cor) });
        }
        x += tw;
      }
      y += alts[k];
    }
    pg.pushOperators(popGraphicsState());
  }

  // 3) Bordas (de cada célula; numa mescla, as bordas das células das pontas).
  const espessura: Record<string, number> = { hair: 0.25, thin: 0.6, dotted: 0.6, dashed: 0.6, dashDot: 0.6, dashDotDot: 0.6, medium: 1.2, mediumDashed: 1.2, mediumDashDot: 1.2, mediumDashDotDot: 1.2, slantDashDot: 1.2, thick: 1.9, double: 0.5 };
  const tracos: Record<string, number[] | undefined> = { dotted: [0.8, 1.2], dashed: [3, 1.5], mediumDashed: [4, 2], dashDot: [3, 1.5, 1, 1.5], mediumDashDot: [4, 2, 1.2, 2], dashDotDot: [3, 1.2, 1, 1.2, 1, 1.2], hair: [0.6, 0.6] };
  const linha = (xa: number, ya: number, xb: number, yb: number, bd: Borda) => {
    const t = (espessura[bd.estilo] ?? 0.6) * Math.max(0.6, escala);
    const opts = { thickness: t, color: cor(bd.cor), dashArray: tracos[bd.estilo] };
    if (bd.estilo === "double") {
      const d = 1.2 * escala;
      const vert = xa === xb;
      pg.drawLine({ start: { x: X(xa) - (vert ? d : 0), y: Y(ya) + (vert ? 0 : d) }, end: { x: X(xb) - (vert ? d : 0), y: Y(yb) + (vert ? 0 : d) }, ...opts });
      pg.drawLine({ start: { x: X(xa) + (vert ? d : 0), y: Y(ya) - (vert ? 0 : d) }, end: { x: X(xb) + (vert ? d : 0), y: Y(yb) - (vert ? 0 : d) }, ...opts });
    } else pg.drawLine({ start: { x: X(xa), y: Y(ya) }, end: { x: X(xb), y: Y(yb) }, ...opts });
  };
  for (const cel of celulas.values()) {
    if (!dentro(cel)) continue;
    const bd = cel.estilo.bordas;
    if (!bd.l && !bd.r && !bd.t && !bd.b) continue;
    const xa = xDe(cel.col);
    const xb = xDe(cel.col + 1);
    const ya = yDe(cel.lin);
    const yb = yDe(cel.lin + 1);
    const m = mesclaDe(cel.col, cel.lin);
    // Dentro da mescla só valem os lados que estão na borda da mescla.
    if (bd.t && (!m || cel.lin === m.l1)) linha(xa, ya, xb, ya, bd.t);
    if (bd.b && (!m || cel.lin === m.l2)) linha(xa, yb, xb, yb, bd.b);
    if (bd.l && (!m || cel.col === m.c1)) linha(xa, ya, xa, yb, bd.l);
    if (bd.r && (!m || cel.col === m.c2)) linha(xb, ya, xb, yb, bd.r);
  }

  // 4) Imagens por cima das células (o texto escondido atrás do logo continua escondido, como no Excel),
  // cortadas na área de impressão.
  pg.pushOperators(pushGraphicsState(), rectangle(X(0), Y(altTotal), largTotal * escala, altTotal * escala), clip(), endPath());
  const embutidas = new Map<string, PDFImage | null>();
  for (const a of ancoras) {
    if (!embutidas.has(a.media)) {
      const dados = await zip.file(a.media)?.async("uint8array");
      let img: PDFImage | null = null;
      try {
        if (dados) img = dados[0] === 0x89 ? await doc.embedPng(dados) : dados[0] === 0xff ? await doc.embedJpg(dados) : null;
      } catch {
        img = null;
      }
      embutidas.set(a.media, img);
    }
    const img = embutidas.get(a.media);
    if (!img) continue;
    const xa = xDe(a.c) + a.cOff;
    const ya = yDe(a.l) + a.lOff;
    const xb = a.c2 != null ? xDe(a.c2) + (a.c2Off ?? 0) : xa + (a.w ?? img.width * 0.75);
    const yb = a.l2 != null ? yDe(a.l2) + (a.l2Off ?? 0) : ya + (a.h ?? img.height * 0.75);
    if (xb <= xa || yb <= ya) continue;
    const { l, t, r: cr, b: cb } = a.corte;
    const bw = (xb - xa) * escala;
    const bh = (yb - ya) * escala;
    if (!l && !t && !cr && !cb) {
      pg.drawImage(img, { x: X(xa), y: Y(yb), width: bw, height: bh });
      continue;
    }
    // Recortada: a imagem inteira, maior, presa dentro da caixa.
    const fw = bw / Math.max(0.01, 1 - l - cr);
    const fh = bh / Math.max(0.01, 1 - t - cb);
    pg.pushOperators(pushGraphicsState(), rectangle(X(xa), Y(yb), bw, bh), clip(), endPath());
    pg.drawImage(img, { x: X(xa) - l * fw, y: Y(yb) - cb * fh, width: fw, height: fh });
    pg.pushOperators(popGraphicsState());
  }
  pg.pushOperators(popGraphicsState());

  return doc.save();
}

const refDe = (n: number): string => (n <= 0 ? "" : refDe(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));
