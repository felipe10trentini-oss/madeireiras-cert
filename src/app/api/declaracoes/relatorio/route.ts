import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import type { LinhaRelatorio } from "@/lib/relatorioMapa";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Último relatório do MAPA de cada empresa (aba TÉRMICO já lida no navegador), para as declarações
 * do modelo padrão: fica na pasta privada "declaracoes/<cnpj>/relatorio.json" do Supabase (dados de
 * clientes nunca vão para o repositório). Soltar um relatório novo troca o anterior.
 */
const pasta = () => getSupabaseServerClient().storage.from("declaracoes");

interface Salvo {
  nome: string;
  atualizado: string;
  linhas: LinhaRelatorio[];
}

export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  const { data } = await pasta().download(`${cnpj}/relatorio.json`);
  if (!data) return NextResponse.json({ salvo: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const s = JSON.parse(await data.text()) as Salvo;
    return NextResponse.json({ salvo: true, ...s }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ salvo: false });
  }
}

const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** Salva { cnpj, nome, linhas } (as linhas lidas da aba TÉRMICO). */
export async function PUT(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const b = (await req.json().catch(() => null)) as { cnpj?: unknown; nome?: unknown; linhas?: unknown } | null;
  const cnpj = soDigitos(typeof b?.cnpj === "string" ? b.cnpj : "");
  if (cnpj.length !== 14 || !Array.isArray(b?.linhas) || !b.linhas.length || b.linhas.length > 20000) {
    return NextResponse.json({ error: "Envie o CNPJ e as linhas do relatório." }, { status: 400 });
  }
  const linhas: LinhaRelatorio[] = (b.linhas as Record<string, unknown>[]).map((l) => ({
    ciclo: txt(l.ciclo, 40),
    lote: txt(l.lote, 20),
    certificado: txt(l.certificado, 40),
    data: txt(l.data, 10),
    hora: txt(l.hora, 10),
    modalidade: txt(l.modalidade, 40),
    temperatura: txt(l.temperatura, 10),
    minutos: typeof l.minutos === "number" && Number.isFinite(l.minutos) ? l.minutos : null,
    local: txt(l.local, 120),
    volumes: txt(l.volumes, 30),
    unidadeVolumes: txt(l.unidadeVolumes, 40),
    produto: txt(l.produto, 160),
    tomador: txt(l.tomador, 200),
    tomadorCnpj: soDigitos(txt(l.tomadorCnpj, 30)),
  }));
  const salvo: Salvo = { nome: txt(b.nome, 200) || "relatorio.xlsx", atualizado: new Date().toISOString(), linhas };
  const up = await pasta().upload(`${cnpj}/relatorio.json`, Buffer.from(JSON.stringify(salvo)), { contentType: "application/json", upsert: true });
  if (up.error) {
    console.error("Falha ao salvar o relatório", up.error.message);
    return NextResponse.json({ error: "Não foi possível guardar o relatório." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, atualizado: salvo.atualizado, linhas: linhas.length });
}
