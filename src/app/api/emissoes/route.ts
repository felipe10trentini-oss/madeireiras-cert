import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { buscarEmissoesAnteriores, registrarEmissao } from "@/lib/operadores";

export const runtime = "nodejs";

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null);

// Nº de certificado/comunicado: só dígitos e barra ("1479/2026"); vai para um filtro do PostgREST.
const numeroSeguro = (v: string | null) => (v && /^\d{1,6}\/\d{4}$/.test(v) ? v : null);

/** Emissões anteriores com o mesmo certificado ou comunicado (aviso de duplicidade). */
export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const p = new URL(req.url).searchParams;
  const cnpj = txt(p.get("cnpj"), 30);
  if (!cnpj) return NextResponse.json({ error: "Informe a empresa." }, { status: 400 });
  const anteriores = await buscarEmissoesAnteriores(cnpj, numeroSeguro(txt(p.get("numero"), 12)), numeroSeguro(txt(p.get("comunicado"), 12)));
  return NextResponse.json({ anteriores });
}

/** Registra quem copiou cada certificado (controladoria). */
export async function POST(req: Request) {
  const sessao = lerSessao(req);
  if (!sessao) return respostaNaoAutorizado();
  const c = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!c || !txt(c.empresaCnpj, 30)) return NextResponse.json({ error: "Dados da emissão incompletos." }, { status: 400 });
  const divergencias = Array.isArray(c.divergencias) && c.divergencias.length ? c.divergencias.slice(0, 20) : null;
  try {
    await registrarEmissao({
      operador_id: sessao.id,
      operador_login: sessao.login,
      empresa_cnpj: txt(c.empresaCnpj, 30)!,
      empresa_apelido: txt(c.empresaApelido, 120) ?? "",
      numero_certificado: txt(c.numero, 30),
      tipo: txt(c.tipo, 5),
      lote: txt(c.lote, 40),
      ciclo: txt(c.ciclo, 60),
      data_tratamento: txt(c.dataTratamento, 12),
      comunicado: numeroSeguro(txt(c.comunicado, 12)),
      divergencias,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível registrar a emissão." }, { status: 503 });
  }
}
