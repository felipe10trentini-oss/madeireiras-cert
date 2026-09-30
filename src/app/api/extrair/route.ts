import { NextResponse } from "next/server";
import { respostaNaoAutorizado, senhaEquipeValida } from "@/lib/auth";
import { lerComunicado } from "@/lib/comunicado";
import { curvaSemTexto, lerCurva } from "@/lib/curvas";
import { ocrPrimeiraPagina } from "@/lib/ocr";
import { extractPdf } from "@/lib/pdfText";

export const runtime = "nodejs";
// O OCR de curvas que são imagem leva ~15–25 s.
// OCR de curva em imagem pode passar de 1 min na primeira chamada (início a frio).
export const maxDuration = 120;

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
    const curvaBuffer = Buffer.from(await curvaArq.arrayBuffer());
    const curvaPdf = await extractPdf(curvaBuffer);
    const comunicadoPdf =
      comunicadoArq instanceof File ? await extractPdf(Buffer.from(await comunicadoArq.arrayBuffer())) : null;

    let semTexto = curvaSemTexto(curvaPdf.text);
    let ocr = false;
    let textoCurva = curvaPdf.text;
    if (semTexto) {
      // PDF que é só imagem: tenta ler por OCR (pode levar ~20 s).
      try {
        // Se o OCR travar (o worker do tesseract não rejeita quando falha ao carregar),
        // desiste antes do limite da função: a tela pede o preenchimento manual.
        const lido = await Promise.race([
          ocrPrimeiraPagina(curvaBuffer),
          new Promise<string>((resolve) => setTimeout(() => resolve(""), 100_000)),
        ]);
        if (!curvaSemTexto(lido)) {
          textoCurva = lido;
          semTexto = false;
          ocr = true;
        }
      } catch (err) {
        console.error("Falha no OCR da curva", err);
      }
    }
    const curva = semTexto ? null : lerCurva(textoCurva);
    if (!semTexto && !curva) {
      return NextResponse.json(
        { error: "Não reconheci o sistema desta curva (SV580, SV520, CRG08 ou DMC2051)." },
        { status: 422 }
      );
    }

    return NextResponse.json({
      nomeArquivo: curvaArq.name,
      semTexto,
      ocr,
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
