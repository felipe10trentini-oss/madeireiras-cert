// OCR das curvas que vêm como imagem dentro do PDF (ex.: CRG08 KDHT da Madeico).
// Só roda no servidor. Em vez de desenhar a página (o pdf.js conflita com o canvas
// dentro do Next), extrai a imagem embutida de maior área, amplia e lê com o
// Tesseract em português.
import "pdf-parse/worker";
import os from "node:os";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFParse } from "pdf-parse";
import { createWorker } from "tesseract.js";

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

async function ampliar(png: Buffer): Promise<Buffer> {
  const img = await loadImage(png);
  const escala = Math.max(1, LARGURA_OCR / img.width);
  const canvas = createCanvas(Math.round(img.width * escala), Math.round(img.height * escala));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer("image/png");
}

export async function ocrPrimeiraPagina(buffer: Buffer): Promise<string> {
  const png = await imagemDaPagina(buffer);
  if (!png) return "";
  const imagem = await ampliar(png);

  // Na Vercel só /tmp é gravável: o arquivo de idioma baixado fica em cache lá.
  const worker = await createWorker("por", undefined, { cachePath: os.tmpdir() });
  try {
    const { data } = await worker.recognize(imagem);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
