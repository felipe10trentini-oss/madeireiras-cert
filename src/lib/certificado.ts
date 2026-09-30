import type { Comunicado } from "./comunicado";
import type { Curva } from "./curvas/tipos";
import { lerNomeArquivo, type Madeireira } from "./madeireiras";
import { MODELOS, type Modelo, type ValoresCertificado } from "./modelos";
import { descricaoSerrada, fardos, frasePropria } from "./produtoTexto";
import type { Tomador } from "./relatorio";
import { duracaoHM, horaFmt, m3BR, semAcento, soDigitos, somarMinutos, tempBR, type DataHora } from "./util";

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
  /** Tomadores já preenchidos antes para esta empresa (por CNPJ só com dígitos). */
  tomadores?: Record<string, Tomador>;
  /** Último lote usado pela empresa (para empresas com lote sequencial, ex.: GM). */
  ultimoLote?: string | null;
}

/**
 * Padrões próprios de algumas empresas, observados nos certificados emitidos
 * (setembro/2026). Chave: CNPJ só com dígitos.
 */
interface RegraEmpresa {
  /** Unidade dos volumes quando a curva traz a contagem ("Tábuas" em vez de "Fardos"). */
  unidadeVolumes?: string;
  /** Lote com o ciclo em 3 dígitos: "4-43" -> "4-043". */
  loteTresDigitos?: boolean;
  /** O nº do certificado é o próprio lote ("11-298"). */
  numeroEhLote?: boolean;
  /** O lote é o nº do certificado ("247/2026"). */
  loteEhNumero?: boolean;
  destino?: string;
  /** Skids: "Madeira para suportes" / "N peças" / m³ (em vez de "Suportes de madeira" / "N unidades"). */
  suportesEmPecas?: boolean;
  /** Como a empresa escreve o ciclo do SV520: {e} estufa, {e2} estufa com 2 dígitos, {c} ciclo. */
  cicloSV520?: string;
  /** Minutos a somar ao término do tratamento HT/AQF (Madeico usa 1 minuto a menos). */
  ajusteFimMin?: number;
  /** Lote sequencial da empresa (GM: 820, 821…): o site sugere o último usado + 1. */
  loteSequencial?: boolean;
  /** Lote = ano (2 dígitos) + semana do ano do início do tratamento (MART: 01/09/2026 -> "2636"). */
  loteAnoSemana?: boolean;
  /** E-mail usado nos certificados, quando difere da planilha. */
  email?: string;
  /** Descrição do produto sempre igual nos certificados da empresa (MART). */
  produto?: string;
  /** Planilha de relatório do MAPA no modelo de cadastrada (A–X), mesmo sendo credenciada (Decorbras). */
  relatorioSemTomador?: boolean;
  /**
   * Prestadora de serviço (igual à Mann móvel): trata na casa do cliente, com comunicado
   * por tratamento. Tomador e endereço do tratamento são do cliente; produto e
   * quantidade vêm do comunicado; volumes "Nihil".
   */
  prestadora?: boolean;
  /**
   * Programação trimestral ("03/2026" = 3º trimestre). Sábado, domingo, feriado em SP ou
   * mais de dois tratamentos no dia exigem comunicado próprio (MART).
   */
  programacaoTrimestral?: boolean;
  /** Kits de paletes são sempre AQF em unidades (Maxi). */
  kitEhAqf?: boolean;
}

export const REGRAS_EMPRESA: Record<string, RegraEmpresa> = {
  "39271111000178": { unidadeVolumes: "Tábuas", suportesEmPecas: true }, // ABB Wood
  "73931933000176": { unidadeVolumes: "tábuas", loteTresDigitos: true, relatorioSemTomador: true }, // Decorbras
  "06941489000182": { loteTresDigitos: true }, // CL
  "49890808000180": { loteTresDigitos: true }, // Serraria Céu Azul
  "03298956000100": { numeroEhLote: true }, // Pinustan
  "02927182000176": { loteEhNumero: true }, // JJ Thomazi
  "24046686000110": { prestadora: true }, // Exata (prestadora de serviço, como a Mann móvel)
  "00093600000141": { prestadora: true }, // Mann Unid. Volante
  "21730230000186": { loteSequencial: true }, // GM
  "03636539000120": { loteAnoSemana: true, produto: "Madeira serrada para embalagens", programacaoTrimestral: true }, // MART
  "21495060000283": { kitEhAqf: true }, // Maxi
  "50709371000115": { email: "faturamento2@lgpallets.com.br" }, // LG Logística
  "83054544000163": { cicloSV520: "Estufa {e} - Ciclo {c}" }, // Salamoni (SV520 e Mahild)
  "93470243000174": { cicloSV520: "Estufa {e} Ciclo {c}" }, // Madesozo
  "79235917000125": { cicloSV520: "Estufa {e} Ciclo {c}" }, // Rio Verde
  "03917690000136": { cicloSV520: "Estufa {e2} Ciclo {c}" }, // Selva Norte
  "33094099000197": { cicloSV520: "Estufa {e2} Ciclo {c}" }, // São Jorge
  "00667464000156": { cicloSV520: "Estufa {e2} Ciclo {c}" }, // Videpinus
  "83951012000129": { ajusteFimMin: -1 }, // Madeico
};

/** Páscoa (algoritmo de Meeus) — base dos feriados móveis. */
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Sábado, domingo ou feriado em SP (nacionais, estadual 09/07 e móveis) — "dd/mm/aaaa" -> motivo ou null. */
export function diaSemComunicado(data: string): string | null {
  const [d, m, a] = data.split("/").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCDay() === 6) return "sábado";
  if (dt.getUTCDay() === 0) return "domingo";
  const fixos: Record<string, string> = {
    "01/01": "Confraternização Universal", "21/04": "Tiradentes", "01/05": "Dia do Trabalho",
    "09/07": "Revolução Constitucionalista (SP)", "07/09": "Independência", "12/10": "N. Sra. Aparecida",
    "02/11": "Finados", "15/11": "Proclamação da República", "20/11": "Consciência Negra", "25/12": "Natal",
  };
  const fixo = fixos[data.slice(0, 5)];
  if (fixo) return `feriado (${fixo})`;
  const p = pascoa(a).getTime();
  const dias = Math.round((dt.getTime() - p) / 86400000);
  const moveis: Record<number, string> = { [-48]: "Carnaval", [-47]: "Carnaval", [-2]: "Sexta-feira Santa", 60: "Corpus Christi" };
  return moveis[dias] ? `feriado (${moveis[dias]})` : null;
}

/** "Estufa 03 - Ciclo 761" no formato da empresa. */
function cicloNoFormato(ciclo: string | null, formato: string | undefined): string | null {
  const m = ciclo?.match(/Estufa\s*(\d+)\s*-?\s*Ciclo\s*(\d+)/i);
  if (!m || !formato) return ciclo;
  const e = parseInt(m[1], 10);
  return formato.replace("{e2}", String(e).padStart(2, "0")).replace("{e}", String(e)).replace("{c}", m[2]);
}

const regraDe = (e: Madeireira): RegraEmpresa => REGRAS_EMPRESA[soDigitos(e.cnpj)] ?? {};

const up = (s: string | null | undefined) => semAcento(s ?? "").toUpperCase();

/**
 * Embalagens (paletes, kits, caixas, skids) no comunicado ou na descrição da curva Digisystem.
 * Não contam: "Palete / Tábua" (rótulo genérico do SV580) e "madeira serrada para embalagens" (é madeira).
 */
const EMBALAGEM = /PALET|PALLET|KIT|EMBALA|SKID|SUPORTE|CAIXA|ENGRADADO/;
const SUPORTES = /SKID|SUPORTE/;

function ehEmbalagem(texto: string): boolean {
  return EMBALAGEM.test(up(texto).replace(/PALETE\s*\/\s*TABUA/g, "").replace(/PARA\s+EMBALAG\w*/g, ""));
}

/** Tipo sugerido pelas regras da equipe; o usuário pode trocar na tela. */
export function sugerirTipo(e: EntradaCertificado): { tipo: TipoTratamento; motivo: string } {
  const { empresa, curva, comunicado } = e;
  const fazKD = empresa.tratamentos.includes("KD");
  const fazHT = empresa.tratamentos.includes("HT");
  if (fazHT && !fazKD) return { tipo: "AQF", motivo: "a empresa é habilitada só para HT" };
  if (fazKD && !fazHT) return { tipo: "KD", motivo: "a empresa é habilitada só para KD" };

  if (regraDe(empresa).kitEhAqf && curva.produtos.some((p) => /\bKIT\b/.test(up(p.descricao)))) {
    return { tipo: "AQF", motivo: "kit de paletes (sempre AQF nesta empresa)" };
  }
  if (curva.sistema === "CRG08 HT") return { tipo: "AQF", motivo: "curva de equipamento HT (CRG08 HT)" };
  if (SUPORTES.test(up(curva.textoProduto)) || (comunicado?.produto && ehEmbalagem(comunicado.produto))) {
    return { tipo: "AQF", motivo: "produto é embalagem/skid/suporte (exceção: ar quente forçado)" };
  }
  if (!curva.produtos.some((p) => p.m3 != null) && curva.descricao && ehEmbalagem(curva.descricao)) {
    return { tipo: "AQF", motivo: "produto é embalagem (paletes/caixas)" };
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

/** "pallets de madeirs", "PALLETS DE MADEIRA" -> "Paletes de madeira". */
function normalizarProdutoComunicado(produto: string): string {
  let t = produto.trim().replace(/\s+/g, " ");
  t = t.replace(/\bpallets?\b/gi, "Paletes").replace(/\bmadei\w*\s*$/i, "madeira");
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

/** "Paletes de madeira" -> "paletes" (unidade da quantidade no certificado). */
function unidadeDoProduto(produto: string): string {
  return produto.replace(/\s+de\s+madei\w*\s*$/i, "").trim().toLowerCase();
}

/** "60 Paletes 1000x1200 mm 40 Kit caixas 1000x1200x680 mm" -> "60 Paletes (1000x1200mm) 40 Kit caixas (1000x1200x680mm)". */
function quantidadeDetalhada(q: string): string {
  return q
    .replace(/\s+/g, " ")
    .replace(/(?<!\()\b(\d+(?:[xX]\d+){1,2})\s*mm\b(?!\))/g, "($1mm)")
    .trim();
}

/** "31,00" -> "31"; "19,064" e "46.1106" ficam como estão. */
const m3Limpo = (bruto: string) => bruto.replace(/[.,]0+$/, "");

export interface CertificadoMontado {
  modelo: Modelo;
  valores: ValoresCertificado;
  avisos: string[];
  /** Período usado nas datas (para o relatório). */
  inicio: DataHora | null;
  duracaoTexto: string | null;
}

interface Produto {
  produto: string | null;
  volumes: string | null;
  quantidade: string | null;
}

function montarProduto(e: EntradaCertificado, tipo: TipoTratamento, avisos: string[]): Produto {
  const { curva, empresa, comunicado } = e;
  const regra = regraDe(empresa);
  const comM3 = curva.produtos.filter((p) => p.m3 != null);
  const texto = curva.textoProduto;

  // 0) Prestadora (Exata, Mann móvel): como no certificado da Mann móvel.
  if (regra.prestadora && comunicado?.produto) {
    const produto = normalizarProdutoComunicado(comunicado.produto);
    const q = (comunicado.quantidade ?? "").trim();
    const emM3 = /m[³3]/i.test(`${comunicado.volumes ?? ""} ${q}`);
    const numero = q.replace(/\s*m[³3].*$/i, "");
    return {
      produto,
      volumes: "Nihil",
      quantidade: !q ? null : emM3 ? `${m3Limpo(numero)} m³` : /^[\d.]+$/.test(q) ? `${q} ${unidadeDoProduto(produto)}` : quantidadeDetalhada(q),
    };
  }

  // 1) Comunicado de embalagens (paletes, kits, caixas): produto e quantidade vêm dele.
  if (comunicado?.produto && (ehEmbalagem(comunicado.produto) || (!comM3.length && curva.totalM3 == null))) {
    const volumes = normalizarProdutoComunicado(comunicado.produto);
    const q = (comunicado.quantidade ?? "").trim();
    const soNumero = /^[\d.]+$/.test(q);
    return {
      produto: "Madeira reflorestada",
      volumes,
      quantidade: !q ? null : soNumero ? `${q} ${unidadeDoProduto(volumes)}` : quantidadeDetalhada(q),
    };
  }

  // Kits de paletes (Maxi): "Kit paletes de madeira" / soma das unidades.
  if (comM3.length && regra.kitEhAqf && comM3.some((p) => /\bKIT\b/.test(up(p.descricao)))) {
    const unidades = comM3.reduce((s, p) => s + p.quantidade, 0);
    return { produto: "Madeira reflorestada", volumes: "Kit paletes de madeira", quantidade: `${unidades} unidades` };
  }

  // 2) Skids/suportes.
  if (comM3.length && SUPORTES.test(up(texto))) {
    const pecas = comM3.reduce((s, p) => s + p.quantidade, 0);
    const total = curva.totalM3 ?? comM3.reduce((s, p) => s + (p.m3 ?? 0), 0);
    return regra.suportesEmPecas
      ? { produto: "Madeira para suportes", volumes: `${pecas} peças`, quantidade: `${m3BR(total)} m³` }
      : { produto: "Madeira reflorestada", volumes: "Suportes de madeira", quantidade: `${pecas} unidades` };
  }

  // 3) Tabela de produtos com m³ (SV580).
  if (comM3.length) {
    const unidade = empresa.unidadeVolumes || regra.unidadeVolumes || "Fardos";
    // Contagem de fardos: citada no texto ("5 fardos", "48 GRADES") ou na coluna de
    // quantidade, quando é contagem de verdade (volume unitário pequeno). "1" com
    // dezenas de m³ não é contagem -> "Nihil".
    const citados = fardos(texto);
    const ehContagem = comM3.every((p) => p.quantidade > 1 && (p.m3 ?? 0) / p.quantidade <= 5);
    const pecas = comM3.reduce((s, p) => s + p.quantidade, 0);
    const volumes = citados != null ? `${citados} ${unidade}` : ehContagem ? `${pecas} ${unidade}` : "Nihil";
    const total = curva.totalM3 ?? comM3.reduce((s, p) => s + (p.m3 ?? 0), 0);
    return { produto: descricaoSerrada(texto), volumes, quantidade: `${m3BR(total)} m³` };
  }

  // 4) Digisystem sem tabela: paletes contados em peças/unidades.
  if (curva.produtos.length && curva.totalM3 == null) {
    const nome = normalizarProdutoComunicado(curva.descricao ?? curva.produtos[0].descricao);
    return {
      produto: "Madeira reflorestada",
      volumes: nome,
      quantidade: `${curva.produtos[0].quantidade} ${unidadeDoProduto(nome)}`,
    };
  }

  // Mahild (Salamoni): só m³ e espécie; bitola e fardos são digitados.
  if (curva.sistema === "Mahild") {
    avisos.push("A curva Mahild não traz bitola nem fardos: complete a descrição (mm) e os volumes.");
    return {
      produto: descricaoSerrada(texto),
      volumes: null,
      quantidade: curva.totalM3 != null ? `${m3BR(curva.totalM3)} m³` : null,
    };
  }

  // 5) Digisystem com m³ escrito na descrição/bitola ("com 85 M3", "54m³", "Volume total: 19,064m³").
  if (curva.totalM3 != null) {
    const nFardos = fardos(texto);
    const volumes = nFardos != null ? `${nFardos} ${empresa.unidadeVolumes || regra.unidadeVolumes || "Fardos"}` : "Nihil";
    if (tipo === "AQF" && (!empresa.tratamentos.includes("KD") || regra.prestadora) && curva.descricao && /MADEIRA/.test(up(curva.descricao))) {
      // Empresas só HT que fazem embalagem (LG, MART) e prestadoras (Exata): a descrição da curva, m³ como escrito.
      return { produto: frasePropria(curva.descricao), volumes, quantidade: `${m3Limpo(curva.m3Bruto ?? String(curva.totalM3))} m³` };
    }
    return { produto: descricaoSerrada(texto), volumes, quantidade: `${m3BR(curva.totalM3)} m³` };
  }

  avisos.push("Esta curva não traz produto nem cubagem: preencha descrição, volumes e quantidade (planilha do cliente).");
  return { produto: null, volumes: null, quantidade: null };
}

/** Ano (2 dígitos) + semana ISO do ano: "01/09/2026" -> "2636". */
export function anoSemana(data: string): string {
  const [d, m, a] = data.split("/").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  const diaSemana = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - diaSemana); // quinta-feira da mesma semana
  const inicioAno = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((dt.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
  return `${String(dt.getUTCFullYear()).slice(2)}${String(semana).padStart(2, "0")}`;
}

/** "4-43" -> "4-043" */
const loteTres = (lote: string) => lote.replace(/^(\d+)-(\d{1,2})$/, (_, a: string, b: string) => `${a}-${b.padStart(3, "0")}`);

export function montarCertificado(e: EntradaCertificado, tipo: TipoTratamento): CertificadoMontado {
  const { curva, empresa, comunicado } = e;
  const regra = regraDe(empresa);
  const avisos: string[] = [];
  const modelo = modeloPara(empresa, tipo);
  const arq = lerNomeArquivo(e.nomeArquivo);

  // Datas: KD usa o ciclo inteiro; HT/AQF usa a janela do tratamento.
  const usaCiclo = tipo === "KD" || !curva.htInicio;
  const inicio = usaCiclo ? curva.cicloInicio : curva.htInicio;
  const fimHT = curva.htFim && regra.ajusteFimMin ? somarMinutos(curva.htFim, regra.ajusteFimMin) : curva.htFim;
  const fim = usaCiclo ? curva.cicloFim : fimHT;
  const duracaoMin = usaCiclo ? curva.cicloDuracaoMin : curva.htDuracaoMin;
  const duracaoTexto =
    usaCiclo && curva.duracaoFixa
      ? curva.duracaoFixa
      : duracaoMin == null
        ? null
        : usaCiclo
          ? duracaoHM(duracaoMin)
          : `${duracaoMin} min`;
  if (tipo !== "KD" && !curva.htInicio) {
    avisos.push("A curva não marca o período do tratamento térmico: as datas usadas são as do ciclo inteiro.");
  }
  if (usaCiclo && curva.fimEstimado) {
    avisos.push("A curva foi impressa antes do fim da secagem: o término foi estimado (início + tempo total). Confira.");
  }
  if (!inicio || !fim) avisos.push("Não foi possível ler início/término na curva — preencha as datas.");

  const temperatura =
    curva.temperatura != null && duracaoTexto ? `${tempBR(curva.temperatura)}°C / Duração: ${duracaoTexto}` : null;
  if (!temperatura) avisos.push("Temperatura/duração não encontradas na curva.");

  const montadoProduto = montarProduto(e, tipo, avisos);
  const { volumes, quantidade } = montadoProduto;
  const produto = regra.produto ?? montadoProduto.produto;
  // "1.234,5 m³" (milhar) ou "46.1106 m³" (ponto decimal da curva)
  const q = (quantidade ?? "").replace(/\s*m³.*$/, "");
  const m3 = parseFloat(q.includes(",") ? q.replace(/\./g, "").replace(",", ".") : q);
  if (/m³/.test(quantidade ?? "") && m3 > 400) avisos.push(`Quantidade de ${quantidade} parece alta — confira (pode ser erro de leitura).`);

  // Nº do comunicado ou da programação mensal (MM/AAAA do início).
  let numComunicado: string | null = null;
  if (comunicado?.numero) numComunicado = comunicado.numero;
  else if (empresa.documento === "comunicado" || regra.prestadora) {
    avisos.push("Esta empresa usa comunicado por tratamento: envie o PDF do comunicado ou digite o número.");
  } else if (inicio && regra.programacaoTrimestral) {
    const dia = diaSemComunicado(inicio.data);
    if (dia) avisos.push(`Tratamento em ${dia}: esta empresa precisa de comunicado próprio — envie o PDF ou digite o número.`);
    else {
      const [, mes, ano] = inicio.data.split("/");
      numComunicado = `${String(Math.ceil(parseInt(mes, 10) / 3)).padStart(2, "0")}/${ano}`; // 3º trimestre -> "03/2026"
      avisos.push("Programação trimestral: se for o 3º tratamento do dia (ou mais), use comunicado.");
    }
  } else if (inicio) {
    numComunicado = inicio.data.slice(3); // "21/09/2026" -> "09/2026"
  }
  // Ciclo que atravessa o mês (ou o trimestre): pode ser lançado na programação do início ou do término.
  const fimCiclo = curva.cicloFim ?? fim;
  if (numComunicado && !comunicado?.numero && inicio && fimCiclo && empresa.documento !== "comunicado" && !regra.prestadora) {
    const periodo = (data: string) => {
      const [, mes, ano] = data.split("/");
      return regra.programacaoTrimestral
        ? `${String(Math.ceil(parseInt(mes, 10) / 3)).padStart(2, "0")}/${ano}`
        : `${mes}/${ano}`;
    };
    const doFim = periodo(fimCiclo.data);
    if (doFim !== numComunicado) {
      avisos.push(
        `O ciclo começou em ${inicio.data} e terminou em ${fimCiclo.data}: pode ser lançado na programação ${numComunicado} ou ${doFim}. ` +
          `Está ${numComunicado}; para lançar na ${doFim}, troque no campo do comunicado/programação.`
      );
    }
  }

  let lote = arq.lote ?? curva.lote ?? curva.ciclo;
  if (lote && regra.loteTresDigitos) lote = loteTres(lote);
  if (regra.loteAnoSemana && inicio) lote = anoSemana(inicio.data);
  if (arq.loteInformado) {
    // Lote informado no nome do arquivo ("165 GM 1-446(833)") vale sobre as outras regras.
    lote = arq.loteInformado;
  } else if (regra.loteSequencial) {
    const ultimo = parseInt(e.ultimoLote ?? "", 10);
    if (Number.isFinite(ultimo)) lote = String(ultimo + 1);
    else {
      lote = null;
      avisos.push("Lote desta empresa: coloque no fim do nome da curva, ex.: \"165 GM 1-446(833)\", ou digite o lote.");
    }
  }

  const ano = inicio?.data.slice(6) ?? String(new Date().getFullYear());
  let numero = arq.numero ? `${arq.numero}/${ano}` : "";
  if (regra.numeroEhLote && lote) numero = lote;
  if (regra.loteEhNumero && numero) lote = numero;
  if (!numero) avisos.push("Informe o número do certificado (não veio no nome do arquivo da curva).");

  // Credenciada: tomador "Nihil", a não ser que o comunicado traga outra empresa.
  const tomadorOutro =
    (empresa.modalidade === "Credenciada" || regra.prestadora) &&
    comunicado?.tomadorCnpj &&
    soDigitos(comunicado.tomadorCnpj) !== soDigitos(empresa.cnpj);
  const salvo = tomadorOutro ? e.tomadores?.[soDigitos(comunicado!.tomadorCnpj)] : undefined;
  if (tomadorOutro && !salvo) {
    avisos.push("O comunicado traz outro tomador: preencha endereço, telefone e e-mail dele (fica salvo para as próximas vezes).");
  }

  const valores: ValoresCertificado = {
    numero,
    razao: empresa.razaoSocial,
    cnpj: empresa.cnpj,
    crea: empresa.crea,
    endereco: empresa.endereco,
    telefone: empresa.telefone,
    email: regra.email ?? empresa.email,
    regMapa: empresa.regMapa,
    tomRazao: tomadorOutro ? (salvo?.razao ?? comunicado!.tomadorNome) : "Nihil",
    tomCnpj: tomadorOutro ? (salvo?.cnpj ?? comunicado!.tomadorCnpj) : "Nihil",
    tomEndereco: tomadorOutro ? (salvo?.endereco ?? "") : "Nihil",
    tomTelefone: tomadorOutro ? (salvo?.telefone ?? "") : "Nihil",
    tomEmail: tomadorOutro ? (salvo?.email ?? "") : "Nihil",
    comunicado: numComunicado,
    // Prestadora trata na casa do cliente: endereço do comunicado.
    enderecoTrat: regra.prestadora ? (comunicado?.endereco ?? salvo?.endereco ?? null) : empresa.endereco,
    destino: regra.destino ?? "Estoque",
    produto,
    volumes,
    quantidade,
    lote,
    ciclo: curva.sistema === "SV520" || curva.sistema === "Mahild" ? cicloNoFormato(curva.ciclo, regra.cicloSV520) : curva.ciclo,
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
