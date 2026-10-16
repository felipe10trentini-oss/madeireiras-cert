import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { lerCertificadoMestre } from "@/lib/certificadoMestre";
import { lerDanfePosicional } from "@/lib/danfePosicao";
import { juntarDanfe, lerCartaCorrecao, lerNotaFiscal } from "@/lib/notaFiscal";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";

/**
 * Lê um documento da remessa (PDF): nota fiscal (DANFE), carta de correção da nota (DACCe),
 * certificado mestre ou outro (BL, booking, invoice…). Devolve o texto e o que reconheceu.
 * Nada é guardado.
 */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o PDF." }, { status: 400 });
  try {
    const buf = Buffer.from(await arq.arrayBuffer());
    const { text } = await extractPdf(buf);
    if (!text.trim()) return NextResponse.json({ error: "PDF sem texto (escaneado): não consigo ler." }, { status: 422 });
    // A carta de correção também fala de "NF-e": vem antes da nota.
    const cc = lerCartaCorrecao(text);
    if (cc) return NextResponse.json({ nf: null, mestre: null, cc, texto: text.slice(0, 200_000) });
    // DANFE: o texto às vezes sai embaralhado (layout em caixas); a leitura pela posição completa.
    const lida = lerNotaFiscal(text);
    const nf = lida ? juntarDanfe(lida, await lerDanfePosicional(new Uint8Array(buf), text).catch(() => null)) : null;
    const mestre = nf?.numero ? null : lerCertificadoMestre(text);
    return NextResponse.json({ nf: nf?.numero ? nf : null, mestre: mestre?.numero ? mestre : null, texto: text.slice(0, 200_000) });
  } catch (err) {
    console.error("Falha ao ler documento da remessa", err);
    return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
  }
}
