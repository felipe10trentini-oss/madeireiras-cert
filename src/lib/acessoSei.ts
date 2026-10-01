// Acessos ao SEI dos responsáveis técnicos (aba ACESSO SEI da Planilha Geral): login (e-mail) e
// senha, para o operador copiar na hora de peticionar. Só roda no servidor; senha cifrada no banco.
import { cifrar, decifrar } from "./cripto";
import type { Madeireira } from "./madeireiras";
import { rtCompleto } from "./responsaveis";
import { getSupabaseServerClient } from "./supabaseServer";
import { chaveNome, levenshtein } from "./util";

export interface AcessoSei {
  nome: string;
  funcao: string | null;
  empresa: string | null;
  login: string;
  senha: string;
}

const TABELA = "acessos_sei";

/** Substitui todos os acessos pelos da planilha (a aba é a fonte da verdade). */
export async function salvarAcessos(lista: AcessoSei[]): Promise<number> {
  const sb = getSupabaseServerClient();
  const rows = lista.map((a) => ({
    nome: a.nome,
    funcao: a.funcao,
    empresa: a.empresa,
    login: a.login,
    senha_cifrada: cifrar(a.senha),
  }));
  const { error: e1 } = await sb.from(TABELA).delete().gte("id", 0);
  if (e1) throw new Error(`Falha ao limpar acessos: ${e1.message}`);
  if (rows.length) {
    const { error: e2 } = await sb.from(TABELA).insert(rows);
    if (e2) throw new Error(`Falha ao gravar acessos: ${e2.message}`);
  }
  return rows.length;
}

/** Mesmo nome, com tolerância a erro de digitação (1 letra; 2 em nomes longos). */
function parecido(a: string, b: string | undefined): boolean {
  if (!b) return false;
  if (a === b) return true;
  const d = levenshtein(a, b);
  return d <= 1 || (Math.min(a.length, b.length) >= 7 && d <= 2);
}

const palavras = (s: string | null | undefined) =>
  (s ?? "")
    .split(/\s+/)
    .map(chaveNome)
    .filter((p) => p.length >= 3 && !["DOS", "DAS", "DE", "DA", "DO"].includes(p));

/**
 * Escolhe o acesso do RT da empresa: o nome casa com o RT do cadastro (primeiro nome igual e,
 * se houver, sobrenome em comum) — "Carolina Hampel" x "Carolina Ferraz Hampel Gonzaga". A coluna
 * EMPRESA desempata quando o mesmo nome aparece mais de uma vez. Responsáveis legais não contam.
 */
export function escolherAcesso<T extends { nome: string; funcao: string | null; empresa: string | null }>(
  empresa: Pick<Madeireira, "rt" | "apelido">,
  lista: T[]
): { acesso: T; certeza: "alta" | "media" } | null {
  const rt = palavras(rtCompleto(empresa.rt));
  const curto = palavras(empresa.rt);
  if (!rt.length) return null;
  const apelido = chaveNome(empresa.apelido);
  const pontuados = lista
    .filter((a) => !/legal/i.test(a.funcao ?? ""))
    .map((a) => {
      const n = palavras(a.nome);
      // O primeiro nome da planilha pode ser o segundo do RT ("Vinicius Berkembrock" x "Marcus
      // Vinicius Rodrigues Berkembrock") e ter erro de digitação ("Clervson Betega").
      const doRt = (p: string) => rt.some((q) => parecido(p, q)) || curto.some((q) => parecido(p, q));
      // Primeiro nome muito errado ("Clervson") vale se a inicial e um sobrenome conferem ("Betega" ~ "Bettega").
      const primeiroOk = doRt(n[0]) || (n[0]?.[0] === rt[0][0] && n.slice(1).some(doRt));
      if (!primeiroOk) return { a, s: 0 };
      const comuns = n.slice(1).filter(doRt).length;
      const emp = a.empresa ? chaveNome(a.empresa) : "";
      const daEmpresa = emp && (emp.includes(apelido) || apelido.includes(emp)) ? 2 : 0;
      return { a, s: 1 + comuns + daEmpresa };
    })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s);
  const melhor = pontuados[0];
  if (!melhor) return null;
  // Só o primeiro nome igual e mais de uma pessoa com ele: ambíguo.
  if (melhor.s === 1 && pontuados.filter((p) => p.s === 1).length > 1) return null;
  return { acesso: melhor.a, certeza: melhor.s >= 2 ? "alta" : "media" };
}

/** Acesso do SEI do RT da empresa, com a senha decifrada. */
export async function acessoDoRt(empresa: Madeireira): Promise<(AcessoSei & { certeza: "alta" | "media" }) | null> {
  const { data, error } = await getSupabaseServerClient()
    .from(TABELA)
    .select("nome, funcao, empresa, login, senha_cifrada")
    .returns<{ nome: string; funcao: string | null; empresa: string | null; login: string; senha_cifrada: string }[]>();
  if (error) throw new Error(`Falha ao ler acessos do SEI: ${error.message}`);
  const r = escolherAcesso(empresa, data ?? []);
  if (!r) return null;
  const a = r.acesso;
  return { nome: a.nome, funcao: a.funcao, empresa: a.empresa, login: a.login, senha: decifrar(a.senha_cifrada), certeza: r.certeza };
}
