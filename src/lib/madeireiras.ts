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
  /** Nº do processo SEI da programação (aba PROGRAMAÇÕES da Planilha Geral). */
  processoProgramacao?: string | null;
  /** Configurações da planilha de cadastro (regras da empresa: lote, ciclo, tomador fixo, DR...). */
  config?: ConfigEmpresa | null;
}

/** Colunas de configuração da planilha de cadastro; valem por cima das regras do código. */
export interface ConfigEmpresa {
  unidadeVolumes?: string;
  loteTresDigitos?: boolean;
  loteSemHifen?: boolean;
  cicloTresDigitos?: boolean;
  numeroEhLote?: boolean;
  loteEhNumero?: boolean;
  loteSequencial?: boolean;
  loteAnoSemana?: boolean;
  email?: string;
  produto?: string;
  prestadora?: boolean;
  programacaoTrimestral?: boolean;
  kitEhAqf?: boolean;
  htEhAqf?: boolean;
  bitolaPadraoMm?: number;
  embalagemDeMadeira?: boolean;
  cicloSV520?: string;
  prestadorCnpj?: string;
  tomadorFixo?: { razao: string; cnpj: string; endereco?: string; telefone?: string; email?: string };
  /** A empresa tem Demonstrativo de Rastreabilidade (DR). */
  temDR?: boolean;
  /** DR com abas separadas para KD e HT (Pinustan): início/fim da secagem e da janela HT (#). */
  drKdHt?: boolean;
  /** Planilha de controle do cliente (SV520/Mahild): bitola, fardos e m³ vêm dela. */
  planilhaControle?: boolean;
  /** Sistema da curva, para referência ("SV580", "SV520", "DMC2051"...). */
  sistemaCurva?: string;
  observacoes?: string;
  /** "Ativa: Não" na planilha: some da lista do site. */
  inativa?: boolean;
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

/**
 * "341 ABB 1-350.pdf" -> { numero: "341", nome: "ABB", lote: "1-350" }
 * Lote da empresa informado no fim do nome (GM, Ronaldo RCB):
 *   "165 GM 1-446(833).pdf" / "165 RONALDO 3-544 LOTE 810.pdf" -> loteInformado "833" / "810"
 */
export function lerNomeArquivo(nomeArquivo: string): {
  numero: string | null;
  nome: string | null;
  lote: string | null;
  loteInformado: string | null;
} {
  let base = nomeArquivo.replace(/\.[^./\\]+$/, "").replace(/^CERT\.?\s+/i, "").trim();
  let loteInformado: string | null = null;
  const mLote = base.match(/\s*(?:\(\s*(\d+)\s*\)|\bLOTE\s*(\d+))\s*$/i);
  if (mLote) {
    loteInformado = mLote[1] ?? mLote[2];
    base = base.slice(0, mLote.index).trim();
  }
  const partes = base.split(/\s+/);
  const numero = /^\d{1,6}$/.test(partes[0] ?? "") ? partes.shift()! : null;
  let lote = partes.length > 1 && /^\d+(-\d+)?$/.test(partes[partes.length - 1]) ? partes.pop()! : null;
  // Lote antes do nome do cliente (Madeval: "211 MADEVAL 8-127 ELISANGELA"): o "8-127" do meio.
  if (!lote) {
    const i = partes.findIndex((p, k) => k > 0 && /^\d+-\d+$/.test(p));
    if (i > 0) {
      lote = partes[i];
      partes.splice(i);
    }
  }
  const nome = partes.join(" ").trim() || null;
  return { numero, nome, lote, loteInformado };
}
