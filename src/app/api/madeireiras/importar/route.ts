import { NextResponse } from "next/server";
import { respostaNaoAutorizado, senhaEquipeValida } from "@/lib/auth";
import { lerDocumento, lerTratamentos, type ConfigEmpresa, type Madeireira } from "@/lib/madeireiras";
import { sincronizarMadeireiras } from "@/lib/madeireirasDb";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

const txt = (v: unknown, max = 300): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const BOOLS = ["loteTresDigitos", "loteSemHifen", "numeroEhLote", "loteEhNumero", "loteSequencial", "loteAnoSemana",
  "prestadora", "programacaoTrimestral", "kitEhAqf", "htEhAqf", "embalagemDeMadeira", "temDR", "drKdHt", "planilhaControle", "inativa"] as const;
const TEXTOS = ["unidadeVolumes", "email", "produto", "cicloSV520", "prestadorCnpj", "sistemaCurva", "observacoes"] as const;

/** Só as chaves conhecidas da planilha de cadastro, com tipo e tamanho conferidos. */
function limparConfig(c: Record<string, unknown>): ConfigEmpresa {
  const r: ConfigEmpresa = {};
  for (const k of BOOLS) if (c[k] === true) r[k] = true;
  for (const k of TEXTOS) {
    const t = txt(c[k], k === "observacoes" ? 500 : 200);
    if (t) r[k] = t;
  }
  if (typeof c.bitolaPadraoMm === "number" && c.bitolaPadraoMm > 0 && c.bitolaPadraoMm < 500) r.bitolaPadraoMm = c.bitolaPadraoMm;
  const t = c.tomadorFixo as Record<string, unknown> | undefined;
  if (t && txt(t.razao) && txt(t.cnpj, 30)) {
    r.tomadorFixo = { razao: txt(t.razao)!, cnpj: txt(t.cnpj, 30)! };
    for (const k of ["endereco", "telefone", "email"] as const) {
      const v = txt(t[k]);
      if (v) r.tomadorFixo[k] = v;
    }
  }
  return r;
}

/**
 * A planilha (Planilha Geral tem ~6 MB, acima do limite da Vercel) é lida no
 * navegador; aqui chegam só as empresas já extraídas, que são validadas de novo.
 */
export async function POST(req: Request) {
  if (!senhaEquipeValida(req)) return respostaNaoAutorizado();

  const corpo = (await req.json().catch(() => null)) as {
    empresas?: unknown[];
    ignoradas?: number;
    modo?: string;
  } | null;
  if (!corpo || !Array.isArray(corpo.empresas) || corpo.empresas.length > 2000) {
    return NextResponse.json({ error: "Envie a lista de empresas lida da planilha." }, { status: 400 });
  }

  const empresas: Madeireira[] = [];
  for (const bruto of corpo.empresas) {
    const e = bruto as Record<string, unknown>;
    const razaoSocial = txt(e.razaoSocial);
    const cnpj = txt(e.cnpj, 30);
    if (!razaoSocial || soDigitos(cnpj).length !== 14) continue;
    empresas.push({
      apelido: txt(e.apelido, 120) ?? razaoSocial,
      rt: txt(e.rt, 120),
      uf: txt(e.uf, 2),
      modalidade: e.modalidade === "Credenciada" ? "Credenciada" : "Cadastrada",
      tratamentos: lerTratamentos(Array.isArray(e.tratamentos) ? e.tratamentos.join("/") : String(e.tratamentos ?? "")),
      razaoSocial,
      cnpj: cnpj!,
      crea: txt(e.crea, 40),
      telefone: txt(e.telefone, 80),
      endereco: txt(e.endereco),
      regMapa: txt(e.regMapa, 30),
      email: txt(e.email, 200),
      documento: lerDocumento(txt(e.documento, 20)),
      unidadeVolumes: txt(e.unidadeVolumes, 40),
      processoProgramacao: txt(e.processoProgramacao, 40)?.match(/^\d{5}\.\d{6}\/\d{4}-\d{2}$/)?.[0] ?? null,
      ...(e.config && typeof e.config === "object" ? { config: limparConfig(e.config as Record<string, unknown>) } : {}),
    });
  }
  if (!empresas.length) {
    return NextResponse.json({ error: "Nenhuma empresa com razão social e CNPJ válido." }, { status: 422 });
  }

  try {
    const ignoradas = Number(corpo.ignoradas) || 0;
    return NextResponse.json(await sincronizarMadeireiras(empresas, ignoradas, corpo.modo === "aplicar"));
  } catch (err) {
    console.error("Falha na importação de madeireiras", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro desconhecido." }, { status: 422 });
  }
}
