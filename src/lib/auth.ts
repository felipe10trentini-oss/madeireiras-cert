import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Proteção provisória das rotas que gravam dados (clientes e planilha do MAPA):
 * senha da equipe enviada no cabeçalho x-team-password e comparada com a
 * variável de ambiente TEAM_PASSWORD. Será substituída pelo login por usuário.
 */
export function senhaEquipeValida(req: Request): boolean {
  const esperada = process.env.TEAM_PASSWORD;
  if (!esperada) return false;
  const a = Buffer.from(req.headers.get("x-team-password") ?? "");
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function respostaNaoAutorizado(): Promise<NextResponse> {
  // Pequena espera para dificultar tentativas em sequência.
  await new Promise((r) => setTimeout(r, 500));
  return NextResponse.json({ error: "Senha da equipe incorreta." }, { status: 401 });
}
