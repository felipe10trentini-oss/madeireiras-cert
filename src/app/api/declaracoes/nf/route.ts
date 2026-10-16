import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { lerNotaFiscal } from "@/lib/notaFiscal";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";

/** Lê o DANFE (PDF da nota fiscal) para a declaração de tratamento. Nada é guardado. */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o PDF da nota fiscal." }, { status: 400 });
  try {
    const { text } = await extractPdf(Buffer.from(await arq.arrayBuffer()));
    const nf = lerNotaFiscal(text);
    if (!nf?.numero) return NextResponse.json({ error: "Não reconheci a nota fiscal (DANFE) neste PDF." }, { status: 422 });
    return NextResponse.json({ nf });
  } catch (err) {
    console.error("Falha ao ler nota fiscal", err);
    return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
  }
}
