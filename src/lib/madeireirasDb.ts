import type { EstiloRelatorio } from "./estiloRelatorio";
import { lerTratamentos, type ConfigEmpresa, type Madeireira } from "./madeireiras";
import type { PadraoRelatorio } from "./relatorio";
import { juntarUltimos } from "./sequenciaCiclo";
import { getSupabaseServerClient } from "./supabaseServer";
import { soDigitos } from "./util";

/** Tabela no schema "madeireiras" (separado das tabelas da Mann móvel, em "public"). */
const TABELA = "empresas";

export interface MadeireiraSalva extends Madeireira {
  relatorio: PadraoRelatorio;
  /** Estilo das linhas já lançadas na planilha de relatório (entregue pela API, fora do bundle público). */
  estilo?: EstiloRelatorio | null;
}

interface Row {
  id: number;
  apelido: string;
  rt: string | null;
  uf: string | null;
  modalidade: string;
  tratamentos: string;
  razao_social: string;
  cnpj: string;
  crea: string | null;
  telefone: string | null;
  endereco: string | null;
  reg_mapa: string | null;
  email: string | null;
  documento: string | null;
  unidade_volumes: string | null;
  // O estilo aprendido das planilhas de relatório fica junto, em relatorio.estilo (gravado por scripts/gerarEstilos.ts).
  relatorio: (PadraoRelatorio & { estilo?: EstiloRelatorio }) | null;
  config: ConfigEmpresa | null;
}

const COLS =
  "id, apelido, rt, uf, modalidade, tratamentos, razao_social, cnpj, crea, telefone, endereco, reg_mapa, email, documento, unidade_volumes, relatorio, config";

function deRow(r: Row): MadeireiraSalva {
  const { estilo, ...relatorio } = r.relatorio ?? {};
  return {
    apelido: r.apelido,
    rt: r.rt,
    uf: r.uf,
    modalidade: r.modalidade === "Credenciada" ? "Credenciada" : "Cadastrada",
    tratamentos: lerTratamentos(r.tratamentos),
    razaoSocial: r.razao_social,
    cnpj: r.cnpj,
    crea: r.crea,
    telefone: r.telefone,
    endereco: r.endereco,
    regMapa: r.reg_mapa,
    email: r.email,
    documento: r.documento === "comunicado" ? "comunicado" : r.documento === "programacao" ? "programacao" : null,
    unidadeVolumes: r.unidade_volumes,
    relatorio,
    estilo: estilo ?? null,
    config: r.config ?? {},
  };
}

function paraRow(m: Madeireira) {
  return {
    apelido: m.apelido,
    rt: m.rt,
    uf: m.uf,
    modalidade: m.modalidade,
    tratamentos: m.tratamentos.join("/"),
    razao_social: m.razaoSocial,
    cnpj: m.cnpj,
    crea: m.crea,
    telefone: m.telefone,
    endereco: m.endereco,
    reg_mapa: m.regMapa,
    email: m.email,
    documento: m.documento,
    unidade_volumes: m.unidadeVolumes,
    // A Planilha Geral não traz configurações: só a planilha de cadastro nova grava a coluna.
    ...(m.config && { config: m.config }),
  };
}

async function lerRows(): Promise<Row[]> {
  const { data, error } = await getSupabaseServerClient()
    .from(TABELA)
    .select(COLS)
    .order("apelido")
    .limit(5000)
    .returns<Row[]>();
  if (error) throw new Error(`Falha ao ler madeireiras: ${error.message}`);
  return data ?? [];
}

export async function listarMadeireiras(): Promise<MadeireiraSalva[]> {
  return (await lerRows()).map(deRow);
}

export interface ResumoImportacao {
  totalNaPlanilha: number;
  novas: string[];
  atualizadas: { apelido: string; campos: string[] }[];
  iguais: number;
  ignoradas: number;
  ausentesNaPlanilha: number;
  aplicado: boolean;
}

/** Compara pelo CNPJ e, se `aplicar`, insere as novas e atualiza as alteradas. Nunca apaga. */
export async function sincronizarMadeireiras(
  empresas: Madeireira[],
  ignoradas: number,
  aplicar: boolean
): Promise<ResumoImportacao> {
  const existentes = new Map((await lerRows()).map((r) => [soDigitos(r.cnpj), r]));
  const resumo: ResumoImportacao = {
    totalNaPlanilha: empresas.length,
    novas: [],
    atualizadas: [],
    iguais: 0,
    ignoradas,
    ausentesNaPlanilha: 0,
    aplicado: aplicar,
  };
  type RowGravar = ReturnType<typeof paraRow> & { relatorio?: PadraoRelatorio };
  const inserir: RowGravar[] = [];
  const alterar: { id: number; row: RowGravar }[] = [];

  for (const e of empresas) {
    const row = paraRow(e);
    const atual = existentes.get(soDigitos(e.cnpj));
    if (!atual) {
      inserir.push({ ...row, relatorio: e.processoProgramacao ? { processo: e.processoProgramacao } : {} });
      resumo.novas.push(e.apelido);
      continue;
    }
    const campos: string[] = (Object.keys(row) as (keyof typeof row)[]).filter((k) =>
      k === "config"
        ? JSON.stringify(row.config ?? {}) !== JSON.stringify(atual.config ?? {})
        : (row[k] ?? "").toString().trim() !== (atual[k] ?? "").toString().trim()
    );
    // O processo da programação (aba PROGRAMAÇÕES) vai para os dados do relatório.
    let relatorio: PadraoRelatorio | undefined;
    if (e.processoProgramacao && e.processoProgramacao !== atual.relatorio?.processo) {
      relatorio = { ...(atual.relatorio ?? {}), processo: e.processoProgramacao };
      campos.push("processo");
    }
    if (campos.length) {
      alterar.push({ id: atual.id, row: relatorio ? { ...row, relatorio } : row });
      resumo.atualizadas.push({ apelido: e.apelido, campos });
    } else resumo.iguais++;
  }
  const naPlanilha = new Set(empresas.map((e) => soDigitos(e.cnpj)));
  resumo.ausentesNaPlanilha = [...existentes.keys()].filter((k) => !naPlanilha.has(k)).length;

  if (aplicar) {
    const sb = getSupabaseServerClient();
    if (inserir.length) {
      const { error } = await sb.from(TABELA).insert(inserir);
      if (error) throw new Error(`Falha ao inserir: ${error.message}`);
    }
    for (const a of alterar) {
      const { error } = await sb
        .from(TABELA)
        .update({ ...a.row, updated_at: new Date().toISOString() })
        .eq("id", a.id);
      if (error) throw new Error(`Falha ao atualizar ${a.row.apelido}: ${error.message}`);
    }
  }
  return resumo;
}

/** Mescla os dados de relatório salvos da empresa (processo, RT, volume das câmaras). */
export async function salvarPadraoRelatorio(cnpj: string, novo: PadraoRelatorio): Promise<PadraoRelatorio> {
  const rows = await lerRows();
  const atual = rows.find((r) => soDigitos(r.cnpj) === soDigitos(cnpj));
  if (!atual) throw new Error("Empresa não encontrada no cadastro.");
  const antigo = atual.relatorio ?? {};
  const mesclado: PadraoRelatorio = {
    ...antigo,
    ...novo,
    volumesCamara: { ...(antigo.volumesCamara ?? {}), ...(novo.volumesCamara ?? {}) },
    tomadores: { ...(antigo.tomadores ?? {}), ...(novo.tomadores ?? {}) },
    // Último ciclo por estufa: guarda o maior (reemitir um ciclo antigo não volta a sequência).
    ciclos: juntarUltimos(antigo.ciclos, novo.ciclos),
  };
  const { error } = await getSupabaseServerClient()
    .from(TABELA)
    .update({ relatorio: mesclado, updated_at: new Date().toISOString() })
    .eq("id", atual.id);
  if (error) throw new Error(`Falha ao salvar: ${error.message}`);
  const { estilo: _estilo, ...semEstilo } = mesclado as PadraoRelatorio & { estilo?: unknown };
  return semEstilo;
}

/** Grava o estilo do relatório de cada empresa (chave: CNPJ só com dígitos) em relatorio.estilo. */
export async function gravarEstilos(estilos: Record<string, EstiloRelatorio>): Promise<number> {
  const sb = getSupabaseServerClient();
  let n = 0;
  for (const r of await lerRows()) {
    const estilo = estilos[soDigitos(r.cnpj)];
    if (!estilo) continue;
    const { error } = await sb
      .from(TABELA)
      .update({ relatorio: { ...(r.relatorio ?? {}), estilo }, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) throw new Error(`Falha ao gravar estilo de ${r.apelido}: ${error.message}`);
    n++;
  }
  return n;
}
