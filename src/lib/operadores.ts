// Operadores (login de cada pessoa que emite) e registro das emissões para a controladoria.
// Só roda no servidor (chave de serviço do Supabase).
import { conferirSenha, hashSenha, type Perfil } from "./auth";
import { getSupabaseServerClient } from "./supabaseServer";

export interface Operador {
  id: number;
  login: string;
  nome: string;
  perfil: Perfil;
  ativo: boolean;
  created_at: string;
}

interface OperadorRow extends Operador {
  senha_hash: string;
}

export interface Emissao {
  id: number;
  operador_login: string;
  empresa_cnpj: string;
  empresa_apelido: string;
  numero_certificado: string | null;
  tipo: string | null;
  lote: string | null;
  ciclo: string | null;
  data_tratamento: string | null;
  divergencias: unknown;
  created_at: string;
}

const normalizarLogin = (login: string) => login.trim().toLowerCase();

export async function autenticar(login: string, senha: string): Promise<Operador | null> {
  const { data, error } = await getSupabaseServerClient()
    .from("operadores")
    .select("id, login, nome, perfil, ativo, created_at, senha_hash")
    .eq("login", normalizarLogin(login))
    .maybeSingle<OperadorRow>();
  if (error) throw new Error(`Falha ao consultar operadores: ${error.message}`);
  if (!data || !data.ativo || !conferirSenha(senha, data.senha_hash)) return null;
  const { senha_hash: _h, ...op } = data;
  return op;
}

export async function listarOperadores(): Promise<Operador[]> {
  const { data, error } = await getSupabaseServerClient()
    .from("operadores")
    .select("id, login, nome, perfil, ativo, created_at")
    .order("nome")
    .returns<Operador[]>();
  if (error) throw new Error(`Falha ao listar operadores: ${error.message}`);
  return data ?? [];
}

export async function criarOperador(o: { login: string; nome: string; senha: string; perfil: Perfil }): Promise<void> {
  const { error } = await getSupabaseServerClient()
    .from("operadores")
    .insert({ login: normalizarLogin(o.login), nome: o.nome.trim(), senha_hash: hashSenha(o.senha), perfil: o.perfil });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error("Já existe um operador com esse login.");
    throw new Error(`Falha ao criar operador: ${error.message}`);
  }
}

export async function alterarOperador(
  id: number,
  mudar: { nome?: string; senha?: string; ativo?: boolean; perfil?: Perfil }
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (mudar.nome) row.nome = mudar.nome.trim();
  if (mudar.senha) row.senha_hash = hashSenha(mudar.senha);
  if (typeof mudar.ativo === "boolean") row.ativo = mudar.ativo;
  if (mudar.perfil) row.perfil = mudar.perfil;
  const { error } = await getSupabaseServerClient().from("operadores").update(row).eq("id", id);
  if (error) throw new Error(`Falha ao alterar operador: ${error.message}`);
}

export async function registrarEmissao(e: Omit<Emissao, "id" | "created_at"> & { operador_id: number }): Promise<void> {
  const { error } = await getSupabaseServerClient().from("emissoes").insert(e);
  if (error) throw new Error(`Falha ao registrar emissão: ${error.message}`);
}

/** Emissões desde uma data (ISO), mais recentes primeiro. */
export async function listarEmissoes(desdeIso: string): Promise<Emissao[]> {
  // O Supabase devolve no máximo 1000 linhas por consulta: lê em páginas.
  const todas: Emissao[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await getSupabaseServerClient()
      .from("emissoes")
      .select("id, operador_login, empresa_cnpj, empresa_apelido, numero_certificado, tipo, lote, ciclo, data_tratamento, divergencias, created_at")
      .gte("created_at", desdeIso)
      .order("created_at", { ascending: false })
      .range(de, de + 999)
      .returns<Emissao[]>();
    if (error) throw new Error(`Falha ao listar emissões: ${error.message}`);
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}
