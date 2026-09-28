import { NextResponse } from "next/server";
import { respostaNaoAutorizado, senhaEquipeValida } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!senhaEquipeValida(req)) return respostaNaoAutorizado();
  return NextResponse.json({ ok: true });
}
