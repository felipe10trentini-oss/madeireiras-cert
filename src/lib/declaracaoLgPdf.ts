// PDF da declaração da LG direto do site, no layout do Word dela (protótipo): timbre com logo e
// dados, marca-d'água, título em duas linhas, "DESCRIÇÃO DA REMESSA", campos em maiúsculas,
// tabela do tratamento, local/data e assinatura do RT. Logo, marca-d'água, assinatura e os textos
// do timbre vêm do Word modelo guardado na pasta privada (nada disso fica no código).
import fontkit from "@pdf-lib/fontkit";
import JSZip from "jszip";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { DadosDeclaracao } from "./declaracao";

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
    const marcaId = xml.match(/<v:imagedata r:id="(\w+)"/)?.[1];
    if (logoId && !out.logo) out.logo = await bin(`word/${alvo(logoId)}`);
    if (marcaId && !out.marca) out.marca = await bin(`word/${alvo(marcaId)}`);
    for (const cx of xml.match(/<w:txbxContent>[\s\S]*?<\/w:txbxContent>/g) ?? []) {
      const ps = paragrafos(cx).map((t) => t.trim()).filter(Boolean);
      if (ps.some((t) => /REGISTRO\s*MAPA/i.test(t))) out.registro ||= ps.find((t) => /REGISTRO\s*MAPA/i.test(t))!;
      else if (ps.length >= 3 && !out.nome) {
        out.nome = ps[0];
        out.linhas = ps.slice(1).map((t) => {
          const [a, ...b] = t.split(/\t+|\s{3,}/);
          return [a.trim(), b.join(" ").trim()];
        });
      }
    }
  }
  const doc = (await ler("word/document.xml")).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  const rels = await ler("word/_rels/document.xml.rels");
  const anc = [...doc.matchAll(/<wp:anchor\b[\s\S]*?<\/wp:anchor>/g)].map((m) => m[0]).find((a) => /<a:blip r:embed=/.test(a) && !/positionV relativeFrom="paragraph">\s*<wp:posOffset>[3-9]\d{6}/.test(a));
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

function linhaV(pg: PDFPage, x: number, y1: number, y2: number, esp = 0.6) {
  pg.drawLine({ start: { x, y: A4.h - y1 }, end: { x, y: A4.h - y2 }, thickness: esp, color: PRETO });
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
}

/** Fontes embutidas no PDF (public/fontes): o texto sai igual em qualquer leitor de PDF. */
export async function baixarFontes(base = ""): Promise<FontesPdf> {
  const get = async (n: string) => new Uint8Array(await (await fetch(`${base}/fontes/${n}`)).arrayBuffer());
  const [r, b, ti] = await Promise.all([get("arimo-latin-400-normal.woff"), get("arimo-latin-700-normal.woff"), get("tinos-latin-400-italic.woff")]);
  return { r, b, ti };
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
    const w = 330;
    const h = (marca.height / marca.width) * w;
    pg.drawImage(marca, { x: (A4.w - w) / 2 + 10, y: A4.h - 300 - h, width: w, height: h, opacity: 0.16 });
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
