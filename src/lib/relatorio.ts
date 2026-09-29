// Linha da aba TÉRMICO do relatório mensal do MAPA. Cadastradas usam as colunas
// A–X (com "Lote"); credenciadas usam A–Z (com o tomador do serviço).

import type { TipoTratamento } from "./certificado";
import type { Madeireira } from "./madeireiras";
import type { ValoresCertificado } from "./modelos";
import { hojeBR } from "./util";

/** Dados do relatório que não estão na curva e se repetem: ficam salvos por empresa. */
export interface PadraoRelatorio {
  processo?: string; // nº do processo da programação/comunicado no SEI
  dataDocumento?: string; // data da programação do mês
  rt?: string; // nome completo do responsável técnico
  volumesCamara?: Record<string, string>; // câmara -> volume (m³)
  /** Tomadores já usados nos certificados (credenciadas), por CNPJ só com dígitos. */
  tomadores?: Record<string, Tomador>;
}

export interface Tomador {
  razao: string;
  cnpj: string;
  endereco: string;
  telefone: string;
  email: string;
}

type Coluna = { key: string; titulo: string };

const C = (key: string, titulo: string): Coluna => ({ key, titulo });

export const COLUNAS_CADASTRADA: Coluna[] = [
  C("objetivo", "Objetivo do Tratamento"),
  C("finalidade", "Finalidade"),
  C("documento", "Nº Comunicado/Programação"),
  C("processo", "Nº do Processo do Comunicado/Programação"),
  C("dataDocumento", "Data do Comunicado/Programação"),
  C("rt", "Responsável Técnico"),
  C("produto", "Produto Tratado"),
  C("volumes", "Número de volumes"),
  C("unidadeVolumes", "Unidade"),
  C("quantidade", "Quantidade de Produto Tratado"),
  C("unidadeQuantidade", "Unidade"),
  C("destino", "Destino"),
  C("data", "Data do Tratamento"),
  C("horario", "Horário do Início"),
  C("modalidade", "Modalidade"),
  C("camara", "Identificação da unidade de tratamento"),
  C("volumeCamara", "Volume da Câmara (m³)"),
  C("ciclo", "Número do Ciclo"),
  C("temperatura", "Temperatura (ºC)"),
  C("duracao", "Duração"),
  C("lote", "Lote"),
  C("certificado", "Nº do Certificado"),
  C("processoCertificado", "Nº do processo do Certificado"),
  C("dataEmissao", "Data de emissão"),
];

export const COLUNAS_CREDENCIADA: Coluna[] = [
  C("objetivo", "Objetivo do Tratamento"),
  C("finalidade", "Finalidade"),
  C("documento", "Nº Comunicado/Programação"),
  C("processo", "Nº do Processo do Comunicado/Programação"),
  C("dataDocumento", "Data do Comunicado/Programação"),
  C("tomador", "Empresa Tomadora do Serviço"),
  C("tomadorCnpj", "CNPJ do Tomador"),
  C("rt", "Responsável Técnico"),
  C("produto", "Produto Tratado"),
  C("volumes", "Número de volumes"),
  C("unidadeVolumes", "Unidade"),
  C("quantidade", "Quantidade de Produto Tratado"),
  C("unidadeQuantidade", "Unidade"),
  C("destino", "País"),
  C("data", "Data do Tratamento"),
  C("horario", "Horário do Início"),
  C("local", "Local do Tratamento"),
  C("modalidade", "Modalidade"),
  C("camara", "Identificação da unidade de tratamento"),
  C("volumeCamara", "Volume da Câmara (m³)"),
  C("ciclo", "Número do Ciclo"),
  C("temperatura", "Temperatura (ºC)"),
  C("duracao", "Duração"),
  C("certificado", "Nº do Certificado"),
  C("processoCertificado", "Nº do processo do Certificado"),
  C("dataEmissao", "Data de emissão"),
];

export type LinhaRelatorio = Record<string, string>;

export function colunasRelatorio(empresa: Madeireira): Coluna[] {
  return empresa.modalidade === "Credenciada" ? COLUNAS_CREDENCIADA : COLUNAS_CADASTRADA;
}

const up = (s: string | null | undefined) => (s ?? "").toUpperCase();

/** "09/2026" -> "009/2026" (o relatório usa 3 dígitos). */
function documento3(n: string | null | undefined): string {
  const m = n?.match(/^(\d{1,3})\/(\d{4})$/);
  return m ? `${m[1].padStart(3, "0")}/${m[2]}` : (n ?? "");
}

export function montarLinhaRelatorio(args: {
  empresa: Madeireira;
  valores: ValoresCertificado;
  tipo: TipoTratamento;
  camara: string | null;
  padrao: PadraoRelatorio;
}): LinhaRelatorio {
  const { empresa, valores: v, tipo, camara, padrao } = args;

  // "209,088 m³" -> 209,088 / m³ ; "720 paletes" -> 720 / Unidades
  const mQ = (v.quantidade ?? "").match(/^([\d.,]+)\s*(.*)$/);
  const emM3 = /m³/.test(v.quantidade ?? "");
  const mV = (v.volumes ?? "").match(/^(\d+)\s+(.*)$/);
  const produtoRel = emM3 ? up(v.produto?.replace(/\s+\d+\s*mm.*$/i, "")) : up(v.volumes ?? v.produto);
  const tomadorNihil = !v.tomRazao || /^nihil$/i.test(v.tomRazao);
  const mTemp = (v.temperatura ?? "").match(/^([\d,]+)°C\s*\/\s*Dura[çc][ãa]o:\s*(.+)$/);

  return {
    objetivo: "Certificação fitossanitária",
    finalidade: "Exp.",
    documento: documento3(v.comunicado),
    processo: padrao.processo ?? "",
    dataDocumento: padrao.dataDocumento ?? "",
    tomador: tomadorNihil ? up(empresa.razaoSocial) : up(v.tomRazao),
    tomadorCnpj: tomadorNihil ? empresa.cnpj : (v.tomCnpj ?? ""),
    rt: padrao.rt ?? empresa.rt ?? "",
    produto: produtoRel,
    volumes: emM3 && mV ? mV[1] : "",
    unidadeVolumes: emM3 && mV ? up(mV[2]) : "",
    // Excel em pt-BR: "46.1106" (ponto decimal da curva) precisa ir como "46,1106".
    quantidade: mQ ? (/^\d+\.\d+$/.test(mQ[1]) && !/^\d{1,3}\.\d{3}$/.test(mQ[1]) ? mQ[1].replace(".", ",") : mQ[1]) : "",
    unidadeQuantidade: emM3 ? "m³" : "Unidades",
    destino: "INDEFINIDO",
    data: v.dataInicio ?? "",
    horario: v.horaInicio ?? "",
    local: up((v.local ?? "").replace(/\s*[-–]\s*[A-Z]{2}$/, "")),
    modalidade: tipo === "AQF" ? "AQF - HT" : "Secagem em Estufa",
    camara: camara ?? "",
    volumeCamara: (camara && padrao.volumesCamara?.[camara]) || "",
    ciclo: v.ciclo ?? "",
    temperatura: mTemp ? mTemp[1] : "",
    duracao: mTemp ? mTemp[2].replace(/\s*min$/, "") : "",
    lote: v.lote ?? "",
    certificado: v.numero ?? "",
    processoCertificado: "",
    dataEmissao: hojeBR(),
  };
}

const limpar = (s: string | undefined) => (s ?? "").replace(/[\t\r\n]+/g, " ").trim();

/** Linha separada por TAB: cola direto a partir da coluna A do Excel. */
export function linhaParaTsv(colunas: Coluna[], linha: LinhaRelatorio): string {
  return colunas.map((c) => limpar(linha[c.key])).join("\t");
}
