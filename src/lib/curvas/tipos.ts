import type { DataHora } from "../util";

export type Sistema =
  | "SV580"
  | "SV520"
  | "DMC2051"
  | "DMC2051 Gráfico"
  | "Digisystem Relatório"
  | "Mahild"
  | "CRG08 HT"
  | "CRG08 KDHT";

export interface ProdutoCurva {
  descricao: string; // "MADEIRA DE PINUS SERRADA (1200.000X75.000X15.000)"
  quantidade: number; // peças / fardos
  m3: number | null;
}

/** Dados de uma curva de tratamento, já normalizados entre os diferentes sistemas. */
export interface Curva {
  sistema: Sistema;
  /** Identificação da empresa impressa na curva (quando existe). */
  cnpj: string | null;
  regMapa: string | null;
  nomeEmpresa: string | null;

  /** "KD" / "HT" quando a própria curva diz (SV580: "Finalizado (KD)"). */
  statusTipo: "KD" | "HT" | null;
  umidadeFinal: number | null;

  camara: string | null;
  /** Número do ciclo como vai no certificado: "UR020383PR190926", "Estufa 04 - Ciclo 208", "477". */
  ciclo: string | null;
  /** Lote "câmara-ciclo" quando a curva permite montar (SV580/SV520). */
  lote: string | null;

  /** Ciclo inteiro (usado na secagem KD). */
  cicloInicio: DataHora | null;
  cicloFim: DataHora | null;
  cicloDuracaoMin: number | null;

  /** Janela do tratamento térmico (HT). */
  htInicio: DataHora | null;
  htFim: DataHora | null;
  htDuracaoMin: number | null;

  /** Temperatura da curva: SV580 "Temperatura mínima"; Digisystem "Tt". */
  temperatura: number | null;

  produtos: ProdutoCurva[];
  totalM3: number | null;
  /** Volume em m³ como escrito na curva ("46.1106", "19,064"), quando não há tabela de produtos. */
  m3Bruto: string | null;
  /** Descrição livre do produto (Digisystem "Descrição: Paletes de madeira"). */
  descricao: string | null;
  /** Todo o texto livre sobre o produto (descrição, bitola, produtos) para extrair mm, fardos e m³. */
  textoProduto: string;
  /** O fim do ciclo não veio na curva (impressa antes do fim) e foi estimado. */
  fimEstimado: boolean;
  /** Duração que o certificado usa quando a curva fixa uma (Relatório novo: "programado: 360 min"). */
  duracaoFixa?: string | null;
}

export function curvaVazia(sistema: Sistema): Curva {
  return {
    sistema,
    cnpj: null,
    regMapa: null,
    nomeEmpresa: null,
    statusTipo: null,
    umidadeFinal: null,
    camara: null,
    ciclo: null,
    lote: null,
    cicloInicio: null,
    cicloFim: null,
    cicloDuracaoMin: null,
    htInicio: null,
    htFim: null,
    htDuracaoMin: null,
    temperatura: null,
    produtos: [],
    totalM3: null,
    m3Bruto: null,
    descricao: null,
    textoProduto: "",
    fimEstimado: false,
  };
}

/** Primeiro CNPJ do texto, aceitando "00,093,600/0001-41" e "78909348000193". */
export function primeiroCnpj(texto: string): string | null {
  const m =
    texto.match(/CNPJ:?\s*(\d{2}[.,]?\d{3}[.,]?\d{3}\/?\d{4}[-.]?\d{2})/i) ??
    texto.match(/(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  return m ? m[1].replace(/\D/g, "") : null;
}
