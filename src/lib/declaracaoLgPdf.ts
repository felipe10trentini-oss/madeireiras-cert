// PDF da declaração da LG direto do site, no layout do Word dela (protótipo): timbre com logo e
// dados, marca-d'água, título em duas linhas, "DESCRIÇÃO DA REMESSA", campos em maiúsculas,
// tabela do tratamento, local/data e assinatura do RT. Logo, marca-d'água, assinatura e os textos
// do timbre vêm do Word modelo guardado na pasta privada (nada disso fica no código).
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { minutosDe, mostrarLote, periodoTratamento, textoTratamento, type DadosDeclaracao } from "./declaracao";

export interface AtivosModelo {
  logo: Uint8Array | null;
  marca: Uint8Array | null; // marca-d'água
  assinatura: Uint8Array | null;
  rotAssinatura: number; // graus (Word: rot="16200000" = 270°)
  /** Quadro da assinatura no Word (pt, antes de girar) e o recorte da imagem (frações l, t, r, b). */
  quadro: { w: number; h: number };
  recorte: { l: number; t: number; r: number; b: number };
  nome: string;
  linhas: [string, string][]; // timbre: coluna da esquerda | da direita
  registro: string; // "REGISTRO MAPA BR-SC1040"
  rt: string[]; // "Responsável Técnico", "CREA SC …", "Eng. Florestal"
}

const desescapar = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function paragrafos(xml: string): string[] {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) =>
    desescapar(
      p[0]
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:sym [^>]*w:char="F02A"[^>]*\/>/g, "\u0001") // envelope (Wingdings)
        .replace(/<w:sym [^>]*w:char="F028"[^>]*\/>/g, "\u0002") // telefone (Wingdings)
        .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, "$1")
        .replace(/<[^>]+>/g, "")
    )
  );
}

/** Tira do Word modelo da LG: imagens (logo, marca-d'água, assinatura) e os textos do timbre e do RT. */
export async function ativosDoModelo(modelo: Uint8Array | ArrayBuffer): Promise<AtivosModelo> {
  const zip = await JSZip.loadAsync(modelo);
  const ler = async (n: string) => (await zip.file(n)?.async("string")) ?? "";
  const bin = async (n: string) => (zip.file(n) ? await zip.file(n)!.async("uint8array") : null);
  const out: AtivosModelo = { logo: null, marca: null, assinatura: null, rotAssinatura: 0, quadro: { w: 72, h: 102 }, recorte: { l: 0, t: 0, r: 0, b: 0 }, nome: "", linhas: [], registro: "", rt: [] };

  for (const h of Object.keys(zip.files).filter((n) => /^word\/header\d+\.xml$/.test(n))) {
    const xml = (await ler(h)).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
    const rels = await ler(h.replace("word/", "word/_rels/") + ".rels");
    const alvo = (id: string) => rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1];
    const logoId = xml.match(/<a:blip r:embed="(\w+)"/)?.[1];
    // Marca-d'água só a de verdade do Word ("WordPictureWatermark…"); outras imagens VML do
    // cabeçalho são enfeites do timbre.
    const marcaId = xml.match(/<v:shape [^>]*id="WordPictureWatermark[^"]*"[\s\S]*?<v:imagedata r:id="(\w+)"/)?.[1];
    if (logoId && !out.logo) out.logo = await bin(`word/${alvo(logoId)}`);
    if (marcaId && !out.marca) out.marca = await bin(`word/${alvo(marcaId)}`);
    for (const cx of xml.match(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g) ?? []) {
      const ps = paragrafos(cx).map((t) => t.trim()).filter(Boolean);
      if (ps.some((t) => /REGISTRO\s*MAPA/i.test(t))) out.registro ||= ps.find((t) => /REGISTRO\s*MAPA/i.test(t))!;
      else if (ps.length >= 3 && !out.nome) {
        // O nome às vezes vem na mesma linha do endereço, separado por espaços ("Madeico …     Rua …").
        const [nome, ...resto] = ps[0].split(/\t+|\s{3,}/);
        out.nome = nome.trim();
        const linhas = [...(resto.length ? [resto.join("   ")] : []), ...ps.slice(1)];
        out.linhas = linhas.map((t) => {
          const [a, ...b] = t.split(/\t+|\s{3,}/);
          return [a.trim(), b.join(" ").trim()];
        });
      }
    }
  }
  const doc = (await ler("word/document.xml")).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const rels = await ler("word/_rels/document.xml.rels");
  // Imagens do corpo (sem as "perdidas" fora da página). A assinatura é a última; se o cabeçalho não
  // tem logo, o logo é a primeira (há Word com o timbre no corpo, como o da Madeico).
  const imgs = [...doc.matchAll(/<wp:anchor\b[\s\S]*?<\/wp:anchor>/g)]
    .map((m) => m[0])
    .filter((a) => /<a:blip r:embed=/.test(a) && !/positionV relativeFrom="paragraph">\s*<wp:posOffset>[3-9]\d{6}/.test(a));
  const anc = imgs[imgs.length - 1];
  if (!out.logo && imgs.length > 1) {
    const id = imgs[0].match(/<a:blip r:embed="(\w+)"/)![1];
    const alvo = rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1];
    if (alvo) out.logo = await bin(`word/${alvo}`);
  }
  if (anc) {
    const id = anc.match(/<a:blip r:embed="(\w+)"/)![1];
    const alvo = rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))?.[1];
    if (alvo) out.assinatura = await bin(`word/${alvo}`);
    out.rotAssinatura = Math.round(+(anc.match(/<a:xfrm rot="(-?\d+)"/)?.[1] ?? 0) / 60000);
    const ext = anc.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    if (ext) out.quadro = { w: +ext[1] / 12700, h: +ext[2] / 12700 };
    const rc = anc.match(/<a:srcRect([^>]*)\/>/)?.[1] ?? "";
    const fr = (k: string) => +(rc.match(new RegExp(`\\b${k}="(-?\\d+)"`))?.[1] ?? 0) / 100000;
    out.recorte = { l: fr("l"), t: fr("t"), r: fr("r"), b: fr("b") };
  }
  for (const cx of doc.match(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g) ?? []) {
    const ps = paragrafos(cx).map((t) => t.trim()).filter((t) => t && !/^_+$/.test(t));
    if (ps.some((t) => /CREA|Respons[áa]vel/i.test(t))) out.rt = ps;
  }
  return out;
}

// ---------- desenho ----------

const A4 = { w: 595.28, h: 841.89 };
const PRETO = rgb(0, 0, 0);
const CINZA = rgb(0.25, 0.25, 0.25);

interface F {
  r: PDFFont;
  b: PDFFont;
  ti: PDFFont; // Times itálico (texto de abertura)
}

const limpar = (f: PDFFont, s: string) =>
  [...s.replace(/\s+/g, " ")]
    .map((c) => {
      try {
        f.encodeText(c);
        return c;
      } catch {
        return "-";
      }
    })
    .join("");

/** Texto com o topo em `y` (medido de cima da página). */
function texto(pg: PDFPage, t: string, x: number, yTopo: number, f: PDFFont, tam: number, cor = PRETO) {
  pg.drawText(limpar(f, t), { x, y: A4.h - yTopo - tam * 0.8, size: tam, font: f, color: cor });
}

function largura(f: PDFFont, t: string, tam: number) {
  return f.widthOfTextAtSize(limpar(f, t), tam);
}

function centro(pg: PDFPage, t: string, cx: number, yTopo: number, f: PDFFont, tam: number, cor = PRETO) {
  texto(pg, t, cx - largura(f, t, tam) / 2, yTopo, f, tam, cor);
}

/** Quebra o texto em linhas que cabem em `w`. */
function quebrar(f: PDFFont, t: string, tam: number, w: number): string[] {
  const out: string[] = [];
  let atual = "";
  for (const p of t.split(/\s+/)) {
    const prova = atual ? `${atual} ${p}` : p;
    if (atual && largura(f, prova, tam) > w) {
      out.push(atual);
      atual = p;
    } else atual = prova;
  }
  if (atual) out.push(atual);
  return out;
}

function linhaH(pg: PDFPage, x1: number, x2: number, yTopo: number, esp = 0.6, cor = PRETO) {
  pg.drawLine({ start: { x: x1, y: A4.h - yTopo }, end: { x: x2, y: A4.h - yTopo }, thickness: esp, color: cor });
}

function linhaV(pg: PDFPage, x: number, y1: number, y2: number, esp = 0.6, cor = PRETO) {
  pg.drawLine({ start: { x, y: A4.h - y1 }, end: { x, y: A4.h - y2 }, thickness: esp, color: cor });
}

/** Envelope e telefone do timbre (no Word são símbolos Wingdings). */
function icone(pg: PDFPage, tipo: "email" | "fone", x: number, yTopo: number, tam: number) {
  const y = A4.h - yTopo - tam * 0.78;
  const w = tam * 0.95;
  const h = tam * 0.62;
  if (tipo === "email") {
    pg.drawRectangle({ x, y, width: w, height: h, borderColor: PRETO, borderWidth: 0.5 });
    pg.drawLine({ start: { x, y: y + h }, end: { x: x + w / 2, y: y + h * 0.35 }, thickness: 0.5, color: PRETO });
    pg.drawLine({ start: { x: x + w, y: y + h }, end: { x: x + w / 2, y: y + h * 0.35 }, thickness: 0.5, color: PRETO });
  } else {
    pg.drawRectangle({ x, y, width: w, height: h * 0.55, color: PRETO });
    pg.drawRectangle({ x: x + w * 0.1, y: y + h * 0.55, width: w * 0.8, height: h * 0.45, color: PRETO });
  }
  return w + 1.5;
}

async function imagem(doc: PDFDocument, b: Uint8Array | null): Promise<PDFImage | null> {
  if (!b) return null;
  try {
    return b[0] === 0x89 ? await doc.embedPng(b) : await doc.embedJpg(b);
  } catch {
    return null;
  }
}

export interface FontesPdf {
  r: Uint8Array; // Arimo (medidas da Arial)
  b: Uint8Array; // Arimo negrito
  ti: Uint8Array; // Tinos itálico (medidas da Times New Roman)
  i: Uint8Array; // Arimo itálico
}

/** Fontes embutidas no PDF (public/fontes): o texto sai igual em qualquer leitor de PDF. */
export async function baixarFontes(base = ""): Promise<FontesPdf> {
  const get = async (n: string) => new Uint8Array(await (await fetch(`${base}/fontes/${n}`)).arrayBuffer());
  const [r, b, ti, i] = await Promise.all([
    get("arimo-latin-400-normal.woff"),
    get("arimo-latin-700-normal.woff"),
    get("tinos-latin-400-italic.woff"),
    get("arimo-latin-400-italic.woff"),
  ]);
  return { r, b, ti, i };
}

/** Gera o PDF da declaração da LG. */
export async function gerarPdfLg(d: DadosDeclaracao, a: AtivosModelo, fontes?: FontesPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Declaração de Tratamento Fitossanitário");
  doc.setAuthor(a.nome || "LG");
  let f: F;
  if (fontes) {
    doc.registerFontkit(fontkit);
    f = { r: await doc.embedFont(fontes.r, { subset: true }), b: await doc.embedFont(fontes.b, { subset: true }), ti: await doc.embedFont(fontes.ti, { subset: true }) };
  } else f = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold), ti: await doc.embedFont(StandardFonts.TimesRomanItalic) };
  const pg = doc.addPage([A4.w, A4.h]);
  const [logo, marca, assin] = [await imagem(doc, a.logo), await imagem(doc, a.marca), await imagem(doc, a.assinatura)];
  const ME = 20; // margens do Word da LG (estreitas)
  const MD = A4.w - 18;

  // Marca-d'água: o "LG" verde bem claro no meio da página.
  if (marca) {
    // Como no Word: 566,9 x 389,9 pt, centralizada na página.
    const w = 566.9;
    const h = (marca.height / marca.width) * w;
    pg.drawImage(marca, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h, opacity: 0.16 });
  }

  // ---------- timbre ----------
  if (logo) {
    const h = 50;
    const w = (logo.width / logo.height) * h;
    pg.drawImage(logo, { x: 79, y: A4.h - 18 - h, width: w, height: h });
  }
  if (a.registro) centro(pg, a.registro, 104, 82, f.b, 6.6);
  const xNome = 186;
  const xCol2 = 385;
  texto(pg, a.nome, xNome, 22, f.b, 14.5);
  a.linhas.forEach(([e, dir], i) => {
    const y = 40 + i * 12;
    const escreve = (t: string, x: number) => {
      let cx = x;
      if (t.includes("\u0001")) cx += icone(pg, "email", cx, y, 9.5);
      if (t.includes("\u0002")) cx += icone(pg, "fone", cx, y, 9.5);
      texto(pg, t.replace(/[\u0001\u0002]/g, ""), cx, y, f.r, 9.5);
    };
    escreve(e, xNome);
    if (dir) escreve(dir, xCol2);
  });
  linhaH(pg, 18, MD, 99, 0.7);

  // ---------- título ----------
  centro(pg, "DECLARAÇÃO DE TRATAMENTO FITOSSANITÁRIO", A4.w / 2, 113, f.b, 16.5);
  centro(pg, "PHYTOSANITARY TREATMENT DECLARATION", A4.w / 2, 135, f.b, 16.5);
  centro(pg, "O abaixo assinado, declara que os produtos constantes da remessa abaixo descritas foram submetidas a tratamento térmico conforme indicação a seguir:", A4.w / 2, 155, f.ti, 7.2);
  centro(pg, "The undersigns declares that the products reported of the under described despatch were submitted to heat treatment according following indications:", A4.w / 2, 166, f.ti, 7.2);
  const tit = "DESCRIÇÃO DA REMESSA - DESCRIPTION OF THE CONSIGNMENT";
  const wt = largura(f.b, tit, 12.5);
  centro(pg, tit, A4.w / 2, 188, f.b, 12.5);
  linhaH(pg, (A4.w - wt) / 2, (A4.w + wt) / 2, 201, 1);

  // ---------- campos ----------
  const TAM = 7.6;
  const X = ME;
  let y = 216;
  const campo = (rot: string, valor: string, depois = 12) => {
    const r = `${rot}: `;
    texto(pg, r, X, y, f.b, TAM);
    const xv = X + largura(f.b, r, TAM) + 1;
    const linhas = valor
      .toUpperCase()
      .split("\n")
      .flatMap((l) => quebrar(f.b, l.trim(), TAM, MD - xv));
    linhas.forEach((l, i) => texto(pg, l, xv, y + i * 10, f.b, TAM));
    y += Math.max(1, linhas.length) * 10 + depois;
  };
  const exportador = [d.exportador, d.enderecoExportador].filter(Boolean).join("\n");
  campo("EXPORTADOR/SHIPPER", exportador);
  campo("DESTINATÁRIO/CONSIGNEE", d.destinatario || "NIHIL");
  campo("CICLO DE TRATAMENTO/ TREATMENT CYCLE", [...new Set(d.linhas.map((l) => l.ciclo).filter(Boolean))].join(" / "));
  campo("PROGRAMAÇÃO MAPA", d.comunicado.replace(/Programa[çc][ãa]o MAPA\s*/gi, ""));
  campo("QUANTIDADE/QUANTITY", d.volumes, 16);
  campo("NATUREZA DO PRODUTO/KIND OF PRODUCT", (d.produto || "").split(" / ")[0]);
  // Procedência e destino na mesma linha.
  texto(pg, `PROCEDÊNCIA/ORIGIN: ${(d.origem || "BRASIL").split(" / ")[0].toUpperCase()}`, X, y, f.b, TAM);
  texto(pg, `DESTINO/DESTINATION: ${(d.destino || "NIHIL").toUpperCase()}`, 268, y, f.b, TAM);
  y += 24;

  // ---------- tabela ----------
  const cols = [21, 110, 197, 325, 453, 580];
  const topo = y;
  const hTit = 14;
  const hCab = 26;
  const hLin = 13;
  linhaH(pg, cols[0], cols[5], topo);
  centro(pg, "TRATAMENTO/ TREATMENT", (cols[0] + cols[5]) / 2, topo + 3.5, f.b, 7.4);
  linhaH(pg, cols[0], cols[5], topo + hTit);
  const cab = [
    ["Tratamento/", "Treatment"],
    ["Temperatura/", "Temperature"],
    ["Início do Tratamento/", "Start of Treatment"],
    ["Término do Tratamento/", "End of Treatment"],
    ["Tempo Tratamento/", "Treatment Time"],
  ];
  cab.forEach(([l1, l2], i) => {
    const cx = (cols[i] + cols[i + 1]) / 2;
    centro(pg, l1, cx, topo + hTit + 4, f.b, 7.4);
    centro(pg, l2, cx, topo + hTit + 13.5, f.b, 7.4);
  });
  let yl = topo + hTit + hCab;
  linhaH(pg, cols[0], cols[5], yl);
  const linhas = d.linhas.length ? d.linhas : [{ certificado: "", ciclo: "", lote: "", inicio: "", fim: "", tipo: "HT" as const, temperatura: "56", duracao: "32 min" }];
  const dh = (v: string) => v.replace(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}h\d{2}m)$/, "$1 / $2");
  for (const l of linhas) {
    const vals = [l.tipo, l.temperatura ? `${l.temperatura}°C` : "", dh(l.inicio), dh(l.fim), l.duracao];
    vals.forEach((v, i) => centro(pg, v, (cols[i] + cols[i + 1]) / 2, yl + 3.2, f.b, 7.4));
    yl += hLin;
    linhaH(pg, cols[0], cols[5], yl);
  }
  texto(pg, `Local de Tratamento/ Place of Treatment: ${d.localTratamento}`, cols[0] + 3, yl + 3.2, f.b, 7.4);
  const fimTab = yl + hLin;
  linhaH(pg, cols[0], cols[5], fimTab);
  linhaV(pg, cols[0], topo, fimTab);
  linhaV(pg, cols[5], topo, fimTab);
  for (const x of cols.slice(1, 5)) linhaV(pg, x, topo + hTit, yl);
  y = fimTab + 14;

  // ---------- observação, local e data, assinatura ----------
  texto(pg, `OBSERVAÇÃO/REMARK: ${d.observacao.toUpperCase().replace(/^REF\.?\s*[ÀA]\s*NF-?E/, "REF. A NFE")}`, X + 2, y, f.b, TAM);
  y += 46;
  const data = d.data.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] ?? d.data;
  texto(pg, `LOCAL/PLACE: ${(d.localEmissao || "Concórdia - SC").toUpperCase().replace(/\s*-\s*/, " – ")} - BRAZIL ${data}`, X, y, f.b, TAM);

  const cxAss = 478;
  const yLinha = y + 10;
  if (assin) {
    // Como no Word: a parte recortada da imagem preenche o quadro (w x h) e depois gira.
    const rot = ((a.rotAssinatura % 360) + 360) % 360;
    const { l, t, r, b } = a.recorte;
    const W = a.quadro.w / Math.max(0.05, 1 - l - r); // imagem inteira
    const H = a.quadro.h / Math.max(0.05, 1 - t - b);
    const cl = l * W;
    const ct = t * H;
    const deitada = rot === 90 || rot === 270;
    const largPag = deitada ? a.quadro.h : a.quadro.w;
    const altPag = deitada ? a.quadro.w : a.quadro.h;
    const esq = cxAss - largPag / 2;
    const base = A4.h - yLinha - altPag * 0.08; // a rubrica passa um pouco da linha
    if (rot === 270) {
      // 270° horário (Word) = 90° anti-horário (pdf-lib), em volta do canto inferior esquerdo.
      pg.drawImage(assin, { x: esq + H - ct, y: base - cl, width: W, height: H, rotate: degrees(90) });
    } else if (rot === 90) {
      pg.drawImage(assin, { x: esq - (H - ct - a.quadro.h), y: base + W - cl, width: W, height: H, rotate: degrees(-90) });
    } else {
      pg.drawImage(assin, { x: esq - cl, y: base - (H - ct - altPag), width: W, height: H });
    }
  }
  linhaH(pg, cxAss - 60, cxAss + 60, yLinha, 0.6);
  a.rt.forEach((t, i) => centro(pg, t, cxAss, yLinha + 3 + i * 9.5, f.r, 7.8, CINZA));

  // Rodapé: linha como no Word.
  linhaH(pg, 18, MD, A4.h - 30, 0.6);
  return doc.save();
}

// ---------- versão B (layout novo, mesma identidade) ----------

const CINZA_FUNDO = rgb(0.965, 0.972, 0.968);
const CINZA_LINHA = rgb(0.79, 0.83, 0.81);
const CINZA_TXT = rgb(0.36, 0.39, 0.38);
const TINTA = rgb(0.11, 0.13, 0.12);

// Ícones de traço (Feather, licença MIT), em caixa 24x24.
const ICONE_EMAIL = ["M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z", "M22 6l-10 7L2 6"];
const ICONE_FONE = [
  "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
];

function iconeTraco(pg: PDFPage, caminhos: string[], x: number, yTopo: number, tam: number, cor: ReturnType<typeof rgb>) {
  const esc = tam / 24;
  for (const c of caminhos) pg.drawSvgPath(c, { x, y: A4.h - yTopo, scale: esc, borderColor: cor, borderWidth: 1.8 });
  return tam + 3;
}

/** Retângulo de cantos arredondados (contorno e/ou fundo); y medido do topo. */
function caixa(pg: PDFPage, x: number, yTopo: number, w: number, h: number, r: number, o: { fundo?: ReturnType<typeof rgb>; borda?: ReturnType<typeof rgb>; esp?: number; soCima?: boolean }) {
  const rb = o.soCima ? 0 : r;
  const d = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - rb} Q ${w} ${h} ${w - rb} ${h} H ${rb} Q 0 ${h} 0 ${h - rb} V ${r} Q 0 0 ${r} 0 Z`;
  pg.drawSvgPath(d, { x, y: A4.h - yTopo, color: o.fundo, borderColor: o.borda, borderWidth: o.borda ? (o.esp ?? 0.8) : 0 });
}

/** PDF da declaração da LG, versão B (layout novo, no verde da LG). */
export function gerarPdfLgB(d: DadosDeclaracao, a: AtivosModelo, fontes: FontesPdf): Promise<Uint8Array> {
  return gerarPdfPadrao(d, a, fontes, { cor: [0.118, 0.318, 0.212], geral: false });
}

export interface OpcoesPdf {
  /** Cor de destaque (r, g, b de 0 a 1): a do logo da empresa. */
  cor: [number, number, number];
  /** true: campos de qualquer empresa (importador, NF-e, navio…), coluna do ciclo e o texto do tratamento. */
  geral: boolean;
  /** Com `geral`: a tabela do tratamento da LG (ciclo, início, término…) no lugar de "só o mês" (Mann Unid. Volante). */
  tabela?: boolean;
}

/**
 * Layout novo da declaração (o da LG versão B) para qualquer empresa: margens iguais, rótulos em
 * coluna, selo do registro no MAPA, tabela com faixa e cantos arredondados, cor do logo da empresa.
 */
export async function gerarPdfPadrao(d: DadosDeclaracao, a: AtivosModelo, fontes: FontesPdf, o: OpcoesPdf): Promise<Uint8Array> {
  const VERDE = rgb(...o.cor);
  const VERDE_CLARO = rgb(...(o.cor.map((c) => c * 0.08 + 0.92) as [number, number, number]));
  const doc = await PDFDocument.create();
  doc.setTitle("Declaração de Tratamento Fitossanitário");
  doc.setAuthor(a.nome || "MANN");
  doc.registerFontkit(fontkit);
  const r = await doc.embedFont(fontes.r, { subset: true });
  const b = await doc.embedFont(fontes.b, { subset: true });
  const it = await doc.embedFont(fontes.i, { subset: true });
  const pg = doc.addPage([A4.w, A4.h]);
  const [logo, marca, assin] = [await imagem(doc, a.logo), await imagem(doc, a.marca), await imagem(doc, a.assinatura)];
  const ME = 50;
  const MD = A4.w - 50;
  const LARG = MD - ME;

  if (marca) {
    // Tamanho do Word (566,9 x 389,9 pt), centralizada; um pouco mais clara que no clássico.
    const w = 566.9;
    const h = (marca.height / marca.width) * w;
    pg.drawImage(marca, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h, opacity: 0.1 });
  }

  // ---------- cabeçalho ----------
  let xTxt = ME;
  const fimTxt = MD - (a.registro ? 98 + 12 : 0); // o texto do cabeçalho termina antes do selo
  if (logo) {
    // Do topo do nome até a última linha do cabeçalho; logo largo (só o nome da marca) fica
    // limitado para sobrar espaço para os dados.
    let h = 66;
    let w = (logo.width / logo.height) * h;
    const maxW = Math.min(170, (fimTxt - ME) * 0.4);
    if (w > maxW) {
      w = maxW;
      h = (logo.height / logo.width) * w;
    }
    pg.drawImage(logo, { x: ME, y: A4.h - 33 - (66 + h) / 2, width: w, height: h });
    xTxt = ME + w + 16;
  }
  const espTxt = fimTxt - xTxt;
  const tamNome = Math.min(13.5, (13.5 * espTxt) / Math.max(1, largura(b, a.nome, 13.5)));
  texto(pg, a.nome, xTxt, 36, b, tamNome, VERDE);
  // Duas colunas no espaço que sobra; letra menor se a linha não couber.
  const col2 = xTxt + espTxt * 0.55;
  const tamLinha = Math.min(
    8.4,
    ...a.linhas.flatMap(([e, dir]) => [
      (8.4 * (espTxt * (dir ? 0.53 : 1))) / Math.max(1, largura(r, e.replace(/[\u0001\u0002]\s*:?\s*/g, "") + "   ", 8.4)),
      dir ? (8.4 * espTxt * 0.45) / Math.max(1, largura(r, dir.replace(/[\u0001\u0002]\s*:?\s*/g, "") + "   ", 8.4)) : 8.4,
    ])
  );
  a.linhas.slice(0, 4).forEach(([e, dir], i) => {
    const y = 55 + i * 11;
    const escreve = (t: string, x: number) => {
      let cx = x;
      if (t.includes("\u0001")) cx += iconeTraco(pg, ICONE_EMAIL, cx, y - 0.5, 8.5, VERDE);
      if (t.includes("\u0002")) cx += iconeTraco(pg, ICONE_FONE, cx, y - 0.5, 8.5, VERDE);
      texto(pg, t.replace(/[\u0001\u0002]\s*:?\s*/g, ""), cx, y, r, Math.max(6.5, tamLinha), CINZA_TXT);
    };
    escreve(e, xTxt);
    if (dir) escreve(dir, col2);
  });
  // Selo do registro no MAPA, à direita.
  if (a.registro) {
    const num = a.registro.replace(/^\s*REGISTRO\s*MAPA\s*/i, "");
    const w = 98;
    const x = MD - w;
    caixa(pg, x, 36, w, 34, 4, { borda: VERDE, esp: 0.9 });
    centro(pg, "REGISTRO NO MAPA", x + w / 2, 42, b, 6.4, CINZA_TXT);
    centro(pg, num, x + w / 2, 53, b, 10.5, VERDE);
  }
  linhaH(pg, ME, MD, 104, 1.4, VERDE);

  // ---------- título ----------
  centro(pg, "DECLARAÇÃO DE TRATAMENTO FITOSSANITÁRIO", A4.w / 2, 122, b, 15, TINTA);
  centro(pg, "PHYTOSANITARY TREATMENT DECLARATION", A4.w / 2, 141, r, 10.5, CINZA_TXT);
  const intro = [
    "O abaixo assinado declara que os produtos constantes da remessa abaixo descrita foram submetidos a tratamento térmico conforme indicação a seguir.",
    "The undersigned declares that the products of the consignment described below were subjected to heat treatment according to the following indications.",
  ];
  let y = 160;
  // Cada frase numa linha só (tamanho ajustado para caber na largura).
  const tamIntro = Math.min(7.6, ...intro.map((l) => (7.6 * LARG) / largura(it, l, 7.6)));
  for (const l of intro) {
    centro(pg, l, A4.w / 2, y, it, tamIntro, CINZA_TXT);
    y += 10.5;
  }
  y += 8;

  // ---------- remessa: rótulos em coluna ----------
  const secao = (pt: string, en: string) => {
    texto(pg, pt, ME, y, b, 8.6, VERDE);
    texto(pg, `  ·  ${en}`, ME + largura(b, pt, 8.6), y + 0.4, r, 7.8, CINZA_TXT);
    y += 12;
    linhaH(pg, ME, MD, y, 0.8, VERDE);
    y += 7;
  };
  secao("DESCRIÇÃO DA REMESSA", "DESCRIPTION OF THE CONSIGNMENT");
  const COL = 168; // largura da coluna dos rótulos
  const TAMV = 8.6;
  const linhaCampo = (pt: string, en: string, valor: string, extra?: { pt: string; en: string; valor: string }) => {
    const larguraValor = extra ? LARG / 2 - COL - 6 : LARG - COL;
    const linhas = valor
      .toUpperCase()
      .split("\n")
      .flatMap((l) => quebrar(b, l.trim(), TAMV, larguraValor))
      .filter(Boolean);
    texto(pg, pt, ME, y, b, 7.6, TINTA);
    texto(pg, en, ME, y + 9, it, 6.8, CINZA_TXT);
    (linhas.length ? linhas : ["—"]).forEach((l, i) => texto(pg, l, ME + COL, y + i * 11, b, TAMV, TINTA));
    // 2ª coluna (B/L, contêiner…): quebra na largura que sobra (vários contêineres não saem da página).
    let linhasExtra: string[] = [];
    if (extra) {
      const x2 = ME + LARG / 2 + 6;
      texto(pg, extra.pt, x2, y, b, 7.6, TINTA);
      texto(pg, extra.en, x2, y + 9, it, 6.8, CINZA_TXT);
      linhasExtra = quebrar(b, extra.valor.toUpperCase(), TAMV, MD - (x2 + 92));
      linhasExtra.forEach((l, i) => texto(pg, l, x2 + 92, y + i * 11, b, TAMV, TINTA));
    }
    y += Math.max(20, Math.max(linhas.length, linhasExtra.length) * 11 + 6);
    linhaH(pg, ME, MD, y - 4, 0.4, CINZA_LINHA);
    y += 4;
  };
  const ciclos = [...new Set(d.linhas.map((l) => l.ciclo).filter(Boolean))].join(" / ");
  const ptDe = (v: string) => v.split(" / ")[0];
  if (!o.geral) {
    linhaCampo("EXPORTADOR", "Shipper", [d.exportador, d.enderecoExportador].filter(Boolean).join("\n"));
    linhaCampo("DESTINATÁRIO", "Consignee", d.destinatario || "NIHIL");
    linhaCampo("CICLO DE TRATAMENTO", "Treatment cycle", ciclos);
    linhaCampo("PROGRAMAÇÃO MAPA", "MAPA schedule", d.comunicado.replace(/Programa[çc][ãa]o MAPA\s*/gi, ""));
    linhaCampo("QUANTIDADE", "Quantity", d.volumes);
    linhaCampo("NATUREZA DO PRODUTO", "Kind of product", ptDe(d.produto || ""));
    linhaCampo("PROCEDÊNCIA", "Origin", ptDe(d.origem || "BRASIL"), { pt: "DESTINO", en: "Destination", valor: d.destino || "NIHIL" });
  } else {
    // Só os campos preenchidos; os curtos vão dois por linha.
    const um = (pt: string, en: string, v: string) => v.trim() && linhaCampo(pt, en, v);
    const dois = (a1: [string, string, string], a2: [string, string, string]) => {
      const [x, y2] = [a1[2].trim(), a2[2].trim()];
      if (x && y2) linhaCampo(a1[0], a1[1], x, { pt: a2[0], en: a2[1], valor: y2 });
      else if (x) linhaCampo(a1[0], a1[1], x);
      else if (y2) linhaCampo(a2[0], a2[1], y2);
    };
    um("EXPORTADOR", "Shipper", [d.exportador, d.enderecoExportador].filter(Boolean).join("\n"));
    um("IMPORTADOR", "Importer", d.importador);
    um("DESTINATÁRIO", "Consignee", d.destinatario);
    dois(["FATURA", "Invoice", d.fatura], ["NF-E", "Invoice no.", d.nfe]);
    dois(["BOOKING", "Booking", d.booking], ["B/L", "Bill of lading", d.bl]);
    dois(["NAVIO", "Vessel", d.navio], ["CONTÊINER", "Container", d.container]);
    um("MARCAS", "Marks", d.marcas);
    um("QUANTIDADE", "Quantity", d.volumes);
    um("NATUREZA DO PRODUTO", "Kind of product", ptDe(d.produto || ""));
    dois(["PESO LÍQUIDO", "Net weight", d.pesoLiquido], ["PESO BRUTO", "Gross weight", d.pesoBruto]);
    dois(["PROCEDÊNCIA", "Origin", ptDe(d.origem || "")], ["DESTINO", "Destination", d.destino]);
    if (o.tabela) um("CERTIFICADO MESTRE", "Master HT certificate", [...new Set(d.linhas.map((l) => l.certificado).filter(Boolean))].join("; "));
    um("PROGRAMAÇÃO / COMUNICADO", "Treatment notice", d.comunicado.replace(/Programa[çc][ãa]o MAPA\s*/gi, ""));
  }
  y += 8;

  if (o.geral && !o.tabela) {
    // Modelo padrão das declarações (todas as empresas menos a LG): sem a tabela de início/término,
    // só o certificado mestre (ciclo/lote), o mês do tratamento, a duração e o local.
    secao("TRATAMENTO", "TREATMENT");
    const comLote = mostrarLote(d.linhas);
    const mestres = [
      ...new Set(
        d.linhas.map((l) => {
          // Ciclo que é o código da curva (UR010972PR031026): "Lote 972 - UR010972PR031026" (Paletes Maringá).
          const codigo = /^[A-Z]{2}\d{6,}[A-Z0-9]*$/i.test(l.ciclo);
          const id = codigo
            ? [l.lote && `Lote ${l.lote}`, l.ciclo]
            : [l.ciclo && `Ciclo ${l.ciclo}`, comLote && l.lote && `Lote ${l.lote}`];
          return [...id, l.certificado, l.quantidade].filter(Boolean).join(" - ");
        })
      ),
    ].filter(Boolean);
    linhaCampo("CERTIFICADO MESTRE", "Master HT certificate", mestres.join("\n"));
    const per = periodoTratamento(d.linhas);
    linhaCampo("DATA DO TRATAMENTO", "Time of treatment", per.pt ? `${per.pt} / ${per.en}` : "");
    const mins = [...new Set(d.linhas.map((l) => minutosDe(l.duracao)).filter((n): n is number => n != null && n > 0))];
    linhaCampo("DURAÇÃO DO TRATAMENTO", "Duration of treatment", mins.map((m) => `${m} minutos / ${m} minutes`).join("; "));
    if (d.linhas.some((l) => l.tipo === "KD") && d.umidade.trim()) linhaCampo("UMIDADE CONTIDA", "Moisture", d.umidade);
    linhaCampo("LOCAL DO TRATAMENTO", "Place of treatment", d.localTratamento);
    y += 8;
  } else {
  // ---------- tabela do tratamento (LG) ----------
  const comCiclo = o.geral && d.linhas.some((l) => l.ciclo);
  // Vários ciclos com a quantidade de cada um na remessa (pedido "90 - Pallet Ciclo 0252 / 200 - … 0226").
  const comQtd = comCiclo && !!d.qtdPorCiclo;
  // Ciclo pelo código da curva e o lote ao lado (DR da Pinustan: "UR010655PR190726" | "1-655").
  const comLote = comCiclo && d.linhas.some((l) => l.lote && l.lote !== l.ciclo);
  const cols = (
    comLote && comQtd
      ? [0, 0.17, 0.25, 0.34, 0.42, 0.51, 0.68, 0.86, 1]
      : comLote
        ? [0, 0.18, 0.27, 0.37, 0.48, 0.67, 0.86, 1]
        : comQtd
          ? [0, 0.1, 0.22, 0.32, 0.43, 0.64, 0.85, 1]
          : comCiclo
            ? [0, 0.13, 0.25, 0.38, 0.62, 0.86, 1]
            : [0, 0.16, 0.34, 0.6, 0.86, 1]
  ).map((f) => ME + f * LARG);
  const topo = y;
  const hFaixa = 17;
  const hCab = 26;
  const hLin = 17;
  const linhas = d.linhas.length ? d.linhas : [{ certificado: "", ciclo: "", lote: "", inicio: "", fim: "", tipo: "HT" as const, temperatura: "56", duracao: "32 min" }];
  const hTotal = hFaixa + hCab + linhas.length * hLin + hLin;
  caixa(pg, ME, topo, LARG, hTotal, 5, { fundo: rgb(1, 1, 1) });
  caixa(pg, ME, topo, LARG, hFaixa, 5, { fundo: VERDE, soCima: true });
  centro(pg, "TRATAMENTO  ·  TREATMENT", A4.w / 2, topo + 5, b, 8.2, rgb(1, 1, 1));
  pg.drawRectangle({ x: ME, y: A4.h - topo - hFaixa - hCab, width: LARG, height: hCab, color: VERDE_CLARO });
  const cab: [string, string][] = [
    ...(comCiclo ? ([["Ciclo", "Cycle"]] as [string, string][]) : []),
    ...(comLote ? ([["Lote", "Lot"]] as [string, string][]) : []),
    ...(comQtd ? ([["Quantidade", "Quantity"]] as [string, string][]) : []),
    ["Tratamento", "Treatment"],
    ["Temperatura", "Temperature"],
    ["Início do tratamento", "Start of treatment"],
    ["Término do tratamento", "End of treatment"],
    ["Duração", "Treatment time"],
  ];
  cab.forEach(([pt, en], i) => {
    const cx = (cols[i] + cols[i + 1]) / 2;
    centro(pg, pt, cx, topo + hFaixa + 5, b, 7.6, TINTA);
    centro(pg, en, cx, topo + hFaixa + 14.5, it, 6.8, CINZA_TXT);
  });
  let yl = topo + hFaixa + hCab;
  const dh = (v: string) => v.replace(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}h\d{2}m)$/, "$1  ·  $2");
  linhas.forEach((l, k) => {
    if (k % 2 === 1) pg.drawRectangle({ x: ME, y: A4.h - yl - hLin, width: LARG, height: hLin, color: CINZA_FUNDO });
    const vals = [...(comCiclo ? [l.ciclo] : []), ...(comLote ? [l.lote] : []), ...(comQtd ? [l.quantidade ?? ""] : []), l.tipo, l.temperatura ? `${l.temperatura} °C` : "", dh(l.inicio), dh(l.fim), l.duracao];
    vals.forEach((v, i) => centro(pg, v || "—", (cols[i] + cols[i + 1]) / 2, yl + 5, i === (comCiclo ? 1 : 0) + (comLote ? 1 : 0) + (comQtd ? 1 : 0) ? b : r, 8.4, TINTA));
    linhaH(pg, ME, MD, yl, 0.4, CINZA_LINHA);
    yl += hLin;
  });
  linhaH(pg, ME, MD, yl, 0.4, CINZA_LINHA);
  for (const x of cols.slice(1, -1)) linhaV(pg, x, topo + hFaixa, yl, 0.4, CINZA_LINHA);
  texto(pg, "Local do tratamento / Place of treatment:", ME + 8, yl + 5, b, 7.6, TINTA);
  texto(pg, d.localTratamento, ME + 8 + largura(b, "Local do tratamento / Place of treatment:", 7.6) + 5, yl + 5, r, 8.2, TINTA);
  caixa(pg, ME, topo, LARG, hTotal, 5, { borda: VERDE, esp: 0.9 });
  y = topo + hTotal + 16;
  // KD (secagem): a umidade fica fora da tabela, como campo.
  if (o.geral && d.linhas.some((l) => l.tipo === "KD") && d.umidade.trim()) {
    linhaCampo("UMIDADE CONTIDA", "Moisture", d.umidade);
    y += 8;
  }
  }
  if (o.geral && !o.tabela) {
    const tt = textoTratamento(d);
    for (const [txt, f, cor, tam] of [
      [`Tratamento: ${tt.pt}`, r, TINTA, 8.2],
      [`Treatment: ${tt.en}`, it, CINZA_TXT, 7.6],
    ] as const) {
      for (const l of quebrar(f, txt, tam, LARG)) {
        texto(pg, l, ME, y, f, tam, cor);
        y += tam * 1.35;
      }
      y += 4;
    }
    y += 6;
  }

  // ---------- observação, local/data, assinatura ----------
  if (d.observacao.trim() || !o.geral) linhaCampo("OBSERVAÇÃO", "Remark", d.observacao.replace(/^Ref\.?\s*[àa]\s*NF-?e/i, "REF. A NFE"));
  const data = d.data.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] ?? d.data;
  linhaCampo("LOCAL E DATA", "Place and date", `${(d.localEmissao || "").replace(/\s*-\s*/, " – ")}${d.localEmissao ? " – BRAZIL, " : ""}${data}`);

  const cxAss = MD - 95;
  const yLinha = y + 62;
  if (assin) {
    const rot = ((a.rotAssinatura % 360) + 360) % 360;
    const { l, t, r: rr, b: bb } = a.recorte;
    const deitada = rot === 90 || rot === 270;
    // A assinatura ia até o nome do RT: limita a altura (Mann: 90 x 120 pt em pé) e assenta o pé
    // da imagem logo acima da linha.
    const esc = Math.min(1, 80 / (deitada ? a.quadro.w : a.quadro.h));
    const qw = a.quadro.w * esc;
    const qh = a.quadro.h * esc;
    const W = qw / Math.max(0.05, 1 - l - rr);
    const H = qh / Math.max(0.05, 1 - t - bb);
    const largPag = deitada ? qh : qw;
    const altPag = deitada ? qw : qh;
    const esq = cxAss - largPag / 2;
    // Em pé (Mann): a imagem tem margem branca embaixo, então desce até o traço encostar na linha.
    const base = A4.h - yLinha + (deitada ? 2 : -altPag * 0.05);
    if (rot === 270) pg.drawImage(assin, { x: esq + H - t * H, y: base - l * W, width: W, height: H, rotate: degrees(90) });
    else if (rot === 90) pg.drawImage(assin, { x: esq - (H - t * H - qh), y: base + W - l * W, width: W, height: H, rotate: degrees(-90) });
    else pg.drawImage(assin, { x: esq - l * W, y: base - (H - t * H - altPag), width: W, height: H });
  }
  linhaH(pg, cxAss - 90, cxAss + 90, yLinha, 0.7, TINTA);
  a.rt.forEach((linha, i) => centro(pg, linha, cxAss, yLinha + 4 + i * 10.5, i === 0 ? b : r, 8.2, i === 0 ? TINTA : CINZA_TXT));

  // ---------- rodapé ----------
  const yRod = A4.h - 40;
  linhaH(pg, ME, MD, yRod, 0.5, CINZA_LINHA);
  const ident = [a.nome, a.linhas.find(([e]) => /CNPJ/i.test(e))?.[0]].filter(Boolean).join("  ·  ");
  texto(pg, ident, ME, yRod + 6, r, 7, CINZA_TXT);
  const dir = `Emitido em ${data}  ·  Página 1/1`;
  texto(pg, dir, MD - largura(r, dir, 7), yRod + 6, r, 7, CINZA_TXT);
  return doc.save();
}

/**
 * Cor de destaque a partir do logo (no navegador): a cor viva que mais aparece, escurecida se
 * preciso para servir de texto. Sem logo ou só cinza: azul-ardósia.
 */
export async function corDoLogo(png: Uint8Array | null): Promise<[number, number, number]> {
  const padrao: [number, number, number] = [0.12, 0.23, 0.34];
  if (!png || typeof document === "undefined") return padrao;
  try {
    const bmp = await createImageBitmap(new Blob([png as BlobPart]));
    const c = document.createElement("canvas");
    const k = Math.min(1, 120 / Math.max(bmp.width, bmp.height));
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const baldes = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      const [r, gg, b] = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
      const max = Math.max(r, gg, b);
      const min = Math.min(r, gg, b);
      const l = (max + min) / 2;
      const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
      if (sat < 0.3 || l < 0.08 || l > 0.85) continue;
      let h = 0;
      if (max === r) h = ((gg - b) / (max - min)) % 6;
      else if (max === gg) h = (b - r) / (max - min) + 2;
      else h = (r - gg) / (max - min) + 4;
      const balde = Math.round(((h * 60 + 360) % 360) / 20);
      const x = baldes.get(balde) ?? { n: 0, r: 0, g: 0, b: 0 };
      x.n++;
      x.r += r;
      x.g += gg;
      x.b += b;
      baldes.set(balde, x);
    }
    const top = [...baldes.values()].sort((a, b) => b.n - a.n)[0];
    if (!top || top.n < 20) return padrao;
    let cor: [number, number, number] = [top.r / top.n, top.g / top.n, top.b / top.n];
    // Escurece até o contraste servir para texto sobre branco (luminância <= 0,25).
    const lum = (x: [number, number, number]) => 0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2];
    for (let i = 0; i < 10 && lum(cor) > 0.25; i++) cor = cor.map((v) => v * 0.85) as [number, number, number];
    return cor;
  } catch {
    return padrao;
  }
}

/** Completa o timbre com o cadastro quando o Word da empresa não tem a caixa de texto do cabeçalho. */
export function completarTimbre(
  a: AtivosModelo,
  e: { razaoSocial?: string; endereco?: string | null; cnpj?: string; crea?: string | null; email?: string | null; telefone?: string | null; regMapa?: string | null } | null,
  rtNome?: string | null
): AtivosModelo {
  if (!e) return a;
  return {
    ...a,
    nome: a.nome || e.razaoSocial || "",
    linhas: a.linhas.length
      ? a.linhas
      : ([
          [e.endereco ?? "", ""],
          [e.cnpj ? `CNPJ: ${e.cnpj}` : "", e.crea ? `Reg. CREA: ${e.crea}` : ""],
          [e.email ? `\u0001: ${e.email}` : "", e.telefone ? `\u0002: ${e.telefone}` : ""],
        ].filter(([x, y]) => x || y) as [string, string][]),
    registro: a.registro || (e.regMapa ? `REGISTRO MAPA ${e.regMapa}` : ""),
    rt: a.rt.length ? a.rt : [...(rtNome ? [rtNome] : []), "Responsável Técnico"],
  };
}
