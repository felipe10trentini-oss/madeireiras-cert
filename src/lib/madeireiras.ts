import { chaveNome, chaveRegMapa, levenshtein, soDigitos } from "./util";

export type ModalidadeCadastro = "Cadastrada" | "Credenciada";
export type Documento = "programacao" | "comunicado";

/** Uma linha da planilha Madeireiras (aba DADOS CADASTRAIS). */
export interface Madeireira {
  apelido: string; // coluna EMPRESA: "ABB WOOD", "Galego (MG COMEX)"
  rt: string | null;
  uf: string | null;
  modalidade: ModalidadeCadastro;
  /** Tipos de tratamento habilitados: ["KD","HT"], ["HT"] ou ["KD"]. */
  tratamentos: ("KD" | "HT")[];
  razaoSocial: string;
  cnpj: string;
  crea: string | null;
  telefone: string | null;
  endereco: string | null;
  regMapa: string | null;
  email: string | null;
  /** Programação mensal ou comunicado por tratamento (coluna opcional da planilha). */
  documento: Documento | null;
  /** Unidade dos volumes no certificado ("Fardos", "Tábuas"...). Coluna opcional. */
  unidadeVolumes: string | null;
}

export function lerTratamentos(s: string | null | undefined): ("KD" | "HT")[] {
  const t = (s ?? "").toUpperCase();
  const r: ("KD" | "HT")[] = [];
  if (t.includes("KD")) r.push("KD");
  if (t.includes("HT")) r.push("HT");
  return r.length ? r : ["HT"];
}

export function lerDocumento(s: string | null | undefined): Documento | null {
  const t = chaveNome(s);
  if (t.includes("COMUN")) return "comunicado";
  if (t.includes("PROG")) return "programacao";
  return null;
}

export interface Identificacao {
  empresa: Madeireira;
  por: "CNPJ" | "registro MAPA" | "nome do arquivo";
}

/**
 * Acha a empresa da curva: primeiro pelo CNPJ impresso, depois pelo registro no
 * MAPA e, por fim, pelo nome no arquivo ("150 VIDEPINUS 3-54" -> "VIDEPINUS"),
 * tolerando erro de digitação ("ARTEMOBILLI").
 */
export function identificarEmpresa(
  lista: Madeireira[],
  dados: { cnpj?: string | null; regMapa?: string | null; nomeArquivo?: string | null }
): Identificacao | null {
  const cnpj = soDigitos(dados.cnpj);
  if (cnpj.length === 14) {
    const e = lista.find((m) => soDigitos(m.cnpj) === cnpj);
    if (e) return { empresa: e, por: "CNPJ" };
  }

  const reg = chaveRegMapa(dados.regMapa);
  if (reg) {
    const achadas = lista.filter((m) => chaveRegMapa(m.regMapa) === reg);
    // Mesmo registro para mais de uma unidade (Inexport): o nome do arquivo desempata.
    if (achadas.length === 1) return { empresa: achadas[0], por: "registro MAPA" };
    if (achadas.length > 1) {
      const porNome = dados.nomeArquivo ? melhorPorNome(achadas, dados.nomeArquivo) : null;
      return { empresa: porNome ?? achadas[0], por: "registro MAPA" };
    }
  }

  if (dados.nomeArquivo) {
    const e = melhorPorNome(lista, dados.nomeArquivo);
    if (e) return { empresa: e, por: "nome do arquivo" };
  }
  return null;
}

function melhorPorNome(lista: Madeireira[], nome: string): Madeireira | null {
  const alvo = chaveNome(nome);
  if (alvo.length < 2) return null;
  let melhor: { e: Madeireira; d: number } | null = null;
  for (const e of lista) {
    const candidatos = [e.apelido, e.razaoSocial, ...e.apelido.split(/[()]/)].map(chaveNome).filter((c) => c.length >= 2);
    for (const c of candidatos) {
      let d: number;
      if (c === alvo) d = 0;
      else if (c.startsWith(alvo) || alvo.startsWith(c)) d = 0.5;
      else d = levenshtein(c, alvo);
      if (!melhor || d < melhor.d) melhor = { e, d };
    }
  }
  if (!melhor) return null;
  const limite = alvo.length >= 6 ? 2 : alvo.length >= 4 ? 1 : 0.5;
  return melhor.d <= limite ? melhor.e : null;
}

/** "341 ABB 1-350.pdf" -> { numero: "341", nome: "ABB", lote: "1-350" } */
export function lerNomeArquivo(nomeArquivo: string): { numero: string | null; nome: string | null; lote: string | null } {
  const base = nomeArquivo.replace(/\.[^./\\]+$/, "").replace(/^CERT\.?\s+/i, "").trim();
  const partes = base.split(/\s+/);
  const numero = /^\d{1,6}$/.test(partes[0] ?? "") ? partes.shift()! : null;
  const lote = partes.length > 1 && /^\d+(-\d+)?$/.test(partes[partes.length - 1]) ? partes.pop()! : null;
  const nome = partes.join(" ").trim() || null;
  return { numero, nome, lote };
}
