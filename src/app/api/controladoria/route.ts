import { NextResponse } from "next/server";
import { ehMaster, respostaNaoAutorizado } from "@/lib/auth";
import { listarEmissoes, listarOperadores } from "@/lib/operadores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Data/hora em São Paulo (os limites de semana, mês e ano são os do horário de Brasília). */
function partesSP(d: Date) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
  const [a, m, dia] = f.format(d).split("-").map(Number);
  return { a, m, dia };
}

/** Painel da controladoria: emissões por operador na semana, no mês e no ano. */
export async function GET(req: Request) {
  if (!ehMaster(req)) return respostaNaoAutorizado("Acesso só com o login da controladoria.");
  try {
    const hoje = partesSP(new Date());
    const [operadores, emissoes] = await Promise.all([
      listarOperadores(),
      listarEmissoes(new Date(Date.UTC(hoje.a, 0, 1) - 3 * 3600_000).toISOString()),
    ]);
    // Semana de segunda a domingo.
    const hojeUTC = Date.UTC(hoje.a, hoje.m - 1, hoje.dia);
    const diaSemana = (new Date(hojeUTC).getUTCDay() + 6) % 7;
    const inicioSemana = hojeUTC - diaSemana * 86400_000;

    const porOperador = new Map<string, { semana: number; mes: number; ano: number; divergencias: number }>();
    const porEmpresaMes = new Map<string, number>();
    for (const e of emissoes) {
      const p = partesSP(new Date(e.created_at));
      const dia = Date.UTC(p.a, p.m - 1, p.dia);
      const r = porOperador.get(e.operador_login) ?? { semana: 0, mes: 0, ano: 0, divergencias: 0 };
      if (p.a === hoje.a) r.ano++;
      if (p.a === hoje.a && p.m === hoje.m) {
        r.mes++;
        porEmpresaMes.set(e.empresa_apelido, (porEmpresaMes.get(e.empresa_apelido) ?? 0) + 1);
      }
      if (dia >= inicioSemana) r.semana++;
      if (e.divergencias) r.divergencias++;
      porOperador.set(e.operador_login, r);
    }
    return NextResponse.json({
      operadores,
      resumo: Object.fromEntries(porOperador),
      porEmpresaMes: [...porEmpresaMes.entries()].sort((a, b) => b[1] - a[1]),
      ultimas: emissoes.slice(0, 200),
      totalAno: emissoes.length,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível montar o painel (Supabase)." }, { status: 503 });
  }
}
