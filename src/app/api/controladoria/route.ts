import { NextResponse } from "next/server";
import { ehMaster, respostaNaoAutorizado } from "@/lib/auth";
import { listarMadeireiras } from "@/lib/madeireirasDb";
import { listarEmissoes, listarOperadores, type Emissao } from "@/lib/operadores";
import { ufDoMapa } from "@/lib/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Horário de Brasília (UTC-3, sem horário de verão desde 2019): os limites de dia,
// semana, mês e ano são os de São Paulo.
const FUSO_MS = 3 * 3600_000;

/** "2026-09-30" -> instante UTC da meia-noite em São Paulo. */
const meiaNoiteSP = (iso: string) => Date.parse(`${iso}T00:00:00Z`) + FUSO_MS;

/** Instante UTC -> "2026-09-30" em São Paulo. */
const diaSP = (ms: number) => new Date(ms - FUSO_MS).toISOString().slice(0, 10);

const DIA_MS = 86400_000;

/**
 * Painel da controladoria. Contagens fixas (hoje, semana, mês e ano correntes) e as do período
 * escolhido no filtro: ?de=AAAA-MM-DD&ate=AAAA-MM-DD (inclusive).
 */
export async function GET(req: Request) {
  if (!ehMaster(req)) return respostaNaoAutorizado("Acesso só com o login da controladoria.");
  try {
    const url = new URL(req.url);
    const hoje = diaSP(Date.now());
    const valida = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
    const de = valida(url.searchParams.get("de")) ?? `${hoje.slice(0, 7)}-01`;
    const ate = valida(url.searchParams.get("ate")) ?? hoje;

    const inicioAno = meiaNoiteSP(`${hoje.slice(0, 4)}-01-01`);
    const inicioPeriodo = meiaNoiteSP(de);
    const fimPeriodo = meiaNoiteSP(ate) + DIA_MS; // exclusivo
    const desde = Math.min(inicioAno, inicioPeriodo);
    const [operadores, emissoes, empresas] = await Promise.all([
      listarOperadores(),
      listarEmissoes(new Date(desde).toISOString(), new Date(Math.max(fimPeriodo, Date.now() + DIA_MS)).toISOString()),
      listarMadeireiras(),
    ]);
    // Estado do MAPA de cada empresa, para mostrar ao lado do nome.
    const ufPorNome = Object.fromEntries(empresas.map((e) => [e.apelido, ufDoMapa(e.regMapa, e.uf)]));

    // Agrupa pelo operador (id), para o histórico acompanhar um login editado.
    const loginDe = new Map(operadores.map((o) => [o.id, o.login]));
    const chave = (e: Emissao) => (e.operador_id != null ? loginDe.get(e.operador_id) : undefined) ?? e.operador_login;

    const inicioHoje = meiaNoiteSP(hoje);
    const diaSemana = (new Date(`${hoje}T00:00:00Z`).getUTCDay() + 6) % 7; // segunda = 0
    const inicioSemana = inicioHoje - diaSemana * DIA_MS;
    const inicioMes = meiaNoiteSP(`${hoje.slice(0, 7)}-01`);

    type Contagem = { hoje: number; semana: number; mes: number; ano: number; periodo: number; divergencias: number };
    const porOperador = new Map<string, Contagem>();
    const porEmpresa = new Map<string, number>();
    const doPeriodo: Emissao[] = [];
    for (const e of emissoes) {
      const t = Date.parse(e.created_at);
      const k = chave(e);
      const r = porOperador.get(k) ?? { hoje: 0, semana: 0, mes: 0, ano: 0, periodo: 0, divergencias: 0 };
      if (t >= inicioAno) r.ano++;
      if (t >= inicioMes) r.mes++;
      if (t >= inicioSemana) r.semana++;
      if (t >= inicioHoje) r.hoje++;
      if (t >= inicioPeriodo && t < fimPeriodo) {
        r.periodo++;
        if (e.divergencias) r.divergencias++;
        porEmpresa.set(e.empresa_apelido, (porEmpresa.get(e.empresa_apelido) ?? 0) + 1);
        doPeriodo.push({ ...e, operador_login: k });
      }
      porOperador.set(k, r);
    }
    return NextResponse.json({
      operadores,
      periodo: { de, ate },
      resumo: Object.fromEntries(porOperador),
      porEmpresa: [...porEmpresa.entries()].sort((a, b) => b[1] - a[1]),
      ufPorNome,
      emissoes: doPeriodo.slice(0, 3000),
      totalPeriodo: doPeriodo.length,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível montar o painel (Supabase)." }, { status: 503 });
  }
}
