import { NextResponse } from "next/server";
import { podeAcessar, respostaNaoAutorizado } from "@/lib/auth";
import { sincronizarTomadores } from "@/lib/madeireirasDb";
import type { Tomador } from "@/lib/relatorio";
import { soDigitos } from "@/lib/util";

export const runtime = "nodejs";

const txt = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Cadastra/atualiza os clientes tomadores de uma prestadora (Mann móvel). A planilha é lida no navegador;
 * aqui chega só a lista. `modo: "previa"` mostra o que mudaria; `"aplicar"` grava.
 */
export async function POST(req: Request) {
  if (!podeAcessar(req, "madeireiras")) return respostaNaoAutorizado("Sem permissão para a aba Cadastros.");
  const corpo = (await req.json().catch(() => null)) as {
    cnpj?: unknown;
    clientes?: unknown[];
    ignoradas?: unknown;
    modo?: unknown;
  } | null;
  if (!corpo || typeof corpo.cnpj !== "string" || !Array.isArray(corpo.clientes) || corpo.clientes.length > 3000) {
    return NextResponse.json({ error: "Envie o CNPJ da prestadora e a lista de clientes." }, { status: 400 });
  }

  const clientes: Tomador[] = [];
  let ignoradas = typeof corpo.ignoradas === "number" && corpo.ignoradas >= 0 ? Math.floor(corpo.ignoradas) : 0;
  for (const bruto of corpo.clientes) {
    const c = (bruto ?? {}) as Record<string, unknown>;
    const razao = txt(c.razao, 200);
    const cnpj = txt(c.cnpj, 30);
    if (!razao || soDigitos(cnpj).length !== 14) {
      ignoradas++;
      continue;
    }
    clientes.push({
      razao,
      cnpj,
      endereco: txt(c.endereco, 300),
      telefone: txt(c.telefone, 80),
      email: txt(c.email, 200),
    });
  }
  if (!clientes.length) {
    return NextResponse.json({ error: "Nenhum cliente com nome e CNPJ válido foi encontrado." }, { status: 422 });
  }

  try {
    return NextResponse.json(await sincronizarTomadores(corpo.cnpj, clientes, ignoradas, corpo.modo === "aplicar"));
  } catch (err) {
    console.error("Falha ao sincronizar clientes", err instanceof Error ? err.message : "erro");
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro ao salvar." }, { status: 422 });
  }
}
