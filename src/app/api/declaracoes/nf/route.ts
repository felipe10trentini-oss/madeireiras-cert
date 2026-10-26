import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { lerCertificadoMestre } from "@/lib/certificadoMestre";
import { juntarDanfe, lerCartaCorrecao, lerNotaFiscal } from "@/lib/notaFiscal";
import { ocrImagem } from "@/lib/ocr";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";
// Documento em imagem (foto/print da nota, do BL…) é lido por OCR: ~10–25 s.
export const maxDuration = 120;

/**
 * Lê um documento da remessa (PDF): nota fiscal (DANFE), carta de correção da nota (DACCe),
 * certificado mestre ou outro (BL, booking, invoice…), em PDF ou imagem (foto/print, lida por OCR).
 * Devolve o texto e o que reconheceu.
 * Nada é guardado.
 */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o PDF ou a imagem." }, { status: 400 });
  try {
    const buf = Buffer.from(await arq.arrayBuffer());
    const ehPdf = buf.subarray(0, 4).toString("latin1") === "%PDF";
    const ehImagem = !ehPdf && (/^image\//.test(arq.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(arq.name));
    if (!ehPdf && !ehImagem) return NextResponse.json({ error: "Envie PDF ou imagem (PNG/JPG)." }, { status: 415 });
    const text = ehPdf ? (await extractPdf(buf)).text : await ocrImagem(buf);
    if (!text.trim()) return NextResponse.json({ error: ehPdf ? "PDF sem texto (escaneado): não consigo ler." : "Não consegui ler a imagem." }, { status: 422 });
    // A carta de correção também fala de "NF-e": vem antes da nota.
    const cc = lerCartaCorrecao(text);
    if (cc) return NextResponse.json({ nf: null, mestre: null, cc, texto: text.slice(0, 200_000) });
    // DANFE: o texto às vezes sai embaralhado (layout em caixas); a leitura pela posição completa.
    const lida = lerNotaFiscal(text);
    // Import dinâmico: se a leitura por posição falhar ao carregar, a nota sai só pelo texto.
    const pos = lida && ehPdf
      ? await import("@/lib/danfePosicao")
          .then((m) => m.lerDanfePosicional(new Uint8Array(buf), text))
          .catch((e) => (console.error("Leitura do DANFE por posição falhou", e), null))
      : null;
    const nf = lida ? juntarDanfe(lida, pos) : null;
    const mestre = nf?.numero ? null : lerCertificadoMestre(text);
    return NextResponse.json({ nf: nf?.numero ? nf : null, mestre: mestre?.numero ? mestre : null, texto: text.slice(0, 200_000) });
  } catch (err) {
    console.error("Falha ao ler documento da remessa", err);
    return NextResponse.json({ error: "Não foi possível ler o PDF." }, { status: 422 });
  }
}
