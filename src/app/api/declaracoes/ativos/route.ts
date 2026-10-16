import { NextResponse } from "next/server";
import { lerSessao, podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import type { ConfigModelo } from "@/lib/modeloDeclaracao";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Modelo da declaração de uma empresa: logo, assinatura, linhas do RT e campos fixos (pasta
 * privada "declaracoes/<cnpj>/" do Supabase). Fica fora do repositório, que é público.
 */
const pasta = () => getSupabaseServerClient().storage.from("declaracoes");

export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  const baixar = async (nome: string) => {
    const { data } = await pasta().download(`${cnpj}/${nome}`);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };
  try {
    const [logo, assinatura, config] = await Promise.all([baixar("logo.png"), baixar("assinatura.png"), baixar("config.json")]);
    const png = (b: Buffer | null) => (b ? `data:image/png;base64,${b.toString("base64")}` : null);
    const cfg = config ? (JSON.parse(config.toString("utf8")) as Partial<ConfigModelo>) : {};
    return NextResponse.json(
      { logo: png(logo), assinatura: png(assinatura), rt: cfg.rt ?? [], padrao: cfg.padrao ?? {}, salvo: !!(logo || assinatura || config) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Falha ao ler o modelo da declaração", err);
    return NextResponse.json({ error: "Não foi possível ler o modelo da empresa." }, { status: 503 });
  }
}

const PNG = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** Salva o modelo: logo/assinatura em PNG (null apaga, ausente mantém), RT e campos fixos. */
export async function PUT(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para editar modelos.");
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const cnpj = soDigitos(typeof b?.cnpj === "string" ? b.cnpj : "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  const rt = Array.isArray(b?.rt) ? b.rt.map((l) => txt(l, 120)).filter((l): l is string => !!l).slice(0, 6) : [];
  const p = (b?.padrao ?? {}) as Record<string, unknown>;
  const padrao = Object.fromEntries(
    ["destinatario", "produto", "origem", "destino", "localTratamento", "localEmissao", "sujeito", "temperatura", "duracao"]
      .map((k) => [k, txt(p[k], 200)])
      .filter(([, v]) => v)
  );
  try {
    for (const nome of ["logo", "assinatura"] as const) {
      const v = b?.[nome];
      if (v === null) await pasta().remove([`${cnpj}/${nome}.png`]);
      else if (typeof v === "string") {
        const m = v.match(PNG);
        if (!m) return NextResponse.json({ error: `A imagem (${nome}) precisa ser PNG.` }, { status: 400 });
        const buf = Buffer.from(m[1], "base64");
        if (buf.length > 2 * 1024 * 1024) return NextResponse.json({ error: `Imagem (${nome}) muito grande (máx. 2 MB).` }, { status: 413 });
        const { error } = await pasta().upload(`${cnpj}/${nome}.png`, buf, { contentType: "image/png", upsert: true });
        if (error) throw error;
      }
    }
    const { error } = await pasta().upload(`${cnpj}/config.json`, Buffer.from(JSON.stringify({ rt, padrao })), { contentType: "application/json", upsert: true });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Falha ao salvar o modelo da declaração", err);
    return NextResponse.json({ error: "Não foi possível salvar o modelo." }, { status: 503 });
  }
}
