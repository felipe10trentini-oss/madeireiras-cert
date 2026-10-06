// Operadores (login de cada pessoa que emite) e registro das emissões para a controladoria.
// Só roda no servidor (chave de serviço do Supabase).
import { conferirSenha, hashSenha, type Perfil } from "./auth";
import { getSupabaseServerClient } from "./supabaseServer";

export interface Operador {
  id: number;
  login: string;
  nome: string;
  perfil: Perfil;
  /** Cargo do colaborador ("Engenheiro(a)", "Aux. Administrativo"); não muda o acesso. */
  cargo: string | null;
  acesso_controladoria: boolean;
  acesso_madeireiras: boolean;
  ativo: boolean;
  created_at: string;
}

export const CARGOS = ["Engenheiro(a)", "Aux. Administrativo"] as const;

interface OperadorRow extends Operador {
  senha_hash: string;
}

export interface Emissao {
  id: number;
  operador_id: number | null;
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
    .select("id, login, nome, perfil, cargo, acesso_controladoria, acesso_madeireiras, ativo, created_at, senha_hash")
    .eq("login", normalizarLogin(login))
    .maybeSingle<OperadorRow>();
  if (error) throw new Error(`Falha ao consultar operadores: ${error.message}`);
  if (!data || !data.ativo || !conferirSenha(senha, data.senha_hash)) return null;
  // Nunca devolve o hash da senha.
  const op: Omit<OperadorRow, "senha_hash"> & { senha_hash?: string } = { ...data };
  delete op.senha_hash;
  return op;
}

export async function listarOperadores(): Promise<Operador[]> {
  const { data, error } = await getSupabaseServerClient()
    .from("operadores")
    .select("id, login, nome, perfil, cargo, acesso_controladoria, acesso_madeireiras, ativo, created_at")
    .order("nome")
    .returns<Operador[]>();
  if (error) throw new Error(`Falha ao listar operadores: ${error.message}`);
  return data ?? [];
}

export async function criarOperador(o: {
  login: string;
  nome: string;
  senha: string;
  perfil: Perfil;
  cargo?: string | null;
  acessoControladoria?: boolean;
  acessoMadeireiras?: boolean;
}): Promise<void> {
  const { error } = await getSupabaseServerClient()
    .from("operadores")
    .insert({ login: normalizarLogin(o.login), nome: o.nome.trim(), senha_hash: hashSenha(o.senha), perfil: o.perfil, cargo: o.cargo ?? null, acesso_controladoria: !!o.acessoControladoria, acesso_madeireiras: !!o.acessoMadeireiras });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error("Já existe um operador com esse login.");
    throw new Error(`Falha ao criar operador: ${error.message}`);
  }
}

export async function alterarOperador(
  id: number,
  mudar: {
    nome?: string;
    login?: string;
    senha?: string;
    ativo?: boolean;
    perfil?: Perfil;
    cargo?: string | null;
    acessoControladoria?: boolean;
    acessoMadeireiras?: boolean;
  }
): Promise<void> {
  const sb = getSupabaseServerClient();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (mudar.nome) row.nome = mudar.nome.trim();
  let loginAntigo: string | null = null;
  if (mudar.login) {
    row.login = normalizarLogin(mudar.login);
    const { data } = await sb.from("operadores").select("login").eq("id", id).maybeSingle<{ login: string }>();
    loginAntigo = data?.login ?? null;
  }
  if (mudar.senha) row.senha_hash = hashSenha(mudar.senha);
  if (typeof mudar.ativo === "boolean") row.ativo = mudar.ativo;
  if (mudar.perfil) row.perfil = mudar.perfil;
  if (mudar.cargo !== undefined) row.cargo = mudar.cargo;
  if (typeof mudar.acessoControladoria === "boolean") row.acesso_controladoria = mudar.acessoControladoria;
  if (typeof mudar.acessoMadeireiras === "boolean") row.acesso_madeireiras = mudar.acessoMadeireiras;
  const { error } = await sb.from("operadores").update(row).eq("id", id);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error("Já existe um operador com esse login.");
    throw new Error(`Falha ao alterar operador: ${error.message}`);
  }
  // O histórico acompanha o login novo (a controladoria agrupa pelo operador).
  if (loginAntigo && loginAntigo !== row.login) {
    const { error: e2 } = await sb.from("emissoes").update({ operador_login: row.login }).eq("operador_login", loginAntigo);
    if (e2) throw new Error(`Login alterado, mas o histórico não foi atualizado: ${e2.message}`);
  }
}

export async function registrarEmissao(
  e: Omit<Emissao, "id" | "created_at"> & { operador_id: number; comunicado?: string | null }
): Promise<void> {
  const sb = getSupabaseServerClient();
  let { error } = await sb.from("emissoes").insert(e);
  // Antes da migração 005 a coluna "comunicado" não existe: registra sem ela.
  if (error && e.comunicado !== undefined && /comunicado/i.test(error.message)) {
    const { comunicado: _semColuna, ...resto } = e;
    void _semColuna;
    ({ error } = await sb.from("emissoes").insert(resto));
  }
  if (error) throw new Error(`Falha ao registrar emissão: ${error.message}`);
}

export interface EmissaoAnterior {
  operador_login: string;
  numero_certificado: string | null;
  comunicado: string | null;
  created_at: string;
}

/**
 * Emissões já registradas da mesma empresa com o mesmo nº de certificado ou o mesmo comunicado
 * (aviso de duplicidade). Sem a migração 005 devolve [] — o aviso é conveniência, não trava a emissão.
 */
export async function buscarEmissoesAnteriores(cnpj: string, numero: string | null, comunicado: string | null): Promise<EmissaoAnterior[]> {
  const filtros = [numero && `numero_certificado.eq.${numero}`, comunicado && `comunicado.eq.${comunicado}`].filter(Boolean);
  if (!filtros.length) return [];
  const { data, error } = await getSupabaseServerClient()
    .from("emissoes")
    .select("operador_login, numero_certificado, comunicado, created_at")
    .eq("empresa_cnpj", cnpj)
    .or(filtros.join(","))
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<EmissaoAnterior[]>();
  if (error) return [];
  return data ?? [];
}

/** Emissões desde uma data (ISO), mais recentes primeiro. */
export async function listarEmissoes(desdeIso: string, ateIso?: string): Promise<Emissao[]> {
  // O Supabase devolve no máximo 1000 linhas por consulta: lê em páginas.
  const todas: Emissao[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await getSupabaseServerClient()
      .from("emissoes")
      .select("id, operador_id, operador_login, empresa_cnpj, empresa_apelido, numero_certificado, tipo, lote, ciclo, data_tratamento, divergencias, created_at")
      .gte("created_at", desdeIso)
      .lt("created_at", ateIso ?? "9999-12-31")
      .order("created_at", { ascending: false })
      .range(de, de + 999)
      .returns<Emissao[]>();
    if (error) throw new Error(`Falha ao listar emissões: ${error.message}`);
    todas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todas;
}
