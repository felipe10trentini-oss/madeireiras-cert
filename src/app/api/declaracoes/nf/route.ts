import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { lerCertificadoMestre } from "@/lib/certificadoMestre";
import { lerNotaFiscal } from "@/lib/notaFiscal";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";

/**
 * Lê um documento da remessa (PDF): nota fiscal (DANFE), certificado mestre ou outro (BL, booking,
 * invoice…). Devolve o texto e o que reconheceu. Nada é guardado.
 */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o PDF." }, { status: 400 });
  try {
    const { text } = await extractPdf(Buffer.from(await arq.arrayBuffer()));
    if (!text.trim()) return NextResponse.json({ error: "PDF sem texto (escaneado): não consigo ler." }, { status: 422 });
    const nf = lerNotaFiscal(text);
    const mestre = nf?.numero ? null : lerCertificadoMestre(text);
    return NextResponse.json({ nf: nf?.numero ? nf : null, mestre: mestre?.numero ? mestre : null, texto: text.slice(0, 200_000) });
  } catch (err) {
    console.error("Falha ao ler documento da remessa", err);
    return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
  }
}
