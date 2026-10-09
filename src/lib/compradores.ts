// Compradores frequentes do desdobrado (tabela madeireiras.compradores, migração 006).
// Só roda no servidor. Sem a tabela (migração ainda não aplicada), vale a lista combinada.
import { COMPRADORES_FREQUENTES } from "./documentos";
import { getSupabaseServerClient } from "./supabaseServer";

const TABELA = "compradores";

export interface Comprador {
  id: number;
  razao: string;
}

/** Tabela ainda não criada no Supabase. */
const semTabela = (msg: string) => /does not exist|schema cache|Could not find the table/i.test(msg);

export async function listarCompradores(): Promise<{ compradores: Comprador[]; padrao: boolean }> {
  const { data, error } = await getSupabaseServerClient().from(TABELA).select("id, razao").order("razao").returns<Comprador[]>();
  if (error) {
    if (semTabela(error.message)) return { compradores: COMPRADORES_FREQUENTES.map((razao, i) => ({ id: -(i + 1), razao })), padrao: true };
    throw new Error(`Falha ao ler compradores: ${error.message}`);
  }
  return { compradores: data ?? [], padrao: false };
}

export async function adicionarComprador(razao: string): Promise<void> {
  const { error } = await getSupabaseServerClient().from(TABELA).insert({ razao });
  if (error) {
    if (semTabela(error.message)) throw new Error("A tabela de compradores ainda não foi criada no Supabase (migração 006).");
    if (/duplicate|unique/i.test(error.message)) throw new Error("Esse comprador já está na lista.");
    throw new Error(`Falha ao cadastrar: ${error.message}`);
  }
}

/** Corrige a razão social (nome digitado errado). */
export async function renomearComprador(id: number, razao: string): Promise<void> {
  const { error } = await getSupabaseServerClient().from(TABELA).update({ razao }).eq("id", id);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error("Já existe um comprador com esse nome.");
    throw new Error(`Falha ao alterar: ${error.message}`);
  }
}

export async function excluirComprador(id: number): Promise<void> {
  const { error } = await getSupabaseServerClient().from(TABELA).delete().eq("id", id);
  if (error) throw new Error(`Falha ao excluir: ${error.message}`);
}
