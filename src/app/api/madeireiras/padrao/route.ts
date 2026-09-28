import { NextResponse } from "next/server";
import { respostaNaoAutorizado, senhaEquipeValida } from "@/lib/auth";
import { salvarPadraoRelatorio } from "@/lib/madeireirasDb";
import type { PadraoRelatorio } from "@/lib/relatorio";

export const runtime = "nodejs";

/** Guarda os dados do relatório que se repetem (processo, RT, volume das câmaras) da empresa. */
export async function POST(req: Request) {
  if (!senhaEquipeValida(req)) return respostaNaoAutorizado();
  const corpo = (await req.json().catch(() => null)) as { cnpj?: string; padrao?: PadraoRelatorio } | null;
  if (!corpo?.cnpj || !corpo.padrao) {
    return NextResponse.json({ error: "Informe cnpj e padrao." }, { status: 400 });
  }
  const p = corpo.padrao;
  const limpo: PadraoRelatorio = {
    ...(typeof p.processo === "string" && { processo: p.processo.slice(0, 60) }),
    ...(typeof p.dataDocumento === "string" && { dataDocumento: p.dataDocumento.slice(0, 20) }),
    ...(typeof p.rt === "string" && { rt: p.rt.slice(0, 120) }),
    ...(p.volumesCamara && typeof p.volumesCamara === "object" && {
      volumesCamara: Object.fromEntries(
        Object.entries(p.volumesCamara)
          .filter(([k, v]) => typeof v === "string" && k.length <= 5)
          .map(([k, v]) => [k, String(v).slice(0, 20)])
      ),
    }),
  };
  try {
    return NextResponse.json({ padrao: await salvarPadraoRelatorio(corpo.cnpj, limpo) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao salvar." }, { status: 422 });
  }
}
