import { NextResponse } from "next/server";
import { respostaNaoAutorizado, senhaEquipeValida } from "@/lib/auth";
import { lerComunicado } from "@/lib/comunicado";
import { curvaSemTexto, lerCurva } from "@/lib/curvas";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";

/**
 * Lê a curva (e o comunicado, quando houver) e devolve os dados normalizados.
 * A identificação da empresa e a montagem do certificado acontecem no
 * navegador, para que trocar empresa/tipo na tela seja instantâneo.
 */
export async function POST(req: Request) {
  if (!senhaEquipeValida(req)) return respostaNaoAutorizado();

  const form = await req.formData();
  const curvaArq = form.get("curva");
  const comunicadoArq = form.get("comunicado");
  if (!(curvaArq instanceof File)) {
    return NextResponse.json({ error: "Envie o PDF da curva de tratamento." }, { status: 400 });
  }

  try {
    const curvaPdf = await extractPdf(Buffer.from(await curvaArq.arrayBuffer()));
    const comunicadoPdf =
      comunicadoArq instanceof File ? await extractPdf(Buffer.from(await comunicadoArq.arrayBuffer())) : null;

    const semTexto = curvaSemTexto(curvaPdf.text);
    const curva = semTexto ? null : lerCurva(curvaPdf.text);
    if (!semTexto && !curva) {
      return NextResponse.json(
        { error: "Não reconheci o sistema desta curva (SV580, SV520, CRG08 ou DMC2051)." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      nomeArquivo: curvaArq.name,
      semTexto,
      curva,
      comunicado: comunicadoPdf ? lerComunicado(comunicadoPdf.text) : null,
      dataComunicado: comunicadoPdf?.criadoEm ?? null,
    });
  } catch (err) {
    console.error("Falha ao ler PDFs", err);
    return NextResponse.json(
      { error: "Não foi possível ler um dos PDFs. Confira se os arquivos não estão corrompidos." },
      { status: 422 }
    );
  }
}
