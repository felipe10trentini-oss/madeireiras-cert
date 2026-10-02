import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { lerCertificadoMestre, lerDR } from "@/lib/certificadoMestre";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";

/** Lê o PDF do certificado mestre (desdobrado) ou da DR (consolidado). */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o PDF." }, { status: 400 });
  try {
    const { text } = await extractPdf(Buffer.from(await arq.arrayBuffer()));
    const dr = lerDR(text);
    if (dr) {
      if (!dr.linhas.length) return NextResponse.json({ error: "Li a DR, mas não achei as linhas dos tratamentos." }, { status: 422 });
      return NextResponse.json({ tipo: "dr", dr, nomeArquivo: arq.name });
    }
    const mestre = lerCertificadoMestre(text);
    if (mestre?.numero) return NextResponse.json({ tipo: "mestre", mestre, nomeArquivo: arq.name });
    return NextResponse.json(
      { error: "Não reconheci o PDF: envie o certificado mestre (PDF do SEI) ou a DR do consolidado." },
      { status: 422 }
    );
  } catch (err) {
    console.error("Falha ao ler documento", err);
    return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
  }
}
