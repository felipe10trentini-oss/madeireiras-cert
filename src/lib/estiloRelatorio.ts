// Estilo do relatório do MAPA de cada empresa, aprendido das linhas já lançadas na
// planilha "<EMPRESA> - 2026.xlsx" (aba TÉRMICO). Cada empresa preenche do seu jeito
// ("09.26" x "009/2026", "FARDOS" x "Fardos", "07h31m" x "13:12", lote "2-367" x "1;82"...),
// e secagem (KD) e AQF costumam ser preenchidos de formas diferentes na mesma empresa.

export type Celula = string | number | { d: string } | { t: string } | { n: number } | null;

export interface EstiloGrupo {
  objetivo?: string;
  /** Objetivo usado nas linhas de embalagens (paletes, caixas...), quando difere do de madeira serrada. */
  objetivoEmbalagem?: string;
  /** Embalagens escritas como "Paletes de madeira" em vez de só "Paletes". */
  embalagemDeMadeira?: boolean;
  documento?: "MM.YY" | "M.YY" | "0MM/YYYY" | "MM/YYYY";
  produto?: string; // texto literal usado para madeira serrada ("MADEIRA SERRADA", "Madeira de Pinus")
  produtoComMm?: boolean;
  maiusculas?: boolean;
  /** Onde vai a contagem de embalagens: volumes (H/I) ou quantidade (J/K). */
  contagemEm?: "volumes" | "quantidade";
  preencheVolumes?: boolean; // secagem: o nº de fardos vai na coluna de volumes?
  unidadeVolumes?: string;
  unidadeQuantidade?: string;
  destino?: string;
  horario?: "h" | ":";
  modalidade?: string;
  estufa?: "numero" | "Estufa NN";
  ciclo?: "codigo" | "numero" | "E;C";
  /** Formato do ciclo quando a curva não tem código UR (Palletimber: SV520 "1024", SV580 "UR031513..."). */
  cicloSemCodigo?: "numero" | "E;C";
  duracao?: "hhmm" | "min" | "00hMMm" | "00hMMmin";
  lote?: "nosso" | "E;C" | "E-CCC" | "certificado" | "ciclo" | "concat";
  tomadorNihil?: boolean;
  tomadorMaiusculas?: boolean;
  localMaiusculas?: boolean;
}

export interface EstiloRelatorio {
  kd?: EstiloGrupo;
  aqf?: EstiloGrupo;
  processo?: string;
  dataDocumento?: string;
  rt?: string;
  volumesCamara?: Record<string, string>;
}

const txt = (c: Celula): string => {
  if (c == null) return "";
  if (typeof c === "string") return c.trim();
  if (typeof c === "number") return String(c);
  if ("d" in c) return c.d;
  if ("t" in c) return c.t;
  return String(c.n);
};

export const EMBALAGEM = /palete|pallet|embalage|caixa|kit|skid|suporte|tampa|engradado|bobina/i;

const ehMaiusculo = (s: string) => /[A-Za-zÀ-ú]/.test(s) && s === s.toUpperCase();

/** Chaves das colunas na ordem da planilha (A–X ou A–Z). */
const CAD = ["objetivo", "finalidade", "documento", "processo", "dataDocumento", "rt", "produto", "volumes", "unidadeVolumes",
  "quantidade", "unidadeQuantidade", "destino", "data", "horario", "modalidade", "camara", "volumeCamara", "ciclo",
  "temperatura", "duracao", "lote", "certificado", "processoCertificado", "dataEmissao"];
const CRED = ["objetivo", "finalidade", "documento", "processo", "dataDocumento", "tomador", "tomadorCnpj", "rt", "produto",
  "volumes", "unidadeVolumes", "quantidade", "unidadeQuantidade", "destino", "data", "horario", "local", "modalidade",
  "camara", "volumeCamara", "ciclo", "temperatura", "duracao", "certificado", "processoCertificado", "dataEmissao"];

function grupo(linhas: Record<string, string>[]): EstiloGrupo | undefined {
  if (!linhas.length) return undefined;
  const l = linhas[linhas.length - 1]; // a mais recente representa o padrão atual
  const g: EstiloGrupo = {};
  g.objetivo = l.objetivo || undefined;
  // Formato da programação: só linhas cujo nº é mês/trimestre (1–12); "077/2026" é comunicado.
  const doc = [...linhas].reverse().map((o) => o.documento).find((d) => {
    const m = d.match(/^(\d{1,3})[./](\d{2}|\d{4})$/);
    return !!m && parseInt(m[1], 10) >= 1 && parseInt(m[1], 10) <= 12;
  }) ?? "";
  if (/^\d{2}\.\d{2}$/.test(doc)) g.documento = "MM.YY";
  else if (/^\d\.\d{2}$/.test(doc)) g.documento = "M.YY";
  else if (/^0\d{2}\/\d{4}$/.test(doc)) g.documento = "0MM/YYYY";
  else if (/^\d{2}\/\d{4}$/.test(doc)) g.documento = "MM/YYYY";
  g.produto = l.produto || undefined;
  g.produtoComMm = /\d\s*mm/i.test(l.produto);
  g.maiusculas = ehMaiusculo(l.produto);
  const temVol = !!l.volumes || !!l.unidadeVolumes;
  const temQtd = !!l.quantidade;
  g.contagemEm = temVol && !temQtd ? "volumes" : "quantidade";
  g.preencheVolumes = !!l.volumes;
  g.unidadeVolumes = l.unidadeVolumes || undefined;
  g.unidadeQuantidade = l.unidadeQuantidade || undefined;
  g.destino = l.destino || undefined;
  g.horario = /:/.test(l.horario) ? ":" : /h/i.test(l.horario) ? "h" : undefined;
  g.modalidade = l.modalidade || undefined;
  g.estufa = /^Estufa/i.test(l.camara) ? "Estufa NN" : "numero";
  // Código UR usado nas linhas recentes vale para as curvas que têm código, mesmo que a última não tenha.
  if (/^UR/i.test(l.ciclo) || linhas.slice(-30).some((o) => /^UR/i.test(o.ciclo))) g.ciclo = "codigo";
  else if (/^\d+;\d+$/.test(l.ciclo)) g.ciclo = "E;C";
  else if (/^\d+$/.test(l.ciclo)) g.ciclo = "numero";
  const semUR = [...linhas].reverse().find((o) => o.ciclo && !/^UR/i.test(o.ciclo));
  if (semUR) g.cicloSemCodigo = /^\d+;\d+$/.test(semUR.ciclo) ? "E;C" : "numero";
  const dur = l.duracao;
  if (/^\d+$/.test(dur)) g.duracao = "min";
  else if (/^00h\d+min$/i.test(dur)) g.duracao = "00hMMmin";
  else if (/^00h\d+m$/i.test(dur)) g.duracao = "hhmm"; // "00h39m" é hh/mm: 80 min -> "01h20m", não "00h80m"
  else if (/^\d+h\d+m$/i.test(dur)) g.duracao = "hhmm";
  const lote = l.lote ?? "";
  const ur = l.ciclo.match(/^UR(\d{2})(\d{4})/i);
  if (lote && lote === l.certificado) g.lote = "certificado";
  else if (/^\d+;\d+$/.test(lote)) g.lote = "E;C";
  else if (/^\d+-0\d{2}$/.test(lote)) g.lote = "E-CCC";
  else if (/^\d+$/.test(lote) && ur && lote === `${parseInt(ur[1], 10)}${parseInt(ur[2], 10)}`) g.lote = "concat";
  else if (/^\d+$/.test(lote) && /^\d+$/.test(l.ciclo) && lote === `${parseInt(l.camara.match(/\d+/)?.[0] ?? "", 10)}${l.ciclo}`) g.lote = "concat";
  else if (/^\d+$/.test(lote) && (lote === l.ciclo || (ur && lote === String(parseInt(ur[2], 10))))) g.lote = "ciclo";
  else g.lote = "nosso";
  if (l.tomador !== undefined) {
    g.tomadorNihil = /^nihil$/i.test(l.tomador);
    g.tomadorMaiusculas = ehMaiusculo(l.tomador);
  }
  if (l.local !== undefined) g.localMaiusculas = ehMaiusculo(l.local);
  const emb = linhas.filter((o) => EMBALAGEM.test(o.produto) && !/serrad/i.test(o.produto));
  if (emb.length) {
    const e = emb[emb.length - 1];
    if (e.objetivo) g.objetivoEmbalagem = e.objetivo;
    g.embalagemDeMadeira = /de madeira\s*$/i.test(e.produto);
  }
  return g;
}

/** Aprende o estilo a partir das linhas da aba TÉRMICO (cabeçalho A–X ou A–Z). */
export function derivarEstilo(cabecalho: string[], linhas: Celula[][]): EstiloRelatorio | null {
  const n = cabecalho.filter(Boolean).length;
  const chaves = n >= 26 ? CRED : n >= 24 ? CAD : null;
  if (!chaves) return null;
  const objs = linhas
    .map((r) => Object.fromEntries(chaves.map((k, i) => [k, txt(r[i] ?? null)])) as Record<string, string>)
    .filter((o) => o.certificado || o.data);
  if (!objs.length) return null;
  const kd = objs.filter((o) => /estufa|secagem/i.test(o.modalidade));
  const aqf = objs.filter((o) => /aqf|ar quente|ht/i.test(o.modalidade) && !/estufa|secagem/i.test(o.modalidade));
  const ultima = objs[objs.length - 1];
  const volumesCamara: Record<string, string> = {};
  for (const o of objs) {
    const cam = o.camara.match(/(\d+)\s*$/)?.[1];
    if (cam && o.volumeCamara) volumesCamara[String(parseInt(cam, 10))] = o.volumeCamara;
  }
  return {
    kd: grupo(kd),
    aqf: grupo(aqf),
    processo: ultima.processo || undefined,
    dataDocumento: ultima.dataDocumento || undefined,
    rt: ultima.rt || undefined,
    volumesCamara,
  };
}
