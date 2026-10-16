import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Logo, assinatura e linhas do RT da declaração de uma empresa (pasta privada "declaracoes" do
 * Supabase, por CNPJ). Ficam fora do repositório, que é público.
 */
export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  const pasta = getSupabaseServerClient().storage.from("declaracoes");
  const baixar = async (nome: string) => {
    const { data } = await pasta.download(`${cnpj}/${nome}`);
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  };
  try {
    const [logo, assinatura, config] = await Promise.all([baixar("logo.png"), baixar("assinatura.png"), baixar("config.json")]);
    const png = (b: Buffer | null) => (b ? `data:image/png;base64,${b.toString("base64")}` : null);
    const cfg = config ? (JSON.parse(config.toString("utf8")) as { rt?: string[] }) : {};
    return NextResponse.json({ logo: png(logo), assinatura: png(assinatura), rt: cfg.rt ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Falha ao ler os arquivos da declaração", err);
    return NextResponse.json({ error: "Não foi possível ler o timbre da empresa." }, { status: 503 });
  }
}
