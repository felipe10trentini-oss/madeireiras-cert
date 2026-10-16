import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { podeAcessar, respostaNaoAutorizado } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Lê uma declaração em PDF que a empresa já usa (modelo): texto e imagens (logo, assinatura,
 * marca-d'água). Nada é guardado aqui; o operador escolhe o que salvar no modelo.
 */
export async function POST(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para editar modelos.");
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o PDF da declaração." }, { status: 400 });
  if (arq.size > 15 * 1024 * 1024) return NextResponse.json({ error: "PDF muito grande (máx. 15 MB)." }, { status: 413 });
  const p = new PDFParse({ data: Buffer.from(await arq.arrayBuffer()) });
  try {
    const texto = (await p.getText({ partial: [1] })).text;
    const img = await p.getImage({ partial: [1], imageThreshold: 24, imageDataUrl: true, imageBuffer: false });
    const imagens = img.pages
      .flatMap((pg) => pg.images)
      .filter((i) => i.dataUrl && i.dataUrl.length < 3_000_000)
      .slice(0, 12)
      .map((i) => i.dataUrl);
    return NextResponse.json({ texto, imagens });
  } catch (err) {
    console.error("Falha ao ler o modelo de declaração", err);
    return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
  } finally {
    await p.destroy();
  }
}
