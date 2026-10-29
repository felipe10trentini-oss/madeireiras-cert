// OCR das curvas que vêm como imagem dentro do PDF (Madeico CRG08 KDHT, Salamoni/Mahild).
// Só roda no servidor. Em vez de desenhar a página (o pdf.js conflita com o canvas
// dentro do Next), extrai a imagem embutida, amplia e lê com o Tesseract em português.
import "pdf-parse/worker";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { PDFParse } from "pdf-parse";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { lerCurva } from "./curvas";

/** Largura alvo da imagem para o OCR: o texto do cabeçalho fica legível. */
const LARGURA_OCR = 2200;

async function imagemDaPagina(buffer: Buffer): Promise<Buffer | null> {
  const parser = new PDFParse({ data: buffer });
  try {
    const r = await parser.getImage({ imageBuffer: true, first: 1 });
    const imagens = r.pages.flatMap((p) => p.images).filter((i) => i.data?.length);
    if (!imagens.length) return await paginaDesenhada(parser);
    // A de cabeçalho/tabela é a mais alta; o gráfico é mais largo que alto.
    const img = imagens.sort((a, b) => b.height - a.height)[0];
    return Buffer.from(img.data);
  } finally {
    await parser.destroy();
  }
}

/**
 * PDF sem imagem e sem texto: as letras são desenhadas como vetores (SV520 Power-View
 * "impresso" em PDF). Desenha a página em alta resolução (~2500 px de largura) para o OCR.
 */
async function paginaDesenhada(parser: PDFParse): Promise<Buffer | null> {
  try {
    const r = await parser.getScreenshot({ first: 1, scale: 3, imageBuffer: true, imageDataUrl: false });
    const pg = r.pages[0];
    return pg?.data?.length ? Buffer.from(pg.data) : null;
  } catch (err) {
    console.error("Falha ao desenhar a página para o OCR", err);
    return null;
  }
}

function ampliar(img: Image): Buffer {
  const escala = Math.max(1, LARGURA_OCR / img.width);
  const canvas = createCanvas(Math.round(img.width * escala), Math.round(img.height * escala));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer("image/png");
}

/**
 * Relatório Mahild: a imagem tem baixa resolução e o quadro de dados (LOTE, INICIO,
 * FIM, PRODUCTO...) tem linhas de tabela encostando no texto. Recorta o quadro,
 * amplia 5x, passa para preto e branco e apaga as linhas longas antes do OCR.
 */
function quadroMahild(img: Image): Buffer {
  const esc = 5;
  const sy = img.height * 0.385;
  const sw = img.width * 0.62;
  const sh = img.height * 0.085;
  const c = createCanvas(Math.round(sw * esc), Math.round(sh * esc));
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, sy, sw, sh, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const W = c.width;
  const H = c.height;
  const preto = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const g = 0.3 * d.data[i * 4] + 0.59 * d.data[i * 4 + 1] + 0.11 * d.data[i * 4 + 2];
    preto[i] = g < 150 ? 1 : 0;
  }
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += preto[y * W + x];
    if (s > W * 0.45) for (let x = 0; x < W; x++) preto[y * W + x] = 0;
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) s += preto[y * W + x];
    if (s > H * 0.6) for (let y = 0; y < H; y++) preto[y * W + x] = 0;
  }
  for (let i = 0; i < W * H; i++) {
    const v = preto[i] ? 0 : 255;
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v;
    d.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c.toBuffer("image/png");
}

async function ler(worker: Worker, png: Buffer, psm: PSM): Promise<string> {
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  return (await worker.recognize(png)).data.text;
}

/**
 * Print/foto de um pedaço do DANFE (quadros com rótulos pequenos, às vezes com marca-texto por cima do
 * nome): amplia para ~2600 px, clareia o marca-texto (cinza pelo verde, que o rosa/amarelo não escurecem)
 * e lê como um bloco só — assim cada linha de valores sai inteira ("TRENIER GRAFICA … S/A 85.021.657/0001-98").
 */
export async function ocrNota(buffer: Buffer): Promise<string> {
  const img = await loadImage(buffer);
  const escala = Math.max(1, Math.min(4, 2600 / img.width));
  const canvas = createCanvas(Math.round(img.width * escala), Math.round(img.height * escala));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const g = Math.max(d.data[i + 1], Math.min(d.data[i], d.data[i + 1], d.data[i + 2]));
    d.data[i] = d.data[i + 1] = d.data[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  const worker = await createWorker("por", undefined, { langPath: path.join(process.cwd(), "ocr"), gzip: true, cachePath: os.tmpdir() });
  try {
    return await ler(worker, canvas.toBuffer("image/png"), PSM.SINGLE_BLOCK);
  } finally {
    await worker.terminate();
  }
}

/**
 * Texto de uma imagem solta (print do WhatsApp, foto do pedido do cliente) para o comunicado: amplia e,
 * se o fundo for escuro (WhatsApp no modo escuro), inverte as cores antes de ler.
 */
export async function ocrImagem(buffer: Buffer): Promise<string> {
  const img = await loadImage(buffer);
  const escala = Math.max(1, Math.min(3, 1800 / img.width));
  const canvas = createCanvas(Math.round(img.width * escala), Math.round(img.height * escala));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let soma = 0;
  for (let i = 0; i < d.data.length; i += 4 * 16) soma += (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
  if (soma / (d.data.length / (4 * 16)) < 110) {
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = 255 - d.data[i];
      d.data[i + 1] = 255 - d.data[i + 1];
      d.data[i + 2] = 255 - d.data[i + 2];
    }
    ctx.putImageData(d, 0, 0);
  }
  const worker = await createWorker("por", undefined, {
    langPath: path.join(process.cwd(), "ocr"),
    gzip: true,
    cachePath: os.tmpdir(),
  });
  try {
    return await ler(worker, canvas.toBuffer("image/png"), PSM.AUTO);
  } finally {
    await worker.terminate();
  }
}

/**
 * Tabela em imagem (print de e-mail/planilha do cliente: "Booking | Origem | Destino | Cliente | Invoice…"):
 * o cabeçalho é a faixa escura do topo; as colunas são separadas pelas linhas claras dentro dela e as linhas
 * da tabela pelas linhas de grade do corpo. Cada célula é lida à parte (bem mais confiável que a imagem
 * inteira). Devolve "Título | Título…" e "valor | valor…", ou null quando a imagem não parece uma tabela.
 */
export async function ocrTabela(buffer: Buffer): Promise<string | null> {
  const img = await loadImage(buffer);
  const escala = Math.max(1, Math.min(3, 2400 / img.width));
  const W = Math.round(img.width * escala);
  const H = Math.round(img.height * escala);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const lum = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return (d[i] + d[i + 1] + d[i + 2]) / 3;
  };
  // Cabeçalho: a primeira faixa de linhas de pixels escura (a maior parte dos pixels < 120; pela média, a
  // linha que corta as letras brancas do título parecia clara e o cabeçalho acabava no meio).
  const fracao = (y: number, f: (l: number) => boolean) => {
    let n = 0;
    for (let x = 0; x < W; x += 3) if (f(lum(x, y))) n++;
    return n / Math.ceil(W / 3);
  };
  let ini = 0;
  while (ini < H && fracao(ini, (l) => l < 120) <= 0.55) ini++;
  // Acaba quando a linha fica quase toda clara (o corpo da tabela); as letras brancas não contam.
  let fim = ini;
  while (fim < H && fracao(fim, (l) => l > 200) < 0.7) fim++;
  if (ini >= H || fim - ini < 12 * escala) return null;
  // Colunas: dentro do cabeçalho, as colunas de pixels quase todas claras são os separadores.
  const sep: boolean[] = [];
  for (let x = 0; x < W; x++) {
    let claros = 0;
    for (let y = ini; y < fim; y += 2) if (lum(x, y) > 170) claros++;
    sep.push(claros / Math.ceil((fim - ini) / 2) > 0.85);
  }
  const cols: [number, number][] = [];
  let x = 0;
  while (x < W) {
    while (x < W && sep[x]) x++;
    const a = x;
    while (x < W && !sep[x]) x++;
    if (x - a > 25 * escala) cols.push([a, x]);
  }
  if (cols.length < 4) return null;
  // Linhas do corpo: linhas de grade horizontais (escuras/cinzas na maior parte da largura da tabela).
  const xa = cols[0][0];
  const xb = cols[cols.length - 1][1];
  const grade = (y: number) => {
    let esc = 0;
    for (let x2 = xa; x2 < xb; x2 += 3) if (lum(x2, y) < 215) esc++;
    return esc / Math.ceil((xb - xa) / 3) > 0.7;
  };
  const cortes: number[] = [];
  for (let y = fim + 4; y < H; y++) if (grade(y) && (!cortes.length || y - cortes[cortes.length - 1] > 10 * escala)) cortes.push(y);
  const limitesLinhas: [number, number][] = [];
  let topo = fim;
  for (const c of cortes) {
    if (c - topo > 14 * escala) limitesLinhas.push([topo, c]);
    topo = c;
  }
  if (!cortes.length) {
    if (H - topo > 14 * escala) limitesLinhas.push([topo, H]);
  } else {
    // Última linha sem grade embaixo (a tabela acaba no fundo branco do e-mail): vai até o branco.
    const branca = (y: number) => {
      for (let x2 = xa; x2 < xb; x2 += 3) if (lum(x2, y) < 245) return false;
      return true;
    };
    let fimTabela = topo;
    while (fimTabela < H && !branca(fimTabela)) fimTabela++;
    if (fimTabela - topo > 14 * escala) limitesLinhas.push([topo, fimTabela]);
  }
  if (!limitesLinhas.length) return null;

  const worker = await createWorker("por", undefined, { langPath: path.join(process.cwd(), "ocr"), gzip: true, cachePath: os.tmpdir() });
  const ler1 = async (x0: number, y0: number, x1: number, y1: number, inverter: boolean) => {
    const m = 3;
    const c = createCanvas(x1 - x0 - 2 * m + 40, y1 - y0 - 2 * m + 40);
    const k = c.getContext("2d");
    k.fillStyle = inverter ? "#000" : "#fff";
    k.fillRect(0, 0, c.width, c.height);
    k.drawImage(canvas, x0 + m, y0 + m, x1 - x0 - 2 * m, y1 - y0 - 2 * m, 20, 20, x1 - x0 - 2 * m, y1 - y0 - 2 * m);
    if (inverter) {
      const id = k.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < id.data.length; i += 4) {
        id.data[i] = 255 - id.data[i];
        id.data[i + 1] = 255 - id.data[i + 1];
        id.data[i + 2] = 255 - id.data[i + 2];
      }
      k.putImageData(id, 0, 0);
    }
    return (await worker.recognize(c.toBuffer("image/png"))).data.text.replace(/\s+/g, " ").replace(/[|“”"]/g, "").trim();
  };
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const titulos: string[] = [];
    for (const [a, b] of cols) titulos.push(await ler1(a, ini, b, fim, true));
    const linhas: string[] = [];
    for (const [y0, y1] of limitesLinhas) {
      const vals: string[] = [];
      for (const [a, b] of cols) vals.push(await ler1(a, y0, b, y1, false));
      if (vals.some(Boolean)) linhas.push(vals.join(" | "));
    }
    return [titulos.join(" | "), ...linhas].join("\n");
  } finally {
    await worker.terminate();
  }
}

/**
 * Print de planilha com grade (TLP: "TRATAMENTO HT DIA: | 29/10/26 | HORA: | 12:00:00", "CLIENTE | CAIXA |
 * ENG | PALLET…", "TOTAL | 28 | 0 | 5…"): acha as linhas pretas da grade (horizontais na tabela toda; as
 * verticais dentro de cada faixa, porque há células mescladas) e lê cada célula à parte. O texto acima da
 * grade ("1º TRATAMENTO") vem como primeira linha. Devolve "a | b | c" por linha, ou null sem grade.
 */
export async function ocrGrade(buffer: Buffer): Promise<string | null> {
  const img = await loadImage(buffer);
  const escala = Math.max(1, Math.min(4, 2400 / img.width));
  const W = Math.round(img.width * escala);
  const H = Math.round(img.height * escala);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const escuro = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return d[i] + d[i + 1] + d[i + 2] < 3 * 100;
  };
  // Linhas horizontais: a maior parte da largura escura.
  const linhaH = (y: number) => {
    let n = 0;
    for (let x = 0; x < W; x += 2) if (escuro(x, y)) n++;
    return n / Math.ceil(W / 2) > 0.6;
  };
  const agrupar = (marcas: boolean[]) => {
    const out: [number, number][] = [];
    for (let i = 0; i < marcas.length; i++) {
      if (!marcas[i]) continue;
      const a = i;
      while (i < marcas.length && marcas[i]) i++;
      out.push([a, i]);
    }
    return out;
  };
  const hs = agrupar(Array.from({ length: H }, (_, y) => linhaH(y)));
  if (hs.length < 3) return null;
  const faixas: [number, number][] = [];
  for (let k = 0; k + 1 < hs.length; k++) if (hs[k + 1][0] - hs[k][1] > 10 * escala) faixas.push([hs[k][1], hs[k + 1][0]]);
  if (faixas.length < 2) return null;

  const worker = await createWorker("por", undefined, { langPath: path.join(process.cwd(), "ocr"), gzip: true, cachePath: os.tmpdir() });
  const ler1 = async (x0: number, y0: number, x1: number, y1: number) => {
    const m = Math.round(2 * escala);
    const w = x1 - x0 - 2 * m;
    const h = y1 - y0 - 2 * m;
    if (w < 6 || h < 6) return "";
    // Célula sem tinta (só a cor de fundo): vazia, sem gastar OCR.
    let tinta = 0;
    for (let y = y0 + m; y < y1 - m; y += 2) for (let x = x0 + m; x < x1 - m; x += 2) if (escuro(x, y)) tinta++;
    if (tinta < 8) return "";
    const c = createCanvas(w + 40, h + 40);
    const k = c.getContext("2d");
    k.fillStyle = "#fff";
    k.fillRect(0, 0, c.width, c.height);
    k.drawImage(canvas, x0 + m, y0 + m, w, h, 20, 20, w, h);
    // Fundo colorido (amarelo/laranja) vira branco: só o texto escuro fica.
    const id = k.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = id.data[i] + id.data[i + 1] + id.data[i + 2] < 3 * 140 ? 0 : 255;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    }
    k.putImageData(id, 0, 0);
    return (await worker.recognize(c.toBuffer("image/png"))).data.text.replace(/\s+/g, " ").replace(/[|“”"]/g, "").trim();
  };
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const linhas: string[] = [];
    if (hs[0][0] > 10 * escala) {
      const t = await ler1(0, 0, W, hs[0][0]);
      if (t) linhas.push(t);
    }
    for (const [y0, y1] of faixas) {
      // Verticais desta faixa: colunas de pixels escuras em quase toda a altura.
      const vs = agrupar(
        Array.from({ length: W }, (_, x) => {
          let n = 0;
          for (let y = y0; y < y1; y++) if (escuro(x, y)) n++;
          return n / (y1 - y0) > 0.85;
        })
      );
      const vals: string[] = [];
      for (let k = 0; k + 1 < vs.length; k++) if (vs[k + 1][0] - vs[k][1] > 8 * escala) vals.push(await ler1(vs[k][1], y0, vs[k + 1][0], y1));
      if (vals.some(Boolean)) linhas.push(vals.join(" | "));
    }
    return linhas.length >= 2 ? linhas.join("\n") : null;
  } finally {
    await worker.terminate();
  }
}

export async function ocrPrimeiraPagina(buffer: Buffer): Promise<string> {
  const png = await imagemDaPagina(buffer);
  if (!png) return "";
  const img = await loadImage(png);

  // O idioma vai junto com o site (ocr/por.traineddata.gz): não baixa a cada início a frio
  // na Vercel, onde só /tmp é gravável para o cache.
  const worker = await createWorker("por", undefined, {
    langPath: path.join(process.cwd(), "ocr"),
    gzip: true,
    cachePath: os.tmpdir(),
  });
  try {
    // Mahild (Salamoni): o quadro de dados basta e é uma leitura pequena — tenta primeiro,
    // para não estourar o tempo limite lendo a página inteira.
    const quadro = await ler(worker, quadroMahild(img), PSM.SINGLE_BLOCK);
    const mahild = /LOTE\s*\(?\s*UR|TOTAL\s*CICLO|PRODUCTO/i.test(quadro);
    if (mahild && lerCurva(quadro)?.cicloInicio) return quadro;
    const geral = await ler(worker, ampliar(img), PSM.AUTO);
    if (mahild || /LOTE\s*\(?\s*UR|Bulbo|Relat[óo]rio de:?\s*Secagem/i.test(geral)) {
      // Mahild: o quadro lido à parte vem primeiro (é onde o leitor procura os campos).
      return `${quadro}\n${geral}`;
    }
    return geral;
  } finally {
    await worker.terminate();
  }
}
