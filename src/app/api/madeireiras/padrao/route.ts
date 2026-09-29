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
    ...(typeof p.ultimoLote === "string" && /^\d{1,8}$/.test(p.ultimoLote) && { ultimoLote: p.ultimoLote }),
    ...(p.volumesCamara && typeof p.volumesCamara === "object" && {
      volumesCamara: Object.fromEntries(
        Object.entries(p.volumesCamara)
          .filter(([k, v]) => typeof v === "string" && k.length <= 5)
          .map(([k, v]) => [k, String(v).slice(0, 20)])
      ),
    }),
    ...(p.tomadores && typeof p.tomadores === "object" && {
      tomadores: Object.fromEntries(
        Object.entries(p.tomadores)
          .filter(([k, t]) => /^\d{14}$/.test(k) && t && typeof t === "object")
          .slice(0, 5)
          .map(([k, t]) => {
            const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
            return [k, { razao: s(t.razao, 200), cnpj: s(t.cnpj, 30), endereco: s(t.endereco, 300), telefone: s(t.telefone, 80), email: s(t.email, 200) }];
          })
      ),
    }),
  };
  try {
    return NextResponse.json({ padrao: await salvarPadraoRelatorio(corpo.cnpj, limpo) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao salvar." }, { status: 422 });
  }
}
