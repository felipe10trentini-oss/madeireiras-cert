import { NextResponse } from "next/server";
import { lerSessao, podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

/**
 * Modelo (Word) da declaração de cada empresa: o .docx que ela já usa, guardado na pasta privada
 * "declaracoes/<cnpj>/modelo.docx" do Supabase (fora do repositório, que é público). A declaração
 * sai desse Word, só com os dados trocados.
 */
const pasta = () => getSupabaseServerClient().storage.from("declaracoes");
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(req: Request) {
  if (!lerSessao(req)) return respostaNaoAutorizado();
  const cnpj = soDigitos(new URL(req.url).searchParams.get("cnpj") ?? "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  try {
    const [{ data: modelo }, { data: config }] = await Promise.all([pasta().download(`${cnpj}/modelo.docx`), pasta().download(`${cnpj}/config.json`)]);
    const cfg = config ? (JSON.parse(await config.text()) as { nomeModelo?: string; atualizado?: string }) : {};
    return NextResponse.json(
      {
        salvo: !!modelo,
        nomeModelo: cfg.nomeModelo ?? null,
        atualizado: cfg.atualizado ?? null,
        modelo: modelo ? Buffer.from(await modelo.arrayBuffer()).toString("base64") : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("Falha ao ler o modelo da declaração", err);
    return NextResponse.json({ error: "Não foi possível ler o modelo da empresa." }, { status: 503 });
  }
}

/** Salva (troca) o modelo: { cnpj, nome, modelo: base64 do .docx }. */
export async function PUT(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para editar modelos.");
  const b = (await req.json().catch(() => null)) as { cnpj?: unknown; nome?: unknown; modelo?: unknown } | null;
  const cnpj = soDigitos(typeof b?.cnpj === "string" ? b.cnpj : "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "Informe o CNPJ." }, { status: 400 });
  if (typeof b?.modelo !== "string" || !/^[A-Za-z0-9+/=]+$/.test(b.modelo)) return NextResponse.json({ error: "Envie o Word (.docx)." }, { status: 400 });
  const buf = Buffer.from(b.modelo, "base64");
  // .docx é um zip: começa com "PK".
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return NextResponse.json({ error: "O arquivo não é um Word (.docx)." }, { status: 400 });
  if (buf.length > 10 * 1024 * 1024) return NextResponse.json({ error: "Word muito grande (máx. 10 MB)." }, { status: 413 });
  const nome = typeof b.nome === "string" ? b.nome.slice(0, 160) : "modelo.docx";
  try {
    const up = await pasta().upload(`${cnpj}/modelo.docx`, buf, { contentType: DOCX, upsert: true });
    if (up.error) throw up.error;
    const cfg = await pasta().upload(`${cnpj}/config.json`, Buffer.from(JSON.stringify({ nomeModelo: nome, atualizado: new Date().toISOString() })), {
      contentType: "application/json",
      upsert: true,
    });
    if (cfg.error) throw cfg.error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Falha ao salvar o modelo da declaração", err);
    return NextResponse.json({ error: "Não foi possível salvar o modelo." }, { status: 503 });
  }
}
