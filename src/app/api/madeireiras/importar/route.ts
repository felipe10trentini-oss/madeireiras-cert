import { NextResponse } from "next/server";
import { respostaNaoAutorizado, senhaEquipeValida } from "@/lib/auth";
import { sincronizarMadeireiras } from "@/lib/madeireirasDb";
import { lerPlanilhaMadeireiras } from "@/lib/planilhaMadeireiras";

export const runtime = "nodejs";
const LIMITE = 4 * 1024 * 1024; // a Vercel aceita no máximo ~4,5 MB por requisição

export async function POST(req: Request) {
  if (!senhaEquipeValida(req)) return respostaNaoAutorizado();

  const form = await req.formData();
  const arquivo = form.get("arquivo");
  const aplicar = form.get("modo") === "aplicar";
  if (!(arquivo instanceof File) || !/\.xlsx$/i.test(arquivo.name)) {
    return NextResponse.json({ error: "Envie a planilha de madeireiras (.xlsx)." }, { status: 400 });
  }
  if (arquivo.size > LIMITE) {
    return NextResponse.json({ error: "Planilha maior que 4 MB." }, { status: 413 });
  }

  try {
    const { empresas, ignoradas } = await lerPlanilhaMadeireiras(Buffer.from(await arquivo.arrayBuffer()));
    if (!empresas.length) {
      return NextResponse.json({ error: "Nenhuma empresa com razão social e CNPJ válido." }, { status: 422 });
    }
    return NextResponse.json(await sincronizarMadeireiras(empresas, ignoradas, aplicar));
  } catch (err) {
    console.error("Falha na importação de madeireiras", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro desconhecido." }, { status: 422 });
  }
}
