import { NextResponse } from "next/server";
import { ehMaster, senhaFraca, type Perfil } from "@/lib/auth";
import { alterarOperador, CARGOS, criarOperador } from "@/lib/operadores";

/** Cargo da lista (ou vazio = sem cargo). `undefined` = não mexer. */
const cargo = (v: unknown): string | null | undefined =>
  v === undefined ? undefined : (CARGOS as readonly string[]).includes(String(v)) ? String(v) : null;

export const runtime = "nodejs";

const SO_MASTER = () =>
  NextResponse.json({ error: "Só o login da controladoria (controladoriamann) cadastra e edita colaboradores." }, { status: 403 });

const perfil = (v: unknown): Perfil => (v === "master" ? "master" : v === "engenheiro" ? "engenheiro" : "operador");

/** Cadastra um colaborador (só o login master, controladoriamann). */
export async function POST(req: Request) {
  if (!ehMaster(req)) return SO_MASTER();
  const c = (await req.json().catch(() => null)) as { login?: string; nome?: string; senha?: string; perfil?: string; cargo?: string; acessoControladoria?: boolean; acessoMadeireiras?: boolean } | null;
  const login = c?.login?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) {
    return NextResponse.json({ error: "Login: 3 a 40 letras, números, ponto, hífen ou sublinhado." }, { status: 400 });
  }
  if (!c?.nome?.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
  const fraca = senhaFraca(c.senha ?? "");
  if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });
  try {
    await criarOperador({ login, nome: c.nome, senha: c.senha!, perfil: perfil(c.perfil), cargo: cargo(c.cargo) ?? null, acessoControladoria: c.acessoControladoria === true, acessoMadeireiras: c.acessoMadeireiras === true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao criar." }, { status: 422 });
  }
}

/** Troca senha, nome, perfil ou ativa/desativa um colaborador (só o master). */
export async function PATCH(req: Request) {
  if (!ehMaster(req)) return SO_MASTER();
  const c = (await req.json().catch(() => null)) as { id?: number; nome?: string; login?: string; senha?: string; ativo?: boolean; perfil?: string; cargo?: string; acessoControladoria?: boolean; acessoMadeireiras?: boolean } | null;
  if (!c?.id) return NextResponse.json({ error: "Informe o operador." }, { status: 400 });
  if (c.login !== undefined && !/^[A-Za-z0-9._-]{3,40}$/.test(c.login.trim())) {
    return NextResponse.json({ error: "Login: 3 a 40 letras, números, ponto, hífen ou sublinhado." }, { status: 400 });
  }
  if (c.nome !== undefined && !c.nome.trim()) return NextResponse.json({ error: "Informe o nome." }, { status: 400 });
  if (c.senha) {
    const fraca = senhaFraca(c.senha);
    if (fraca) return NextResponse.json({ error: fraca }, { status: 400 });
  }
  try {
    await alterarOperador(c.id, { nome: c.nome, login: c.login?.trim(), senha: c.senha, ativo: c.ativo, perfil: c.perfil ? perfil(c.perfil) : undefined, cargo: cargo(c.cargo), acessoControladoria: typeof c.acessoControladoria === "boolean" ? c.acessoControladoria : undefined, acessoMadeireiras: typeof c.acessoMadeireiras === "boolean" ? c.acessoMadeireiras : undefined });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao alterar." }, { status: 422 });
  }
}
