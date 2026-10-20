import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import type { LinhaRelatorio } from "@/lib/relatorioMapa";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Último relatório do MAPA de cada empresa, um por ano (aba TÉRMICO já lida no navegador), para as
 * declarações do modelo padrão: "declaracoes/<cnpj>/relatorio-<ano>.json" na pasta privada do Supabase
 * (dados de clientes nunca vão para o repositório). Soltar o relatório de novo troca o daquele ano; o
 * do ano anterior fica (declaração de ciclo de dezembro feita em janeiro).
 */
const pasta = () => getSupabaseServerClient().storage.from("declaracoes");

interface Salvo {
  ano: string;
  nome: string;
  atualizado: string;
  linhas: LinhaRelatorio[];
}

/** Ano que mais aparece nas datas dos tratamentos ("dd/mm/aaaa"). */
function anoDe(linhas: LinhaRelatorio[]): string {
  const cont = new Map<string, number>();
  for (const l of linhas) {
    const a = l.data.match(/(\d{4})$/)?.[1];
    if (a) cont.set(a, (cont.get(a) ?? 0) + 1);
  }
  return [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? String(new Date().getFullYear());
}

export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  const { data: arqs } = await pasta().list(cnpj, { limit: 100 });
  // Os dois anos mais recentes guardados.
  const anos = (arqs ?? [])
    .map((a) => a.name.match(/^relatorio-(\d{4})\.json$/)?.[1])
    .filter((a): a is string => !!a)
    .sort()
    .reverse()
    .slice(0, 2);
  const salvos: Salvo[] = [];
  for (const ano of anos) {
    const { data } = await pasta().download(`${cnpj}/relatorio-${ano}.json`);
    if (!data) continue;
    try {
      salvos.push(JSON.parse(await data.text()) as Salvo);
    } catch {
      // arquivo estragado: ignora (soltar o relatório de novo regrava)
    }
  }
  return NextResponse.json(
    {
      salvo: salvos.length > 0,
      relatorios: salvos.map((s) => ({ ano: s.ano, nome: s.nome, atualizado: s.atualizado, tratamentos: s.linhas.length })),
      linhas: salvos.flatMap((s) => s.linhas),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** Salva { cnpj, nome, linhas } (as linhas lidas da aba TÉRMICO), no ano dos tratamentos. */
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
  const ano = anoDe(linhas);
  const salvo: Salvo = { ano, nome: txt(b.nome, 200) || "relatorio.xlsx", atualizado: new Date().toISOString(), linhas };
  const up = await pasta().upload(`${cnpj}/relatorio-${ano}.json`, Buffer.from(JSON.stringify(salvo)), { contentType: "application/json", upsert: true });
  if (up.error) {
    console.error("Falha ao salvar o relatório", up.error.message);
    return NextResponse.json({ error: "Não foi possível guardar o relatório." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, ano, atualizado: salvo.atualizado, linhas: linhas.length });
}
