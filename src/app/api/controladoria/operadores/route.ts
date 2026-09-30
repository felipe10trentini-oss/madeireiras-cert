import { NextResponse } from "next/server";
import { ehMaster, respostaNaoAutorizado, senhaFraca, type Perfil } from "@/lib/auth";
import { alterarOperador, criarOperador } from "@/lib/operadores";

export const runtime = "nodejs";

const perfil = (v: unknown): Perfil => (v === "master" ? "master" : "operador");

/** Cadastra um operador (só a controladoria). */
export async function POST(req: Request) {
  if (!ehMaster(req)) return respostaNaoAutorizado("Acesso só com o login da controladoria.");
  const c = (await req.json().catch(() => null)) as { login?: string; nome?: string; senha?: string; perfil?: string } | null;
  const login = c?.login?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) {
    return NextResponse.json({ error: "Login: 3 a 40 letras, números, ponto, hífen ou sublinhado." }, { status: 400 });
  }
  if (!c?.nome?.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
  const fraca = senhaFraca(c.senha ?? "");
  if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });
  try {
    await criarOperador({ login, nome: c.nome, senha: c.senha!, perfil: perfil(c.perfil) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao criar." }, { status: 422 });
  }
}

/** Troca senha, nome, perfil ou ativa/desativa um operador. */
export async function PATCH(req: Request) {
  if (!ehMaster(req)) return respostaNaoAutorizado("Acesso só com o login da controladoria.");
  const c = (await req.json().catch(() => null)) as { id?: number; nome?: string; senha?: string; ativo?: boolean; perfil?: string } | null;
  if (!c?.id) return NextResponse.json({ error: "Informe o operador." }, { status: 400 });
  if (c.senha) {
    const fraca = senhaFraca(c.senha);
    if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });
  }
  try {
    await alterarOperador(c.id, { nome: c.nome, senha: c.senha, ativo: c.ativo, perfil: c.perfil ? perfil(c.perfil) : undefined });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao alterar." }, { status: 422 });
  }
}
