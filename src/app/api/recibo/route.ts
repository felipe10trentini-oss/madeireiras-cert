import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { extractPdf } from "@/lib/pdfText";
import { lerRecibo } from "@/lib/recibo";

export const runtime = "nodejs";

/** Lê um Recibo Eletrônico de Protocolo (achado pelo navegador na pasta do OneDrive). */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File) || arq.size > 3_000_000) return NextResponse.json({ error: "Envie o PDF do recibo." }, { status: 400 });
  try {
    const { text } = await extractPdf(Buffer.from(await arq.arrayBuffer()));
    const recibo = lerRecibo(text);
    if (!recibo) return NextResponse.json({ error: "Não é um recibo de protocolo do SEI." }, { status: 422 });
    return NextResponse.json({ recibo });
  } catch {
    return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
  }
}
