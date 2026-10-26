import { NextResponse } from "next/server";
import { lerSessao, podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Modelo do comunicado de tratamento (o Excel que a empresa já usa) e o último número emitido, na pasta
 * privada "declaracoes/<cnpj>/comunicado.xlsx" + "comunicado.json" do Supabase (fora do repositório,
 * que é público).
 */
const pasta = () => getSupabaseServerClient().storage.from("declaracoes");
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

interface Config {
  nomeModelo?: string;
  ultimoNumero?: string;
  atualizado?: string;
}

async function lerConfig(cnpj: string): Promise<Config> {
  const { data } = await pasta().download(`${cnpj}/comunicado.json`);
  if (!data) return {};
  try {
    return JSON.parse(await data.text()) as Config;
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  const [{ data: modelo }, cfg] = await Promise.all([pasta().download(`${cnpj}/comunicado.xlsx`), lerConfig(cnpj)]);
  return NextResponse.json(
    {
      salvo: !!modelo,
      nomeModelo: cfg.nomeModelo ?? null,
      ultimoNumero: cfg.ultimoNumero ?? null,
      atualizado: cfg.atualizado ?? null,
      modelo: modelo ? Buffer.from(await modelo.arrayBuffer()).toString("base64") : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * { cnpj, nome?, modelo?: base64 do .xlsx, emitido?: base64, ultimoNumero? }. Trocar o modelo pede a
 * permissão de Cadastros; depois de emitir, qualquer operador grava o último número e o Excel preenchido
 * do último comunicado (`emitido`), que passa a ser o modelo — a planilha fica sempre com o último emitido.
 */
export async function PUT(req: Request) {
  const b = (await req.json().catch(() => null)) as { cnpj?: unknown; nome?: unknown; modelo?: unknown; emitido?: unknown; ultimoNumero?: unknown } | null;
  const cnpj = soDigitos(typeof b?.cnpj === "string" ? b.cnpj : "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  if (b?.modelo != null ? !podeAcessar(req, "madeireiras") : !lerSessao(req)) {
    return respostaNaoAutorizado(b?.modelo != null ? "Sem permissão para trocar o modelo." : undefined);
  }
  try {
    const atual = await lerConfig(cnpj);
    const arquivo = b?.modelo ?? b?.emitido;
    if (arquivo != null) {
      if (typeof arquivo !== "string" || !/^[A-Za-z0-9+/=]+$/.test(arquivo)) return NextResponse.json({ error: "Envie o Excel (.xlsx)." }, { status: 400 });
      const buf = Buffer.from(arquivo, "base64");
      if (buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ error: "O arquivo não é um Excel (.xlsx)." }, { status: 400 });
      if (buf.length > 10 * 1024 * 1024) return NextResponse.json({ error: "Excel muito grande (máx. 10 MB)." }, { status: 413 });
      const up = await pasta().upload(`${cnpj}/comunicado.xlsx`, buf, { contentType: XLSX, upsert: true });
      if (up.error) throw up.error;
    }
    const cfg: Config = {
      ...atual,
      ...(typeof b?.nome === "string" ? { nomeModelo: b.nome.slice(0, 160) } : {}),
      ...(typeof b?.ultimoNumero === "string" ? { ultimoNumero: b.ultimoNumero.slice(0, 40) } : {}),
      atualizado: new Date().toISOString(),
    };
    const up = await pasta().upload(`${cnpj}/comunicado.json`, Buffer.from(JSON.stringify(cfg)), { contentType: "application/json", upsert: true });
    if (up.error) throw up.error;
    return NextResponse.json({ ok: true, ...cfg });
  } catch (err) {
    console.error("Falha ao salvar o modelo do comunicado", err);
    return NextResponse.json({ error: "Não foi possível salvar." }, { status: 503 });
  }
}
