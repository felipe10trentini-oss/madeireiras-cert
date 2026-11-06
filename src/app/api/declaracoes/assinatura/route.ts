import { NextResponse } from "next/server";
import { lerSessao, podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { rtCompleto } from "@/lib/responsaveis";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { chaveNome } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Assinatura do responsável técnico nas declarações em PDF: a imagem (PNG) e o CREA, guardados na
 * pasta privada "declaracoes/assinaturas/<nome>.png|.json" do Supabase (o repositório é público).
 * Vale para toda empresa que tem esse RT no cadastro, no lugar da assinatura do Word modelo.
 */
const pasta = () => getSupabaseServerClient().storage.from("declaracoes");

function chave(rt: string | null | undefined): string {
  const nome = rtCompleto(rt);
  return nome ? chaveNome(nome).replace(/[^A-Z0-9]/gi, "").slice(0, 80) : "";
}

interface Info {
  nome?: string;
  crea?: string;
  atualizado?: string;
}

export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const rt = new URL(req.url).searchParams.get("rt");
  const k = chave(rt);
  if (!k) return NextResponse.json({ error: "Informe o RT." }, { status: 400 });
  try {
    const [{ data: img }, { data: js }] = await Promise.all([pasta().download(`assinaturas/${k}.png`), pasta().download(`assinaturas/${k}.json`)]);
    const info: Info = js ? JSON.parse(await js.text()) : {};
    return NextResponse.json(
      {
        salva: !!img,
        nome: info.nome ?? rtCompleto(rt),
        crea: info.crea ?? "",
        atualizado: info.atualizado ?? null,
        imagem: img ? Buffer.from(await img.arrayBuffer()).toString("base64") : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Falha ao ler a assinatura do RT", err);
    return NextResponse.json({ error: "Não foi possível ler a assinatura." }, { status: 503 });
  }
}

/** Salva: { rt, nome?, crea?, imagem?: base64 do PNG }. Sem `imagem`, só o nome e o CREA mudam. */
export async function PUT(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para editar assinaturas.");
  const b = (await req.json().catch(() => null)) as { rt?: unknown; nome?: unknown; crea?: unknown; imagem?: unknown } | null;
  const rt = typeof b?.rt === "string" ? b.rt : "";
  const k = chave(rt);
  if (!k) return NextResponse.json({ error: "Informe o RT." }, { status: 400 });
  let buf: Buffer | null = null;
  if (b?.imagem != null) {
    if (typeof b.imagem !== "string" || !/^[A-Za-z0-9+/=]+$/.test(b.imagem)) return NextResponse.json({ error: "Envie a imagem (PNG)." }, { status: 400 });
    buf = Buffer.from(b.imagem, "base64");
    if (buf[0] !== 0x89 || buf[1] !== 0x50) return NextResponse.json({ error: "A imagem precisa ser PNG." }, { status: 400 });
    if (buf.length > 2 * 1024 * 1024) return NextResponse.json({ error: "Imagem muito grande (máx. 2 MB)." }, { status: 413 });
  }
  try {
    const { data: js } = await pasta().download(`assinaturas/${k}.json`);
    const atual: Info = js ? JSON.parse(await js.text()) : {};
    if (buf) {
      const up = await pasta().upload(`assinaturas/${k}.png`, buf, { contentType: "image/png", upsert: true });
      if (up.error) throw up.error;
    }
    const info: Info = {
      ...atual,
      // Nome como sai embaixo da linha (pode diferir da grafia do cadastro).
      nome: typeof b?.nome === "string" && b.nome.trim() ? b.nome.replace(/\s+/g, " ").trim().slice(0, 80) : (atual.nome ?? rtCompleto(rt) ?? rt),
      crea: typeof b?.crea === "string" ? b.crea.replace(/\s+/g, " ").trim().slice(0, 60) : atual.crea,
      atualizado: new Date().toISOString(),
    };
    const up = await pasta().upload(`assinaturas/${k}.json`, Buffer.from(JSON.stringify(info)), { contentType: "application/json", upsert: true });
    if (up.error) throw up.error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Falha ao salvar a assinatura do RT", err);
    return NextResponse.json({ error: "Não foi possível salvar a assinatura." }, { status: 503 });
  }
}
