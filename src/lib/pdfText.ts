// Precisa ser importado antes de "pdf-parse" para configurar o worker em
// ambientes serverless (Vercel) — sem isso, pdfjs-dist falha com
// "ReferenceError: DOMMatrix is not defined".
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export interface PdfExtraido {
  text: string;
  /** Data de criação do PDF no formato dd/mm/aaaa (a do comunicado = data em que foi emitido). */
  criadoEm: string | null;
}

/** Extrai o texto de todas as páginas de um PDF e a data de criação. */
export async function extractPdf(buffer: Buffer): Promise<PdfExtraido> {
  const parser = new PDFParse({ data: buffer });
  try {
    const text = (await parser.getText()).text;
    let criadoEm: string | null = null;
    try {
      const info = await parser.getInfo();
      const bruto = String((info.info as Record<string, unknown> | undefined)?.CreationDate ?? "");
      const m = bruto.match(/D:(\d{4})(\d{2})(\d{2})/);
      if (m) criadoEm = `${m[3]}/${m[2]}/${m[1]}`;
    } catch {
      // metadados são opcionais
    }
    return { text, criadoEm };
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  return (await extractPdf(buffer)).text;
}
