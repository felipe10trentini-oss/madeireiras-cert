import { NextResponse } from "next/server";
import { lerSessao, podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { adicionarComprador, excluirComprador, listarCompradores, renomearComprador } from "@/lib/compradores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compradores frequentes (para escolher no desdobrado): qualquer colaborador logado. */
export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  try {
    return NextResponse.json(await listarCompradores(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 503 });
  }
}

/** Cadastra um comprador (aba Cadastros). */
export async function POST(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para a aba Cadastros.");
  const c = (await req.json().catch(() => null)) as { razao?: unknown } | null;
  const razao = typeof c?.razao === "string" ? c.razao.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (razao.length < 3) return NextResponse.json({ error: "Informe a razão social do comprador." }, { status: 400 });
  try {
    await adicionarComprador(razao);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 422 });
  }
}

/** Corrige o nome de um comprador: { id, razao }. */
export async function PATCH(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para a aba Cadastros.");
  const c = (await req.json().catch(() => null)) as { id?: unknown; razao?: unknown } | null;
  const id = Number(c?.id);
  const razao = typeof c?.razao === "string" ? c.razao.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!(id > 0)) return NextResponse.json({ error: "Informe o comprador." }, { status: 400 });
  if (razao.length < 3) return NextResponse.json({ error: "Informe a razão social do comprador." }, { status: 400 });
  try {
    await renomearComprador(id, razao);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 422 });
  }
}

export async function DELETE(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para a aba Cadastros.");
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!(id > 0)) return NextResponse.json({ error: "Informe o comprador." }, { status: 400 });
  try {
    await excluirComprador(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 422 });
  }
}
