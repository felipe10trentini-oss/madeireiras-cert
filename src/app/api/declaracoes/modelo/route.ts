import { NextResponse } from "next/server";
import { lerSessao, podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Modelo (Word) da declaração de cada empresa: o .docx que ela já usa, guardado na pasta privada
 * "declaracoes/<cnpj>/modelo.docx" do Supabase (fora do repositório, que é público), e as regras
 * aprendidas com os documentos da remessa daquele modelo (config.json).
 */
const pasta = () => getSupabaseServerClient().storage.from("declaracoes");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface Config {
  nomeModelo?: string;
  atualizado?: string;
  regras?: Record<string, string>;
  documentos?: string[];
}

async function lerConfig(cnpj: string): Promise<Config> {
  const { data } = await pasta().download(`${cnpj}/config.json`);
  return data ? (JSON.parse(await data.text()) as Config) : {};
}

export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  try {
    const [{ data: modelo }, cfg] = await Promise.all([pasta().download(`${cnpj}/modelo.docx`), lerConfig(cnpj)]);
    return NextResponse.json(
      {
        salvo: !!modelo,
        nomeModelo: cfg.nomeModelo ?? null,
        atualizado: cfg.atualizado ?? null,
        regras: cfg.regras ?? {},
        documentos: cfg.documentos ?? [],
        modelo: modelo ? Buffer.from(await modelo.arrayBuffer()).toString("base64") : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Falha ao ler o modelo da declaração", err);
    return NextResponse.json({ error: "Não foi possível ler o modelo da empresa." }, { status: 503 });
  }
}

/**
 * Salva o modelo: { cnpj, nome?, modelo?: base64 do .docx, regras?: {campo: regra}, documentos?: [nomes] }.
 * Sem `modelo`, mantém o Word atual (só as regras mudam).
 */
export async function PUT(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para editar modelos.");
  const b = (await req.json().catch(() => null)) as { cnpj?: unknown; nome?: unknown; modelo?: unknown; regras?: unknown; documentos?: unknown } | null;
  const cnpj = soDigitos(typeof b?.cnpj === "string" ? b.cnpj : "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  let buf: Buffer | null = null;
  if (b?.modelo != null) {
    if (typeof b.modelo !== "string" || !/^[A-Za-z0-9+/=]+$/.test(b.modelo)) return NextResponse.json({ error: "Envie o Word (.docx)." }, { status: 400 });
    buf = Buffer.from(b.modelo, "base64");
    // .docx é um zip: começa com "PK".
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ error: "O arquivo não é um Word (.docx)." }, { status: 400 });
    if (buf.length > 10 * 1024 * 1024) return NextResponse.json({ error: "Word muito grande (máx. 10 MB)." }, { status: 413 });
  }
  const regras: Record<string, string> | undefined =
    b?.regras && typeof b.regras === "object"
      ? Object.fromEntries(
          Object.entries(b.regras as Record<string, unknown>)
            .filter((e): e is [string, string] => /^\w{2,20}$/.test(e[0]) && typeof e[1] === "string" && e[1].length <= 600)
            .slice(0, 40)
        )
      : undefined;
  const documentos = Array.isArray(b?.documentos) ? b.documentos.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 160)).slice(0, 20) : undefined;
  try {
    const atual = await lerConfig(cnpj);
    if (buf) {
      const up = await pasta().upload(`${cnpj}/modelo.docx`, buf, { contentType: DOCX, upsert: true });
      if (up.error) throw up.error;
    }
    const cfg: Config = {
      ...atual,
      ...(buf ? { nomeModelo: typeof b?.nome === "string" ? b.nome.slice(0, 160) : "modelo.docx" } : {}),
      // Word novo sem regras novas: as antigas eram do Word anterior e saem.
      regras: regras ?? (buf ? {} : atual.regras),
      documentos: documentos ?? (buf ? [] : atual.documentos),
      atualizado: new Date().toISOString(),
    };
    const up = await pasta().upload(`${cnpj}/config.json`, Buffer.from(JSON.stringify(cfg)), { contentType: "application/json", upsert: true });
    if (up.error) throw up.error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Falha ao salvar o modelo da declaração", err);
    return NextResponse.json({ error: "Não foi possível salvar o modelo." }, { status: 503 });
  }
}
