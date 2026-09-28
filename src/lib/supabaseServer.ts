import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Sem esquema tipado do banco: as tabelas são acessadas por nome.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = SupabaseClient<any, "public", any>;

// Cliente Supabase para uso exclusivo no servidor (API routes / scripts).
// Usa a service role key — NUNCA importe este arquivo em código que roda no navegador.
let cachedClient: Cliente | null = null;

export function getSupabaseServerClient(): Cliente {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados. Veja .env.local.example."
    );
  }

  cachedClient = createClient(url, key, {
    auth: { persistSession: false },
  }) as Cliente;
  return cachedClient;
}
