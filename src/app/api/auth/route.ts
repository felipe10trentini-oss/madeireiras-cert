import { NextResponse } from "next/server";
import { assinarSessao, lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { autenticar } from "@/lib/operadores";

export const runtime = "nodejs";

/** Confere uma sessão (o Controle de Curvas usa para validar o cert_token antes de responder). */
export async function GET(req: Request) {
  const s = lerSessao(req);
  if (!s) return respostaNaoAutorizado();
  return NextResponse.json({ login: s.login, nome: s.nome }, { headers: { "Cache-Control": "no-store" } });
}

/** Login do operador: devolve a sessão assinada (token) com nome e perfil. */
export async function POST(req: Request) {
  const corpo = (await req.json().catch(() => null)) as { login?: string; senha?: string } | null;
  if (!corpo?.login || !corpo.senha) return respostaNaoAutorizado("Informe login e senha.");
  try {
    const op = await autenticar(corpo.login, corpo.senha);
    if (!op) return respostaNaoAutorizado("Login ou senha incorretos.");
    const { token, sessao } = assinarSessao({
      id: op.id,
      login: op.login,
      nome: op.nome,
      perfil: op.perfil,
      acessos: { controladoria: op.acesso_controladoria, madeireiras: op.acesso_madeireiras },
    });
    return NextResponse.json({ token, sessao });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível verificar o login (Supabase)." }, { status: 503 });
  }
}
