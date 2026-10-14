import { NextResponse } from "next/server";
import { lerSessao, podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { listarPresenca, marcarPresenca, ONLINE_MS } from "@/lib/operadores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sinal de vida do colaborador logado (o navegador manda a cada minuto). */
export async function POST(req: Request) {
  const s = lerSessao(req);
  if (!s) return respostaNaoAutorizado();
  if (s.id > 0) await marcarPresenca(s.id, true).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

/** "Sair": fica offline na hora. */
export async function DELETE(req: Request) {
  const s = lerSessao(req);
  if (!s) return respostaNaoAutorizado();
  if (s.id > 0) await marcarPresenca(s.id, false).catch(() => undefined);
  return NextResponse.json({ ok: true });
}

/** Quem está online (controladoria). Calculado pela hora do servidor, não do navegador. */
export async function GET(req: Request) {
  if (!podeAcessar(req, "controladoria")) return respostaNaoAutorizado("Sem permissão para a controladoria.");
  try {
    const agora = Date.now();
    const online = (await listarPresenca()).map((p) => ({
      id: p.id,
      online: !!p.visto_em && agora - Date.parse(p.visto_em) < ONLINE_MS,
      vistoEm: p.visto_em,
    }));
    return NextResponse.json({ online }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 503 });
  }
}
