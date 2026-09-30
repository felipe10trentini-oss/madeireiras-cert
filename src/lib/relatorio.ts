// Linha da aba TÉRMICO do relatório mensal do MAPA. Cadastradas usam as colunas
// A–X (com "Lote"); credenciadas usam A–Z (com o tomador do serviço).

import type { TipoTratamento } from "./certificado";
import type { Madeireira } from "./madeireiras";
import type { ValoresCertificado } from "./modelos";
import { REGRAS_EMPRESA } from "./certificado";
import { EMBALAGEM, type EstiloGrupo, type EstiloRelatorio } from "./estiloRelatorio";
import { hojeBR, soDigitos } from "./util";

/** Dados do relatório que não estão na curva e se repetem: ficam salvos por empresa. */
export interface PadraoRelatorio {
  processo?: string; // nº do processo da programação/comunicado no SEI
  dataDocumento?: string; // data da programação do mês
  rt?: string; // nome completo do responsável técnico
  volumesCamara?: Record<string, string>; // câmara -> volume (m³)
  /** Último lote numérico usado (empresas com lote sequencial, ex.: GM). */
  ultimoLote?: string;
  /** Tomadores já usados nos certificados (credenciadas), por CNPJ só com dígitos. */
  tomadores?: Record<string, Tomador>;
  /** Último ciclo emitido em cada estufa ("1" -> 25), para avisar quando falta curva. */
  ciclos?: Record<string, number>;
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

/** Modelo da planilha de relatório da empresa: A–Z (credenciadas, com tomador) ou A–X. */
export function colunasRelatorio(empresa: Madeireira): Coluna[] {
  const semTomador = REGRAS_EMPRESA[soDigitos(empresa.cnpj)]?.relatorioSemTomador;
  return empresa.modalidade === "Credenciada" && !semTomador ? COLUNAS_CREDENCIADA : COLUNAS_CADASTRADA;
}

const up = (s: string | null | undefined) => (s ?? "").toUpperCase();

/** Número do documento no formato da empresa. Programação "09/2026" -> "09.26" / "9.26" / "009/2026". */
function formatarDocumento(n: string | null | undefined, formato: EstiloGrupo["documento"]): string {
  const m = n?.match(/^(\d{1,3})\/(\d{4})$/);
  if (!m) return n ?? "";
  const mes = parseInt(m[1], 10);
  // Nº de comunicado ("099/2026") não é mês: só a programação (mês 1–12 com 2 dígitos) muda de formato.
  const ehProgramacao = m[1].length <= 2 && mes >= 1 && mes <= 12;
  if (!ehProgramacao) return `${m[1].padStart(3, "0")}/${m[2]}`;
  switch (formato) {
    case "MM.YY":
      return `${String(mes).padStart(2, "0")}.${m[2].slice(2)}`;
    case "M.YY":
      return `${mes}.${m[2].slice(2)}`;
    case "MM/YYYY":
      return `${String(mes).padStart(2, "0")}/${m[2]}`;
    default:
      return `${String(mes).padStart(3, "0")}/${m[2]}`;
  }
}

/** Nº do ciclo: "UR030851PR160926" -> 851; "Estufa 01 - Ciclo 279" -> 279; "477" -> 477. */
function numeroCiclo(ciclo: string): { estufa: number | null; numero: string } {
  const ur = ciclo.match(/^UR(\d{2})(\d{4})/i);
  if (ur) return { estufa: parseInt(ur[1], 10), numero: String(parseInt(ur[2], 10)) };
  const ec = ciclo.match(/Estufa\s*(\d+)\D+Ciclo\s*(\d+)/i);
  if (ec) return { estufa: parseInt(ec[1], 10), numero: String(parseInt(ec[2], 10)) };
  return { estufa: null, numero: ciclo.match(/\d+/)?.[0] ?? ciclo };
}

export function montarLinhaRelatorio(args: {
  empresa: Madeireira;
  valores: ValoresCertificado;
  tipo: TipoTratamento;
  camara: string | null;
  padrao: PadraoRelatorio;
  /** Estilo aprendido da planilha de relatório da empresa (quando existe). */
  estilo?: EstiloRelatorio | null;
}): LinhaRelatorio {
  const { empresa, valores: v, tipo, camara, padrao, estilo } = args;
  const aqf = tipo === "AQF";
  const g: EstiloGrupo = (aqf ? (estilo?.aqf ?? estilo?.kd) : (estilo?.kd ?? estilo?.aqf)) ?? {};
  const caixa = (s: string) => (g.maiusculas ? up(s) : s);

  // "209,088 m³" -> 209,088 / m³ ; "720 paletes" -> 720 / Unidades
  const mQ = (v.quantidade ?? "").match(/^([\d.,]+)\s*(.*)$/);
  const emM3 = /m³/.test(v.quantidade ?? "");
  const mV = (v.volumes ?? "").match(/^(\d+)\s+(.*)$/);
  const tomadorNihil = !v.tomRazao || /^nihil$/i.test(v.tomRazao);
  const mTemp = (v.temperatura ?? "").match(/^([\d,]+)°C\s*\/\s*Dura[çc][ãa]o:\s*(.+)$/);
  // Excel em pt-BR: "46.1106" (ponto decimal da curva) precisa ir como "46,1106".
  const qtd = mQ ? (/^\d+\.\d+$/.test(mQ[1]) && !/^\d{1,3}\.\d{3}$/.test(mQ[1]) ? mQ[1].replace(".", ",") : mQ[1]) : "";

  // Produto, volumes e quantidade.
  let produto: string;
  let volumes = "";
  let unidadeVolumes = "";
  let quantidade = "";
  let unidadeQuantidade = "";
  if (emM3) {
    const nosso = (v.produto ?? "").replace(/\s+\d+(?:,\d+)?\s*mm.*$/i, "");
    if (g.produto && !g.produtoComMm && /madeira|mad\./i.test(g.produto) && /madeira/i.test(nosso)) {
      // Texto da empresa ("MADEIRA SERRADA", "Madeira de Pinus"), trocando a espécie se for outra.
      const euc = /eucalipto/i.test(nosso) && !/pinus/i.test(nosso);
      produto = euc ? g.produto.replace(/pinus/i, (p) => (p === p.toUpperCase() ? "EUCALIPTO" : "eucalipto")) : g.produto;
    } else produto = caixa(g.produtoComMm ? (v.produto ?? "") : nosso);
    if (mV && (g.preencheVolumes ?? true)) volumes = mV[1];
    unidadeVolumes = mV || g.unidadeVolumes ? (g.unidadeVolumes ?? caixa(up(mV?.[2] ?? ""))) : "";
    quantidade = qtd;
    unidadeQuantidade = g.unidadeQuantidade ?? "m³";
  } else {
    // Embalagens contadas ("720 paletes"): produto = descrição das embalagens.
    produto = v.volumes && !/^\d/.test(v.volumes) ? v.volumes : (v.produto ?? "");
    if (g.embalagemDeMadeira && EMBALAGEM.test(produto) && !/madeira/i.test(produto)) produto += " de madeira";
    produto = caixa(produto);
    const unidade = g.contagemEm === "volumes" ? (g.unidadeVolumes ?? "Unidades") : (g.unidadeQuantidade ?? caixa("Unidades"));
    if (g.contagemEm === "volumes") {
      volumes = qtd;
      unidadeVolumes = unidade;
    } else {
      quantidade = qtd;
      unidadeQuantidade = unidade;
    }
  }

  const { estufa: estufaCiclo, numero } = numeroCiclo(v.ciclo ?? "");
  const cam = camara ?? (estufaCiclo != null ? String(estufaCiclo) : "");
  let ciclo = v.ciclo ?? "";
  // Curva sem código UR numa empresa que usa o código: formato das linhas sem UR (ex.: SV520 da Palletimber).
  const formatoCiclo = g.ciclo === "codigo" && !/^UR/i.test(ciclo) ? (g.cicloSemCodigo ?? "numero") : g.ciclo;
  if (formatoCiclo === "numero") ciclo = numero;
  else if (formatoCiclo === "E;C" && cam) ciclo = `${cam};${numero}`;

  const duracaoTexto = mTemp ? mTemp[2] : "";
  const minutos = duracaoTexto.match(/^(\d+)\s*min$/)?.[1];
  const hm = duracaoTexto.match(/^(\d+)h(\d+)m$/);
  let duracao = minutos ?? duracaoTexto;
  if (minutos) {
    const hh = String(Math.floor(+minutos / 60)).padStart(2, "0");
    const mm = String(+minutos % 60).padStart(2, "0");
    if (g.duracao === "00hMMmin") duracao = `${hh}h${mm}min`;
    else if (g.duracao === "hhmm" || g.duracao === "00hMMm") duracao = `${hh}h${mm}m`;
  } else if (hm && g.duracao === "min") duracao = String(parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10));

  let lote = v.lote ?? "";
  const mL = lote.match(/^(\d+)-(\d+)$/);
  if (g.lote === "certificado") lote = v.numero ?? lote;
  else if (g.lote === "ciclo") lote = numero;
  else if (g.lote === "E;C") lote = mL ? `${parseInt(mL[1], 10)};${parseInt(mL[2], 10)}` : cam ? `${cam};${numero}` : lote;
  else if (g.lote === "E-CCC" && mL) lote = `${parseInt(mL[1], 10)}-${mL[2].padStart(3, "0")}`;
  else if (g.lote === "concat") lote = mL ? `${parseInt(mL[1], 10)}${parseInt(mL[2], 10)}` : `${cam}${numero}`;

  const horario = g.horario === ":" ? (v.horaInicio ?? "").replace(/^(\d{2})h(\d{2})m$/, "$1:$2") : (v.horaInicio ?? "");
  const tomadorTexto = tomadorNihil ? empresa.razaoSocial : (v.tomRazao ?? "");
  // "000 TUNAS DO PARANÁ - PR" -> "TUNAS DO PARANÁ" (sobra de número do endereço no comunicado)
  const local = (v.local ?? "").replace(/\s*[-–]\s*[A-Z]{2}$/, "").replace(/^\d+\s+/, "");

  return {
    // AQF e embalagens (paletes, caixas, kits, skids, suportes): sempre atendimento à NIMF 15, no texto
    // que a planilha da empresa já usa ("1. Atendimento à NIMF 15;" na Exata). Secagem: o da empresa.
    objetivo:
      aqf || (EMBALAGEM.test(`${produto} ${v.volumes ?? ""}`) && !/serrad/i.test(produto))
        ? (estilo?.objetivoNimf ?? "Atendimento à NIMF15")
        : (g.objetivo && !/nimf/i.test(g.objetivo) ? g.objetivo : "Certificação fitossanitária"),
    finalidade: "Exp.",
    documento: formatarDocumento(v.comunicado, g.documento),
    processo: padrao.processo ?? estilo?.processo ?? "",
    dataDocumento: padrao.dataDocumento ?? estilo?.dataDocumento ?? "",
    tomador: g.tomadorNihil ? "NIHIL" : g.tomadorMaiusculas === false ? tomadorTexto : up(tomadorTexto),
    tomadorCnpj: g.tomadorNihil ? "NIHIL" : tomadorNihil ? empresa.cnpj : (v.tomCnpj ?? ""),
    rt: padrao.rt ?? estilo?.rt ?? empresa.rt ?? "",
    produto,
    volumes,
    unidadeVolumes,
    quantidade,
    unidadeQuantidade,
    destino: g.destino ?? "INDEFINIDO",
    data: v.dataInicio ?? "",
    horario,
    local: g.localMaiusculas === false ? local : up(local),
    modalidade: g.modalidade ?? (aqf ? "AQF" : "Secagem em Estufa"),
    camara: g.estufa === "Estufa NN" && cam ? `Estufa ${cam.padStart(2, "0")}` : cam,
    volumeCamara: (cam && (padrao.volumesCamara?.[cam] || estilo?.volumesCamara?.[cam])) || "",
    ciclo,
    temperatura: mTemp ? mTemp[1] : "",
    duracao,
    lote,
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
