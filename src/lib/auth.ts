import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// Login por operador. A sessão é um token assinado (HMAC) com login, nome, perfil e validade,
// enviado no cabeçalho Authorization: "Bearer <token>". A chave da assinatura é derivada da
// chave de serviço do Supabase (segredo que só existe no servidor), sem variável nova.

/** "operador" = colaborador; engenheiro(a) emite como o colaborador; master = controladoria. */
export type Perfil = "operador" | "engenheiro" | "master";

export interface Sessao {
  id: number;
  login: string;
  nome: string;
  perfil: Perfil;
  /** Expira em (ms desde 1970). */
  exp: number;
}

const VALIDADE_MS = 12 * 60 * 60 * 1000; // um turno de trabalho

function chave(): Buffer {
  const base = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Sem segredo para assinar a sessão (SUPABASE_SERVICE_ROLE_KEY).");
  return createHmac("sha256", base).update("madeireiras-cert/sessao").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function assinarSessao(s: Omit<Sessao, "exp">): { token: string; sessao: Sessao } {
  const sessao: Sessao = { ...s, exp: Date.now() + VALIDADE_MS };
  const corpo = b64(JSON.stringify(sessao));
  const assinatura = b64(createHmac("sha256", chave()).update(corpo).digest());
  return { token: `${corpo}.${assinatura}`, sessao };
}

export function lerSessao(req: Request): Sessao | null {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const [corpo, assinatura] = token.split(".");
  if (!corpo || !assinatura) return null;
  try {
    const esperada = createHmac("sha256", chave()).update(corpo).digest();
    const recebida = Buffer.from(assinatura, "base64url");
    if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
    const s = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as Sessao;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

/** Qualquer operador logado (as rotas de emissão e de cadastro). */
export const senhaEquipeValida = (req: Request) => lerSessao(req) != null;

/** Só o login master (controladoria). */
export const ehMaster = (req: Request) => lerSessao(req)?.perfil === "master";

export async function respostaNaoAutorizado(msg = "Sessão expirada ou inválida: entre de novo."): Promise<NextResponse> {
  // Pequena espera para dificultar tentativas em sequência.
  await new Promise((r) => setTimeout(r, 500));
  return NextResponse.json({ error: msg }, { status: 401 });
}

// ---------- senhas ----------

export function hashSenha(senha: string): string {
  const sal = randomBytes(16);
  const hash = scryptSync(senha, sal, 64);
  return `scrypt$${sal.toString("base64")}$${hash.toString("base64")}`;
}

export function conferirSenha(senha: string, guardado: string): boolean {
  const [alg, sal, hash] = guardado.split("$");
  if (alg !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "base64");
  const calculado = scryptSync(senha, Buffer.from(sal, "base64"), esperado.length);
  return timingSafeEqual(calculado, esperado);
}

/** Regras mínimas de senha para cadastrar/trocar. */
export function senhaFraca(senha: string): string | null {
  if (senha.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  return null;
}
