import type { Comunicado } from "./comunicado";
import type { Curva, ProdutoCurva } from "./curvas/tipos";
import { lerNomeArquivo, type Madeireira } from "./madeireiras";
import { MODELOS, type Modelo, type ValoresCertificado } from "./modelos";
import { duracaoHM, horaFmt, m3BR, semAcento, tempBR, type DataHora } from "./util";

/**
 * KD  = secagem em estufa, umidade final < 18%
 * HT  = tratamento térmico em estufa (empresa KD/HT com umidade >= 18%)
 * AQF = ar quente forçado: empresas só HT, ou skids/suportes/paletes de empresa KD/HT
 */
export type TipoTratamento = "KD" | "HT" | "AQF";

export const UMIDADE_LIMITE_KD = 18;

export interface EntradaCertificado {
  curva: Curva;
  empresa: Madeireira;
  comunicado: Comunicado | null;
  nomeArquivo: string;
}

const EMBALAGEM = /PALET|PALLET|KIT|EMBALA|SKID|SUPORTE|CAIXA/;

function textoProdutos(e: EntradaCertificado): string {
  return semAcento(
    [e.comunicado?.produto, e.curva.descricao, ...e.curva.produtos.map((p) => p.descricao)].filter(Boolean).join(" ")
  ).toUpperCase();
}

/** Tipo sugerido pelas regras da equipe; o usuário pode trocar na tela. */
export function sugerirTipo(e: EntradaCertificado): { tipo: TipoTratamento; motivo: string } {
  const { empresa, curva } = e;
  const fazKD = empresa.tratamentos.includes("KD");
  const fazHT = empresa.tratamentos.includes("HT");
  if (fazHT && !fazKD) return { tipo: "AQF", motivo: "a empresa é habilitada só para HT" };
  if (fazKD && !fazHT) return { tipo: "KD", motivo: "a empresa é habilitada só para KD" };

  if (EMBALAGEM.test(textoProdutos(e))) {
    return { tipo: "AQF", motivo: "produto é embalagem/skid/suporte (exceção: ar quente forçado)" };
  }
  if (curva.umidadeFinal != null) {
    return curva.umidadeFinal < UMIDADE_LIMITE_KD
      ? { tipo: "KD", motivo: `umidade final ${tempBR(curva.umidadeFinal)}% (abaixo de ${UMIDADE_LIMITE_KD}%)` }
      : { tipo: "HT", motivo: `umidade final ${tempBR(curva.umidadeFinal)}% (${UMIDADE_LIMITE_KD}% ou mais)` };
  }
  if (curva.statusTipo) return { tipo: curva.statusTipo, motivo: `a curva indica "${curva.statusTipo}"` };
  return { tipo: "KD", motivo: "a curva não informa umidade — confira" };
}

export function modeloPara(empresa: Madeireira, tipo: TipoTratamento): Modelo {
  const cad = empresa.modalidade === "Credenciada" ? "credenciada" : "cadastrada";
  return MODELOS[`${cad}-${tipo === "AQF" ? "aqf" : "estufa"}`];
}

/** "... - CEP: 84.570-000 - Mallet – PR" -> "Mallet – PR" */
export function localDoEndereco(endereco: string | null): string {
  const m = endereco?.trim().match(/([^\-–;,:]+?)\s*([-–])\s*([A-Z]{2})\.?$/);
  return m ? `${m[1].trim()} ${m[2]} ${m[3]}` : "";
}

/** Menor dimensão da bitola = espessura: "17X145X2280" -> 17, "(1200.000X75.000X15.000)" -> 15. */
function espessura(descricao: string): number | null {
  const m = descricao.match(/(\d+(?:[.,]\d+)?)\s*[Xx]\s*(\d+(?:[.,]\d+)?)\s*[Xx]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  return Math.round(Math.min(...[m[1], m[2], m[3]].map((n) => parseFloat(n.replace(",", ".")))));
}

function descricaoMadeiraSerrada(produtos: ProdutoCurva[]): string {
  const txt = semAcento(produtos.map((p) => p.descricao).join(" ")).toUpperCase();
  const especies = [txt.includes("PINUS") && "pinus", txt.includes("EUCALIP") && "eucalipto"].filter(Boolean);
  const esp = [...new Set(produtos.map((p) => espessura(p.descricao)).filter((n): n is number => n != null))].sort(
    (a, b) => a - b
  );
  const base = `Madeira serrada de ${especies.length ? especies.join(" e ") : "pinus"}`;
  return esp.length ? `${base} ${esp.map((n) => `${n} mm`).join("; ")}` : base;
}

/** "Paletes de madeira" -> "paletes" (unidade da quantidade no certificado). */
function unidadeDoProduto(produto: string): string {
  return produto.replace(/\s+de madeira\s*$/i, "").trim().toLowerCase();
}

export interface CertificadoMontado {
  modelo: Modelo;
  valores: ValoresCertificado;
  avisos: string[];
  /** Período usado nas datas (para o relatório). */
  inicio: DataHora | null;
  duracaoTexto: string | null;
}

export function montarCertificado(e: EntradaCertificado, tipo: TipoTratamento): CertificadoMontado {
  const { curva, empresa, comunicado } = e;
  const avisos: string[] = [];
  const modelo = modeloPara(empresa, tipo);
  const arq = lerNomeArquivo(e.nomeArquivo);

  // Datas: KD usa o ciclo inteiro; HT/AQF usa a janela do tratamento.
  const usaCiclo = tipo === "KD" || !curva.htInicio;
  const inicio = usaCiclo ? curva.cicloInicio : curva.htInicio;
  const fim = usaCiclo ? curva.cicloFim : curva.htFim;
  const duracaoMin = usaCiclo ? curva.cicloDuracaoMin : curva.htDuracaoMin;
  const duracaoTexto =
    duracaoMin == null ? null : usaCiclo ? duracaoHM(duracaoMin) : `${duracaoMin} min`;
  if (tipo !== "KD" && !curva.htInicio) {
    avisos.push("A curva não marca o período do tratamento térmico: as datas usadas são as do ciclo inteiro.");
  }
  if (!inicio || !fim) avisos.push("Não foi possível ler início/término na curva — preencha as datas.");

  const temperatura = curva.temperatura != null && duracaoTexto
    ? `${tempBR(curva.temperatura)}°C / Duração: ${duracaoTexto}`
    : null;
  if (!temperatura) avisos.push("Temperatura/duração não encontradas na curva.");

  // Produto, volumes e quantidade.
  let produto: string | null = null;
  let volumes: string | null = null;
  let quantidade: string | null = null;
  const comM3 = curva.produtos.filter((p) => p.m3 != null);
  if (comunicado || (!comM3.length && curva.produtos.length)) {
    const nomeProduto = comunicado?.produto ?? curva.descricao ?? curva.produtos[0]?.descricao ?? null;
    const qtd = comunicado?.quantidade?.match(/\d+/)?.[0] ?? curva.produtos[0]?.quantidade?.toString() ?? null;
    produto = "Madeira reflorestada";
    volumes = nomeProduto;
    quantidade = qtd && nomeProduto ? `${qtd} ${unidadeDoProduto(nomeProduto)}` : qtd;
  } else if (comM3.length) {
    produto = descricaoMadeiraSerrada(comM3);
    const pecas = comM3.reduce((s, p) => s + p.quantidade, 0);
    volumes = `${pecas} ${empresa.unidadeVolumes || "Fardos"}`;
    const total = curva.totalM3 ?? comM3.reduce((s, p) => s + (p.m3 ?? 0), 0);
    quantidade = `${m3BR(total)} m³`;
  } else {
    avisos.push("Esta curva não traz produto nem cubagem: preencha descrição, volumes e quantidade (planilha do cliente).");
  }

  // Nº do comunicado ou da programação mensal (MM/AAAA do início).
  let numComunicado: string | null = null;
  if (comunicado?.numero) numComunicado = comunicado.numero;
  else if (empresa.documento === "comunicado") {
    avisos.push("Esta empresa usa comunicado por tratamento: envie o PDF do comunicado ou digite o número.");
  } else if (inicio) {
    numComunicado = inicio.data.slice(3); // "21/09/2026" -> "09/2026"
  }

  const ano = inicio?.data.slice(6) ?? String(new Date().getFullYear());
  const numero = arq.numero ? `${arq.numero}/${ano}` : "";
  if (!numero) avisos.push("Informe o número do certificado (não veio no nome do arquivo da curva).");

  const valores: ValoresCertificado = {
    numero,
    razao: empresa.razaoSocial,
    cnpj: empresa.cnpj,
    crea: empresa.crea,
    endereco: empresa.endereco,
    telefone: empresa.telefone,
    email: empresa.email,
    regMapa: empresa.regMapa,
    tomRazao: "Nihil",
    tomCnpj: "Nihil",
    tomEndereco: "Nihil",
    tomTelefone: "Nihil",
    tomEmail: "Nihil",
    comunicado: numComunicado,
    enderecoTrat: empresa.endereco,
    destino: "Estoque",
    produto,
    volumes,
    quantidade,
    lote: arq.lote ?? curva.lote ?? curva.ciclo,
    ciclo: curva.ciclo,
    marcas: "Nihil",
    modalidade: tipo === "AQF" ? "AQF - HT" : tipo,
    dataInicio: inicio?.data ?? null,
    horaInicio: inicio ? horaFmt(inicio.hora) : null,
    dataFim: fim?.data ?? null,
    horaFim: fim ? horaFmt(fim.hora) : null,
    temperatura,
    local: localDoEndereco(empresa.endereco),
  };
  return { modelo, valores, avisos, inicio, duracaoTexto };
}
