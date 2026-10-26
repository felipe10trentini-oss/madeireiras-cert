import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { ocrImagem, ocrTabela, ocrPrimeiraPagina } from "@/lib/ocr";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";
// OCR de imagem leva ~10–25 s (mais no início a frio).
export const maxDuration = 120;

/**
 * Texto do pedido do cliente para o comunicado, quando chega como imagem (print do WhatsApp, foto) ou
 * PDF. A planilha (.xlsx) é lida no navegador. Nada é guardado.
 */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie a imagem ou o PDF." }, { status: 400 });
  if (arq.size > 15 * 1024 * 1024) return NextResponse.json({ error: "Arquivo muito grande (máx. 15 MB)." }, { status: 413 });
  try {
    const buf = Buffer.from(await arq.arrayBuffer());
    const pdf = buf.subarray(0, 4).toString("latin1") === "%PDF";
    if (pdf) {
      const { text } = await extractPdf(buf);
      if (text.trim().length > 20) return NextResponse.json({ texto: text, ocr: false });
      return NextResponse.json({ texto: await ocrPrimeiraPagina(buf), ocr: true });
    }
    if (!/^image\//.test(arq.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(arq.name)) {
      return NextResponse.json({ error: "Formato não aceito: mande imagem (PNG/JPG), PDF ou a planilha .xlsx." }, { status: 415 });
    }
    // Tabela (print de e-mail/planilha com cabeçalho) lida por coluna; senão o texto corrido.
    return NextResponse.json({ texto: (await ocrTabela(buf).catch(() => null)) ?? (await ocrImagem(buf)), ocr: true });
  } catch (err) {
    console.error("Falha ao ler o pedido do comunicado", err);
    return NextResponse.json({ error: "Não consegui ler o arquivo (imagem muito escura ou pequena?). Digite os dados." }, { status: 422 });
  }
}
