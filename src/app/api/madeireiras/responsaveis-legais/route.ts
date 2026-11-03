import { NextResponse } from "next/server";
import { listarAcessos } from "@/lib/acessoSei";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Responsável legal de cada empresa (RTs cadastrados com "Resp. Legal" e empresa preenchida), para a aba
 * Relatórios do Controle de Curvas. Só nome e empresa: basta estar logado, sem e-mail nem senha do SEI.
 */
export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  try {
    const legais = (await listarAcessos())
      .filter((r) => /legal/i.test(r.funcao ?? "") && r.empresa?.trim())
      .map((r) => ({ empresa: r.empresa, nome: r.nome }));
    return NextResponse.json({ legais }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os responsáveis legais." }, { status: 503 });
  }
}
