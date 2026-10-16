// PDF da declaração de tratamento (modelo fixo, sem Word): timbre com logo e dados do cadastro,
// marca-d'água com o logo, tabelas bilíngues, assinatura e linhas do RT. Logo e assinatura vêm
// da pasta privada "declaracoes" do Supabase (api/declaracoes/ativos). Roda no navegador.
import { PDFDocument, StandardFonts, rgb, setWordSpacing, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { dataExtenso, INTRO, linhasRemessa, linhasTratamento, mostrarLote, textoTratamento, type DadosDeclaracao, type ItemTabela } from "./declaracao";

export interface Timbre {
  razao: string;
  linhas: string[]; // endereço, CNPJ/CREA, contato
  regMapa: string;
  logo?: string | null; // data URL PNG
  assinatura?: string | null;
  rt: string[]; // linhas abaixo da assinatura
}

const hex = (h: string) => rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
const COR = hex("1F3B57");
const CINZA = hex("5B6573");
const LINHA = hex("C9D1DA");
const FUNDO = hex("EEF2F6");
const TEXTO = hex("1D2733");

const A4: [number, number] = [595.28, 841.89];
const ME = 45; // margens laterais
const LARG = A4[0] - 2 * ME;

interface Fontes {
  r: PDFFont;
  b: PDFFont;
  i: PDFFont;
  bi: PDFFont;
}

interface Seg {
  t: string;
  f: PDFFont;
  cor?: ReturnType<typeof rgb>;
  tam?: number;
}

function bytesDe(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Só caracteres que a fonte padrão (WinAnsi) desenha. */
function limpo(f: PDFFont, s: string): string {
  let out = "";
  for (const ch of s.replace(/\t/g, " ")) {
    try {
      f.encodeText(ch);
      out += ch;
    } catch {
      out += ch === " " ? " " : "-";
    }
  }
  return out;
}

class Pagina {
  y: number;
  constructor(
    public pg: PDFPage,
    public f: Fontes
  ) {
    this.y = A4[1];
  }

  /** Quebra os segmentos em linhas de largura `w`. */
  linhas(segs: Seg[], w: number, tam: number): Seg[][][] {
    const palavras: Seg[][] = [];
    for (const s of segs) {
      const partes = limpo(s.f, s.t).split(/(\s+)/);
      for (const p of partes) {
        if (!p) continue;
        if (/^\s+$/.test(p)) palavras.push([{ ...s, t: " " }]);
        else {
          const ult = palavras[palavras.length - 1];
          // Junta com a palavra anterior se não houve espaço (troca de fonte no meio da palavra).
          if (ult && ult[ult.length - 1].t !== " " && palavras.length) ult.push({ ...s, t: p });
          else palavras.push([{ ...s, t: p }]);
        }
      }
    }
    const larg = (ws: Seg[][]) => ws.reduce((a, wd) => a + wd.reduce((b, s) => b + s.f.widthOfTextAtSize(s.t, s.tam ?? tam), 0), 0);
    const out: Seg[][][] = [];
    let atual: Seg[][] = [];
    for (const wd of palavras) {
      if (wd[0].t === " " && !atual.length) continue;
      if (atual.length && larg([...atual, wd]) > w && wd[0].t !== " ") {
        while (atual.length && atual[atual.length - 1][0].t === " ") atual.pop();
        out.push(atual);
        atual = [wd];
      } else atual.push(wd);
    }
    while (atual.length && atual[atual.length - 1][0].t === " ") atual.pop();
    if (atual.length) out.push(atual);
    return out;
  }

  /** Desenha um parágrafo a partir de `y` (topo) e devolve a altura usada. */
  paragrafo(segs: Seg[], x: number, y: number, w: number, tam: number, alinhar: "left" | "right" | "center" | "justify" = "left", lh = 1.28, desenhar = true): number {
    const ls = this.linhas(segs, w, tam);
    const passo = tam * lh;
    ls.forEach((linha, n) => {
      if (!desenhar) return;
      const ws = linha.map((wd) => wd.reduce((b, s) => b + s.f.widthOfTextAtSize(s.t, s.tam ?? tam), 0));
      const total = ws.reduce((a, b) => a + b, 0);
      const espacos = linha.filter((wd) => wd[0].t === " ").length;
      const justifica = alinhar === "justify" && n < ls.length - 1 && espacos > 0;
      const extra = justifica ? (w - total) / espacos : 0;
      let cx = alinhar === "right" ? x + w - total : alinhar === "center" ? x + (w - total) / 2 : x;
      const base = y - tam - n * passo + tam * 0.18;
      // Trechos com a mesma fonte vão num drawText só (com os espaços): o leitor de PDF desenha os
      // espaços com a própria métrica e nada gruda. Justificado: espaçamento entre palavras (Tw).
      const runs: { t: string; s: Seg }[] = [];
      for (const s of linha.flat()) {
        const ult = runs[runs.length - 1];
        if (ult && ult.s.f === s.f && (ult.s.tam ?? tam) === (s.tam ?? tam) && ult.s.cor === s.cor) ult.t += s.t;
        else runs.push({ t: s.t, s });
      }
      for (const run of runs) {
        const t = run.s.tam ?? tam;
        if (extra) this.pg.pushOperators(setWordSpacing(extra));
        this.pg.drawText(run.t, { x: cx, y: base, size: t, font: run.s.f, color: run.s.cor ?? TEXTO });
        if (extra) this.pg.pushOperators(setWordSpacing(0));
        cx += run.s.f.widthOfTextAtSize(run.t, t) + extra * (run.t.match(/ /g)?.length ?? 0);
      }
    });
    return ls.length * passo;
  }

  texto(segs: Seg[], tam: number, alinhar: "left" | "right" | "center" | "justify" = "left", antes = 0, depois = 0, lh = 1.28) {
    this.y -= antes;
    this.y -= this.paragrafo(segs, ME, this.y, LARG, tam, alinhar, lh);
    this.y -= depois;
  }

  linha(y: number, cor = LINHA, esp = 0.5, x1 = ME, x2 = ME + LARG) {
    this.pg.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: esp, color: cor });
  }
}

const rotulo = (f: Fontes, l: { pt: string; en: string }): Seg[] => [
  { t: l.pt, f: f.b, tam: 8.3 },
  ...(l.en.toLowerCase() !== l.pt.toLowerCase() ? [{ t: ` / ${l.en}`, f: f.i, cor: CINZA, tam: 7.4 }] : []),
];

function faixa(p: Pagina, pt: string, en: string) {
  const h = 14;
  p.pg.drawRectangle({ x: ME, y: p.y - h, width: LARG, height: h, color: FUNDO });
  p.linha(p.y);
  p.paragrafo([{ t: pt.toUpperCase(), f: p.f.b, cor: COR }, { t: `  ·  ${en.toUpperCase()}`, f: p.f.i, cor: CINZA, tam: 7.4 }], ME + 5, p.y - 2.5, LARG - 10, 8.2);
  p.y -= h;
}

/** Tabela rótulo | valor | rótulo | valor (campo sozinho ocupa a linha). */
function tabela(p: Pagina, titulo: [string, string], grupos: ItemTabela[][]) {
  if (!grupos.length) return;
  faixa(p, titulo[0], titulo[1]);
  const c = [LARG * 0.19, LARG * 0.31, LARG * 0.17, LARG * 0.33];
  const pad = 4;
  const tam = 8.8;
  for (const g of grupos) {
    const celulas: { x: number; w: number; segs: Seg[]; t: number }[] = [];
    let x = ME;
    celulas.push({ x, w: c[0], segs: rotulo(p.f, g[0]), t: 8.3 });
    x += c[0];
    const v1 = g.length === 1 ? c[1] + c[2] + c[3] : c[1];
    celulas.push({ x, w: v1, segs: [{ t: g[0].v, f: p.f.r }], t: tam });
    x += v1;
    if (g[1]) {
      celulas.push({ x, w: c[2], segs: rotulo(p.f, g[1]), t: 8.3 });
      celulas.push({ x: x + c[2], w: c[3], segs: [{ t: g[1].v, f: p.f.r }], t: tam });
    }
    // Valores com várias linhas ("250 PALETES…\n100 ESTRADO…"): um parágrafo por linha.
    const altura = (cel: (typeof celulas)[number], desenhar: boolean, y = 0) =>
      cel.segs.length === 1
        ? cel.segs[0].t.split("\n").reduce((h, t) => h + p.paragrafo([{ ...cel.segs[0], t }], cel.x + pad, y - h, cel.w - 2 * pad, cel.t, "left", 1.22, desenhar), 0)
        : p.paragrafo(cel.segs, cel.x + pad, y, cel.w - 2 * pad, cel.t, "left", 1.22, desenhar);
    const h = Math.max(...celulas.map((cel) => altura(cel, false))) + 2 * pad - 1;
    for (const cel of celulas) {
      const hc = altura(cel, false);
      altura(cel, true, p.y - (h - hc) / 2);
    }
    p.y -= h;
    p.linha(p.y);
  }
}

function tabelaCiclos(p: Pagina, d: DadosDeclaracao) {
  if (!d.linhas.length) return;
  const kd = d.linhas.some((l) => l.tipo === "KD");
  type L = DadosDeclaracao["linhas"][number];
  const cols: [string, string, (l: L) => string, number][] = [
    ["Ciclo", "Cycle", (l) => l.ciclo, 15],
    ...(mostrarLote(d.linhas) ? ([["Lote", "Batch", (l: L) => l.lote, 11]] as [string, string, (l: L) => string, number][]) : []),
    ["Início", "Start", (l) => l.inicio, 18],
    ["Término", "End", (l) => l.fim, 18],
    ["Trat.", "Treat.", (l) => l.tipo, 8],
    ["Temp. mín.", "Min. temp.", (l) => (l.temperatura ? `${l.temperatura} °C` : ""), 11],
    ["Duração", "Duration", (l) => l.duracao, 11],
    ...(kd ? ([["Umid. máx.", "Max. moist.", (l: L) => (l.tipo === "KD" ? d.umidade : "-"), 11]] as [string, string, (l: L) => string, number][]) : []),
    ...(d.linhas.some((l) => l.quantidade) ? ([["Qtd.", "Qty.", (l: L) => l.quantidade ?? "", 9]] as [string, string, (l: L) => string, number][]) : []),
  ];
  const soma = cols.reduce((a, c) => a + c[3], 0);
  const ws = cols.map((c) => (LARG * c[3]) / soma);
  faixa(p, "Ciclos de tratamento", "Treatment cycles");
  const linhaTabela = (segs: (i: number) => Seg[], tam: number) => {
    const pad = 3.5;
    let x = ME;
    const alts = cols.map((_, i) => p.paragrafo(segs(i), 0, 0, ws[i] - 2 * pad, tam, "center", 1.2, false));
    const h = Math.max(...alts) + 2 * pad;
    cols.forEach((_, i) => {
      p.paragrafo(segs(i), x + pad, p.y - (h - alts[i]) / 2, ws[i] - 2 * pad, tam, "center", 1.2);
      x += ws[i];
    });
    p.y -= h;
    p.linha(p.y);
  };
  linhaTabela((i) => [{ t: cols[i][0], f: p.f.b, tam: 7.8 }, { t: ` / ${cols[i][1]}`, f: p.f.i, cor: CINZA, tam: 7 }], 7.8);
  for (const l of d.linhas) linhaTabela((i) => [{ t: cols[i][2](l) || "-", f: p.f.r }], 8.4);
}

async function imagem(doc: PDFDocument, dataUrl?: string | null): Promise<PDFImage | null> {
  if (!dataUrl) return null;
  try {
    return await doc.embedPng(bytesDe(dataUrl));
  } catch {
    return null;
  }
}

export async function gerarDeclaracaoPdf(d: DadosDeclaracao, timbre: Timbre): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Declaração de tratamento fitossanitário");
  doc.setAuthor(timbre.razao);
  const f: Fontes = {
    r: await doc.embedFont(StandardFonts.Helvetica),
    b: await doc.embedFont(StandardFonts.HelveticaBold),
    i: await doc.embedFont(StandardFonts.HelveticaOblique),
    bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const logo = await imagem(doc, timbre.logo);
  const assinatura = await imagem(doc, timbre.assinatura);
  const p = new Pagina(doc.addPage(A4), f);

  // Marca-d'água: o logo bem claro no centro da página.
  if (logo) {
    const w = 300;
    const h = (logo.height / logo.width) * w;
    p.pg.drawImage(logo, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2 - 20, width: w, height: h, opacity: 0.06 });
  }

  // ---------- timbre ----------
  const topo = A4[1] - 36;
  const hLogo = 58;
  let xTxt = ME;
  if (logo) {
    const wLogo = (logo.width / logo.height) * hLogo;
    p.pg.drawImage(logo, { x: ME, y: topo - hLogo, width: wLogo, height: hLogo });
    xTxt = ME + wLogo + 16;
  }
  let yt = topo;
  yt -= p.paragrafo([{ t: timbre.razao, f: f.b, cor: COR }], xTxt, yt, ME + LARG - xTxt, 14, "left", 1.2);
  for (const l of timbre.linhas.filter(Boolean)) yt -= p.paragrafo([{ t: l, f: f.r, cor: CINZA }], xTxt, yt - 1, ME + LARG - xTxt, 8.6, "left", 1.3);
  if (timbre.regMapa) yt -= p.paragrafo([{ t: "Registro MAPA ", f: f.b, cor: COR }, { t: timbre.regMapa, f: f.b, cor: TEXTO }], xTxt, yt - 1, ME + LARG - xTxt, 8.6, "left", 1.3);
  p.y = Math.min(topo - hLogo, yt) - 8;
  p.linha(p.y, COR, 1.4);
  p.y -= 14;

  // ---------- corpo ----------
  p.texto([{ t: "DECLARAÇÃO DE TRATAMENTO FITOSSANITÁRIO", f: f.b, cor: COR }], 14.5, "center");
  p.texto([{ t: "Declaration of Phytosanitary Treatment", f: f.i, cor: CINZA }], 10.5, "center", 1, 9);
  p.texto([{ t: INTRO.pt, f: f.r }], 8.8, "justify");
  p.texto([{ t: INTRO.en, f: f.i, cor: CINZA }], 8.3, "justify", 1, 8);
  tabela(p, ["1. Dados da remessa", "Consignment details"], linhasRemessa(d));
  p.y -= 7;
  tabela(p, ["2. Dados do tratamento", "Treatment details"], linhasTratamento(d));
  p.y -= 7;
  tabelaCiclos(p, d);
  const trat = textoTratamento(d);
  p.texto([{ t: "Tratamento: ", f: f.b }, { t: trat.pt, f: f.r }], 8.8, "justify", 9, 2);
  p.texto([{ t: "Treatment: ", f: f.bi, cor: CINZA }, { t: trat.en, f: f.i, cor: CINZA }], 8.3, "justify", 0, 3);
  if (d.observacao.trim()) p.texto([{ t: "Observações / ", f: f.b }, { t: "Remarks: ", f: f.bi, cor: CINZA }, { t: d.observacao.trim(), f: f.r }], 8.8, "left", 2);
  const data = dataExtenso(d.data);
  const local = d.localEmissao.trim();
  p.texto([{ t: `${local ? `${local}, ` : ""}${data.pt}`, f: f.r }, { t: ` / ${data.en}`, f: f.i, cor: CINZA, tam: 8.3 }], 8.8, "right", 10);

  // ---------- assinatura ----------
  const wBloco = 190;
  const xBloco = ME + LARG - wBloco;
  p.y -= 8;
  if (assinatura) {
    const wa = 112;
    const ha = (assinatura.height / assinatura.width) * wa;
    p.pg.drawImage(assinatura, { x: xBloco + (wBloco - wa) / 2, y: p.y - ha, width: wa, height: ha });
    p.y -= ha - 8; // a rubrica passa um pouco da linha, como no papel
  } else p.y -= 34;
  p.linha(p.y, CINZA, 0.6, xBloco, xBloco + wBloco);
  p.y -= 3;
  timbre.rt.filter(Boolean).forEach((l, i) => {
    p.y -= p.paragrafo([{ t: l, f: i === 0 ? f.b : f.r }], xBloco, p.y, wBloco, 8.6, "center", 1.3);
  });

  // ---------- rodapé ----------
  p.linha(40, LINHA, 0.6);
  p.paragrafo([{ t: [timbre.razao, timbre.linhas[0]].filter(Boolean).join("  ·  "), f: f.r, cor: CINZA }], ME, 36, LARG, 7.2, "center");

  return doc.save();
}
