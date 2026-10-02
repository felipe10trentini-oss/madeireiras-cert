import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Próximo desdobramento do mestre ("089/2026" -> 1, 2, 3…), pelos desdobrados já copiados no site. */
export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const url = new URL(req.url);
  const mestre = (url.searchParams.get("mestre") ?? "").trim();
  const cnpj = soDigitos(url.searchParams.get("cnpj") ?? "");
  if (!mestre) return NextResponse.json({ error: "Informe o mestre." }, { status: 400 });
  const { data, error } = await getSupabaseServerClient()
    .from("emissoes")
    .select("numero_certificado, empresa_cnpj, created_at")
    .eq("tipo", "DESD")
    .like("numero_certificado", `${mestre}-%`);
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  const doMesmo = (data ?? []).filter((d) => !cnpj || soDigitos(d.empresa_cnpj) === cnpj);
  const usados = doMesmo.map((d) => parseInt(String(d.numero_certificado).slice(mestre.length + 1), 10)).filter(Number.isFinite);
  return NextResponse.json({ proxima: usados.length ? Math.max(...usados) + 1 : 1, usados: usados.sort((a, b) => a - b) });
}
