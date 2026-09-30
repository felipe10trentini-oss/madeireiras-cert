import { NextResponse } from "next/server";
import { lerSessao, respostaNaoAutorizado } from "@/lib/auth";
import { registrarEmissao } from "@/lib/operadores";

export const runtime = "nodejs";

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : null);

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
      divergencias,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Não foi possível registrar a emissão." }, { status: 503 });
  }
}
