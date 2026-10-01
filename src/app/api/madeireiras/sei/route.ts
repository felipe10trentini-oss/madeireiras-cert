import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { acessoDoRt, salvarAcessos, type AcessoSei } from "@/lib/acessoSei";
import { listarMadeireiras } from "@/lib/madeireirasDb";
import { rtCompleto } from "@/lib/responsaveis";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Acesso do SEI do RT da empresa (para copiar na emissão). */
export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  try {
    const empresa = (await listarMadeireiras()).find((e) => soDigitos(e.cnpj) === cnpj);
    if (!empresa) return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 });
    const acesso = await acessoDoRt(empresa);
    return NextResponse.json(
      { rt: rtCompleto(empresa.rt), acesso: acesso && { nome: acesso.nome, login: acesso.login, senha: acesso.senha, certeza: acesso.certeza } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Falha ao consultar acesso do SEI");
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 503 });
  }
}

/** Grava os acessos lidos da aba ACESSO SEI (a planilha é lida no navegador). */
export async function POST(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const corpo = (await req.json().catch(() => null)) as { acessos?: unknown[] } | null;
  if (!corpo || !Array.isArray(corpo.acessos) || corpo.acessos.length > 500) {
    return NextResponse.json({ error: "Envie a lista de acessos." }, { status: 400 });
  }
  const lista: AcessoSei[] = [];
  for (const bruto of corpo.acessos) {
    const a = bruto as Record<string, unknown>;
    const nome = txt(a.nome, 120);
    const login = txt(a.login, 200);
    const senha = typeof a.senha === "string" && a.senha.length <= 200 ? a.senha : null;
    if (nome && login && senha) lista.push({ nome, login, senha, funcao: txt(a.funcao, 60), empresa: txt(a.empresa, 120) });
  }
  if (!lista.length) return NextResponse.json({ error: "Nenhum acesso válido na aba ACESSO SEI." }, { status: 422 });
  try {
    return NextResponse.json({ gravados: await salvarAcessos(lista) });
  } catch (err) {
    console.error("Falha ao gravar acessos do SEI");
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro." }, { status: 503 });
  }
}
