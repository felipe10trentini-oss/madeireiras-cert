import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Cifra simétrica (AES-256-GCM) para guardar segredos no banco — as senhas do SEI dos RTs.
// A chave sai do segredo do servidor (o mesmo da sessão); o banco só guarda o texto cifrado.
function chave(): Buffer {
  const base = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Sem segredo para cifrar (SUPABASE_SERVICE_ROLE_KEY).");
  return createHash("sha256").update(`${base}|madeireiras-cert/acessos-sei`).digest();
}

/** "v1.<iv>.<tag>.<dados>" em base64url. */
export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), dados.toString("base64url")].join(".");
}

export function decifrar(cifrado: string): string {
  const [v, iv, tag, dados] = cifrado.split(".");
  if (v !== "v1" || !iv || !tag || !dados) throw new Error("Texto cifrado inválido.");
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64url")), d.final()]).toString("utf8");
}
