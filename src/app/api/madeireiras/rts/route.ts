import { NextResponse } from "next/server";
import { podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { acessosComSenha, excluirAcesso, listarAcessos, salvarAcesso, senhaDoAcesso } from "@/lib/acessoSei";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const semCache = { headers: { "Cache-Control": "no-store" } };

/**
 * RTs cadastrados (acessos do SEI), na aba Madeireiras:
 *   GET               -> lista sem senhas
 *   GET ?senha=<id>   -> a senha de um acesso (botão "mostrar")
 *   GET ?backup=1     -> todos com senha, para a planilha de backup
 */
export async function GET(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para a aba Madeireiras.");
  const url = new URL(req.url);
  try {
    const id = Number(url.searchParams.get("senha"));
    if (id) return NextResponse.json({ senha: await senhaDoAcesso(id) }, semCache);
    if (url.searchParams.get("backup")) return NextResponse.json({ rts: await acessosComSenha() }, semCache);
    return NextResponse.json({ rts: await listarAcessos() }, semCache);
  } catch (err) {
    console.error("Falha ao ler RTs");
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 503 });
  }
}

/** Cadastra ou altera um RT (com id = alteração; senha vazia mantém a atual). */
export async function POST(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para a aba Madeireiras.");
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const nome = txt(c?.nome, 120);
  const login = txt(c?.login, 200);
  const senha = typeof c?.senha === "string" && c.senha.length <= 200 ? c.senha : null;
  const id = typeof c?.id === "number" ? c.id : undefined;
  if (!nome) return NextResponse.json({ error: "Informe o nome completo do RT." }, { status: 400 });
  if (!login || !/^\S+@\S+\.\S+$/.test(login)) return NextResponse.json({ error: "Informe o e-mail de acesso ao SEI." }, { status: 400 });
  if (!id && !senha) return NextResponse.json({ error: "Informe a senha do SEI." }, { status: 400 });
  try {
    await salvarAcesso({ id, nome, login, senha, funcao: txt(c?.funcao, 60), empresa: txt(c?.empresa, 120) });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 422 });
  }
}

export async function DELETE(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para a aba Madeireiras.");
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Informe o RT." }, { status: 400 });
  try {
    await excluirAcesso(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 422 });
  }
}
