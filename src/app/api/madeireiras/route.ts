import { NextResponse } from "next/server";
import { respostaNaoAutorizado, senhaEquipeValida } from "@/lib/auth";
import { listarMadeireiras } from "@/lib/madeireirasDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!senhaEquipeValida(req)) return respostaNaoAutorizado();
  try {
    return NextResponse.json({ empresas: await listarMadeireiras() });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Não foi possível consultar o cadastro de madeireiras (Supabase)." },
      { status: 503 }
    );
  }
}
