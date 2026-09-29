// OCR das curvas que vêm como imagem dentro do PDF (Madeico CRG08 KDHT, Salamoni/Mahild).
// Só roda no servidor. Em vez de desenhar a página (o pdf.js conflita com o canvas
// dentro do Next), extrai a imagem embutida, amplia e lê com o Tesseract em português.
import "pdf-parse/worker";
import os from "node:os";
import { createCanvas, loadImage, type Image } from "@napi-rs/canvas";
import { PDFParse } from "pdf-parse";
import { createWorker, PSM, type Worker } from "tesseract.js";

/** Largura alvo da imagem para o OCR: o texto do cabeçalho fica legível. */
const LARGURA_OCR = 2200;

async function imagemDaPagina(buffer: Buffer): Promise<Buffer | null> {
  const parser = new PDFParse({ data: buffer });
  try {
    const r = await parser.getImage({ imageBuffer: true, first: 1 });
    const imagens = r.pages.flatMap((p) => p.images).filter((i) => i.data?.length);
    if (!imagens.length) return null;
    // A de cabeçalho/tabela é a mais alta; o gráfico é mais largo que alto.
    const img = imagens.sort((a, b) => b.height - a.height)[0];
    return Buffer.from(img.data);
  } finally {
    await parser.destroy();
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

export async function ocrPrimeiraPagina(buffer: Buffer): Promise<string> {
  const png = await imagemDaPagina(buffer);
  if (!png) return "";
  const img = await loadImage(png);

  // Na Vercel só /tmp é gravável: o arquivo de idioma baixado fica em cache lá.
  const worker = await createWorker("por", undefined, { cachePath: os.tmpdir() });
  try {
    const geral = await ler(worker, ampliar(img), PSM.AUTO);
    if (/LOTE\s*\(?\s*UR|Bulbo|Relat[óo]rio de:?\s*Secagem/i.test(geral)) {
      // Mahild: o quadro lido à parte vem primeiro (é onde o leitor procura os campos).
      return `${await ler(worker, quadroMahild(img), PSM.SINGLE_BLOCK)}\n${geral}`;
    }
    return geral;
  } finally {
    await worker.terminate();
  }
}
