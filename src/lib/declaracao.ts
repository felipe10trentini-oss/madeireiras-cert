// Declaração de tratamento fitossanitário (embalagens e madeira para exportação), bilíngue.
// Dados e textos comuns da declaração: o tratamento vem do mestre ou da DR, a remessa da nota
// fiscal ou do operador. O PDF sai em declaracaoPdf.ts.
import { localDoEndereco } from "./certificado";
import type { CertificadoMestre } from "./certificadoMestre";
import type { Madeireira } from "./madeireiras";
import { rtCompleto } from "./responsaveis";

export type TipoTrat = "HT" | "KD";
export type Sujeito = "paletes" | "suportes" | "caixas" | "fardos" | "material";

/** Um tratamento (uma linha da tabela): vem de um certificado mestre. */
export interface LinhaTratamento {
  certificado: string;
  ciclo: string;
  lote: string;
  inicio: string; // "24/09/2025 21h43m"
  fim: string;
  tipo: TipoTrat;
  temperatura: string; // "56"
  duracao: string; // "32 min" / "46h19m"
  /** Quantidade deste lote na remessa (nota fiscal da LG). */
  quantidade?: string;
}

export interface DadosDeclaracao {
  // Remessa
  exportador: string;
  enderecoExportador: string;
  importador: string;
  destinatario: string;
  fatura: string;
  nfe: string;
  booking: string;
  bl: string;
  container: string;
  navio: string;
  marcas: string;
  produto: string;
  volumes: string;
  pesoLiquido: string;
  pesoBruto: string;
  origem: string;
  destino: string;
  // Tratamento
  comunicado: string;
  localTratamento: string;
  sujeito: Sujeito;
  linhas: LinhaTratamento[];
  /** Cada ciclo com a quantidade dele na remessa (pedido com vários ciclos): coluna "Quantidade" na tabela. */
  qtdPorCiclo?: boolean;
  umidade: string; // KD: "18%"
  observacao: string;
  // Emissão
  localEmissao: string;
  data: string; // dd/mm/aaaa
  rt: string;
  creaRt: string;
  regMapa: string;
  /** Textos do tratamento editados à mão (vazio = automático). */
  textoPt: string;
  textoEn: string;
}

export const CAMPOS_REMESSA: { k: keyof DadosDeclaracao; pt: string; en: string; dica?: string }[] = [
  { k: "exportador", pt: "Exportador", en: "Shipper" },
  { k: "enderecoExportador", pt: "Endereço", en: "Address" },
  { k: "importador", pt: "Importador", en: "Importer" },
  { k: "destinatario", pt: "Destinatário", en: "Consignee" },
  { k: "fatura", pt: "Fatura", en: "Invoice" },
  { k: "nfe", pt: "NF-e", en: "Invoice no." },
  { k: "booking", pt: "Booking", en: "Booking" },
  { k: "bl", pt: "B/L", en: "Bill of lading" },
  { k: "container", pt: "Contêiner", en: "Container" },
  { k: "navio", pt: "Navio", en: "Vessel" },
  { k: "marcas", pt: "Marcas", en: "Marks" },
  { k: "produto", pt: "Natureza do produto", en: "Kind of product" },
  { k: "volumes", pt: "Quantidade", en: "Quantity", dica: "ex.: 40 paletes de madeira / wooden pallets" },
  { k: "pesoLiquido", pt: "Peso líquido", en: "Net weight" },
  { k: "pesoBruto", pt: "Peso bruto", en: "Gross weight" },
  { k: "origem", pt: "Origem", en: "Origin" },
  { k: "destino", pt: "Destino", en: "Destination" },
];

const SUJEITOS: Record<Sujeito, { pt: string; en: string; plural: boolean; fem: boolean; rotulo: string }> = {
  paletes: { pt: "os paletes de madeira", en: "the wooden pallets", plural: true, fem: false, rotulo: "Paletes de madeira" },
  suportes: { pt: "os suportes de madeira", en: "the wooden skids", plural: true, fem: false, rotulo: "Suportes de madeira" },
  caixas: { pt: "as caixas de madeira", en: "the wooden boxes", plural: true, fem: true, rotulo: "Caixas de madeira" },
  fardos: { pt: "os fardos de madeira", en: "the wooden bundles", plural: true, fem: false, rotulo: "Fardos de madeira serrada" },
  material: { pt: "o material", en: "the material", plural: false, fem: false, rotulo: "Material (genérico)" },
};
export const OPCOES_SUJEITO = (Object.keys(SUJEITOS) as Sujeito[]).map((k) => ({ k, rotulo: SUJEITOS[k].rotulo }));

// ---------- números e datas por extenso ----------

const UN_PT = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ_PT = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEM_PT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

export function extensoPt(n: number): string {
  if (n < 20) return UN_PT[n];
  if (n < 100) return DEZ_PT[Math.floor(n / 10)] + (n % 10 ? ` e ${UN_PT[n % 10]}` : "");
  if (n === 100) return "cem";
  if (n < 1000) return CEM_PT[Math.floor(n / 100)] + (n % 100 ? ` e ${extensoPt(n % 100)}` : "");
  const mil = Math.floor(n / 1000);
  const resto = n % 1000;
  const m = mil === 1 ? "mil" : `${extensoPt(mil)} mil`;
  if (!resto) return m;
  return `${m}${resto < 100 || resto % 100 === 0 ? " e " : " "}${extensoPt(resto)}`;
}

const UN_EN = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const DEZ_EN = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export function extensoEn(n: number): string {
  if (n < 20) return UN_EN[n];
  if (n < 100) return DEZ_EN[Math.floor(n / 10)] + (n % 10 ? `-${UN_EN[n % 10]}` : "");
  if (n < 1000) return `${UN_EN[Math.floor(n / 100)]} hundred` + (n % 100 ? ` and ${extensoEn(n % 100)}` : "");
  const resto = n % 1000;
  return `${extensoEn(Math.floor(n / 1000))} thousand` + (resto ? `${resto < 100 ? " and " : " "}${extensoEn(resto)}` : "");
}

const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const partesData = (d: string) => {
  const m = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? { dia: +m[1], mes: +m[2], ano: +m[3] } : null;
};

/** "15/10/2026" -> "15 de outubro de 2026" / "October 15, 2026". */
export function dataExtenso(d: string): { pt: string; en: string } {
  const p = partesData(d);
  if (!p || p.mes < 1 || p.mes > 12) return { pt: d, en: d };
  return { pt: `${p.dia} de ${MESES_PT[p.mes - 1]} de ${p.ano}`, en: `${MESES_EN[p.mes - 1]} ${p.dia}, ${p.ano}` };
}

/** Meses dos tratamentos: "Setembro de 2026" / "September 2026"; vários: "Julho e agosto de 2026". */
export function periodoTratamento(linhas: LinhaTratamento[]): { pt: string; en: string } {
  const vistos: { mes: number; ano: number }[] = [];
  for (const l of linhas) {
    const p = partesData(l.inicio);
    if (p && !vistos.some((v) => v.mes === p.mes && v.ano === p.ano)) vistos.push({ mes: p.mes, ano: p.ano });
  }
  if (!vistos.length) return { pt: "", en: "" };
  vistos.sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  const anos = [...new Set(vistos.map((v) => v.ano))];
  const lista = (xs: string[], e: string) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} ${e} ${xs[xs.length - 1]}` : xs[0]);
  const pt = anos.map((a) => `${lista(vistos.filter((v) => v.ano === a).map((v) => MESES_PT[v.mes - 1]), "e")} de ${a}`);
  const en = anos.map((a) => `${lista(vistos.filter((v) => v.ano === a).map((v) => MESES_EN[v.mes - 1]), "and")} ${a}`);
  const ptTxt = lista(pt, "e");
  return { pt: ptTxt.charAt(0).toUpperCase() + ptTxt.slice(1), en: lista(en, "and") };
}

/** "32 min", "00h40m", "46h19m" -> minutos. */
export function minutosDe(duracao: string): number | null {
  const hm = duracao.match(/(\d+)\s*h\s*(\d+)\s*m?/i);
  if (hm) return +hm[1] * 60 + +hm[2];
  const m = duracao.match(/(\d+)\s*min/i);
  return m ? +m[1] : null;
}

// ---------- a partir do certificado mestre ----------

export function linhaDoMestre(m: CertificadoMestre): LinhaTratamento {
  const tipo: TipoTrat = /\bKD\b|secagem/i.test(m.modalidade ?? "") && !/AQF/i.test(m.modalidade ?? "") ? "KD" : "HT";
  const temp = m.temperatura?.match(/(\d+(?:[.,]\d+)?)\s*°?\s*C/i)?.[1] ?? "";
  const dur = m.temperatura?.match(/Dura[çc][ãa]o:\s*([^/]+?)\s*$/i)?.[1] ?? m.temperatura?.match(/(\d+\s*min|\d+h\d+m)/i)?.[1] ?? "";
  const quando = (d: string | null, h: string | null) => [d, h].filter(Boolean).join(" ");
  return {
    certificado: m.numero ?? "",
    ciclo: m.ciclo ?? "",
    lote: m.lote ?? "",
    inicio: quando(m.dataInicio, m.horaInicio),
    fim: quando(m.dataFim, m.horaFim),
    tipo,
    temperatura: temp,
    duracao: dur.trim(),
  };
}

export function sujeitoDoMestre(m: CertificadoMestre): Sujeito {
  const t = `${m.volumes ?? ""} ${m.produto ?? ""} ${m.quantidade ?? ""}`;
  if (/palet|pallet/i.test(t)) return "paletes";
  if (/suporte|skid|sarrafo/i.test(t)) return "suportes";
  if (/caixa|kit|engradado|crate/i.test(t)) return "caixas";
  if (/fardo|tábua|tabua|madeira serrada|m³|m3/i.test(t)) return "fardos";
  return "material";
}

const vazio: DadosDeclaracao = {
  exportador: "", enderecoExportador: "", importador: "", destinatario: "", fatura: "", nfe: "", booking: "", bl: "", container: "", navio: "",
  marcas: "", produto: "", volumes: "", pesoLiquido: "", pesoBruto: "", origem: "Brasil / Brazil", destino: "",
  comunicado: "", localTratamento: "", sujeito: "paletes", linhas: [], umidade: "18%", observacao: "",
  localEmissao: "", data: "", rt: "", creaRt: "", regMapa: "", textoPt: "", textoEn: "",
};

/** Valores iniciais: cadastro da empresa + mestre(s). */
export function dadosIniciais(mestres: CertificadoMestre[], empresa: Madeireira | null, hoje: string): DadosDeclaracao {
  const m = mestres[0];
  return {
    ...vazio,
    exportador: empresa?.razaoSocial ?? m?.razao ?? "",
    produto: m?.produto ?? "",
    comunicado: [...new Set(mestres.map((x) => x.comunicado).filter(Boolean))].join("; "),
    localTratamento: m?.enderecoTrat ?? empresa?.endereco ?? "",
    sujeito: m ? sujeitoDoMestre(m) : "paletes",
    linhas: mestres.map(linhaDoMestre),
    localEmissao: localDoEndereco(empresa?.endereco) || m?.local || "",
    data: hoje,
    rt: rtCompleto(empresa?.rt) ?? "",
    regMapa: empresa?.regMapa ?? m?.regMapa ?? "",
  };
}

// ---------- textos ----------

export function tipoTexto(t: TipoTrat): { pt: string; en: string } {
  return t === "KD" ? { pt: "Secagem em estufa (KD)", en: "Kiln drying (KD)" } : { pt: "Tratamento térmico (HT)", en: "Heat treatment (HT)" };
}

export const INTRO = {
  pt: "O responsável técnico abaixo assinado declara que os produtos da remessa descrita a seguir foram submetidos a tratamento fitossanitário com fins quarentenários, conforme as indicações abaixo.",
  en: "The undersigned technical manager declares that the products of the consignment described below were subjected to phytosanitary treatment for quarantine purposes, according to the indications below.",
};

/** Parágrafo do tratamento (temperatura e duração mínimas das linhas), em português e inglês. */
export function textoTratamento(d: DadosDeclaracao): { pt: string; en: string } {
  const s = SUJEITOS[d.sujeito];
  const temps = d.linhas.map((l) => parseFloat(l.temperatura.replace(",", "."))).filter((n) => n > 0);
  const durs = d.linhas.map((l) => minutosDe(l.duracao)).filter((n): n is number => n != null && n > 0);
  const temp = temps.length ? Math.min(...temps) : 56;
  const min = durs.length ? Math.min(...durs) : 30;
  const kd = d.linhas.length > 0 && d.linhas.every((l) => l.tipo === "KD");
  const t = Math.round(temp);
  const verboPt = s.plural ? (s.fem ? "foram submetidas" : "foram submetidos") : "foi submetido";
  const verboEn = s.plural ? "were subjected" : "was subjected";
  const sujPt = s.pt.charAt(0).toUpperCase() + s.pt.slice(1);
  const sujEn = s.en.charAt(0).toUpperCase() + s.en.slice(1);
  const umid = d.umidade.trim() || "18%";
  const pt =
    d.textoPt.trim() ||
    `${sujPt} ${verboPt} ${kd ? "à secagem em estufa (KD)" : "ao tratamento térmico (HT)"}, que garante o alcance de uma temperatura mínima de ${t} °C (${extensoPt(t)} graus Celsius) durante ${min} (${extensoPt(min)}) minutos${kd ? `, com umidade final máxima de ${umid}` : ""}, conforme o Art. 24 da Portaria MAPA nº 385/2021 do Ministério da Agricultura e Pecuária do Brasil.`;
  const en =
    d.textoEn.trim() ||
    `${sujEn} ${verboEn} to ${kd ? "kiln drying (KD)" : "heat treatment (HT)"}, which guarantees reaching a minimum temperature of ${t} °C (${extensoEn(t)} degrees Celsius) for ${min} (${extensoEn(min)}) minutes${kd ? `, with a maximum final moisture content of ${umid}` : ""}, as set out in Art. 24 of MAPA Ordinance No. 385/2021 of the Ministry of Agriculture and Livestock of Brazil.`;
  return { pt, en };
}

export interface ItemTabela {
  pt: string;
  en: string;
  v: string;
}

/** Campos curtos lado a lado (duas colunas) para a declaração caber em uma página. */
const GRUPOS_REMESSA: (keyof DadosDeclaracao)[][] = [
  ["exportador"], ["enderecoExportador"], ["importador"], ["destinatario"], ["fatura", "nfe"], ["booking", "bl"], ["navio", "container"],
  ["marcas"], ["volumes"], ["produto"], ["pesoLiquido", "pesoBruto"], ["origem", "destino"],
];

/** Linhas preenchidas da remessa, na ordem do documento (1 ou 2 campos por linha). */
export function linhasRemessa(d: DadosDeclaracao): ItemTabela[][] {
  return GRUPOS_REMESSA.map((g) =>
    g
      .map((k) => {
        const c = CAMPOS_REMESSA.find((x) => x.k === k)!;
        return { pt: c.pt, en: c.en, v: String(d[k] ?? "").trim() };
      })
      .filter((x) => x.v)
  ).filter((g) => g.length);
}

/** Linhas da tabela "Dados do tratamento" (sem a tabela dos ciclos). */
export function linhasTratamento(d: DadosDeclaracao): ItemTabela[][] {
  const certs = [...new Set(d.linhas.map((l) => l.certificado).filter(Boolean))].join("; ");
  const tipos = [...new Set(d.linhas.map((l) => l.tipo))];
  const per = periodoTratamento(d.linhas);
  const tt = tipos.map((t) => tipoTexto(t));
  return [
    [
      { pt: "Certificado mestre", en: "Master certificate", v: certs },
      /^Programa[çc][ãa]o MAPA\s+/i.test(d.comunicado.trim())
        ? { pt: "Programação MAPA", en: "Schedule", v: d.comunicado.trim().replace(/Programa[çc][ãa]o MAPA\s+/gi, "") }
        : { pt: "Programação / comunicado", en: "Treatment notice", v: d.comunicado.trim() },
    ],
    [
      { pt: "Tratamento", en: "Treatment", v: tt.length ? `${tt.map((x) => x.pt).join(" e ")} / ${tt.map((x) => x.en).join(" and ")}` : "" },
      { pt: "Período", en: "Time of treatment", v: per.pt ? `${per.pt} / ${per.en}` : "" },
    ],
    [{ pt: "Local do tratamento", en: "Place of treatment", v: d.localTratamento.trim() }],
  ]
    .map((g) => g.filter((x) => x.v))
    .filter((g) => g.length);
}

/** Nome sugerido do arquivo, no padrão das pastas ("DECL. EXPORTADOR NFE 123.docx"). */
export function nomeArquivo(d: DadosDeclaracao): string {
  const curto = d.exportador.split(/\s+[–-]\s+|\s*CNPJ/i)[0].replace(/\b(ltda|s\.?\/?a\.?|eireli|me|epp|ind[úu]stria|com[ée]rcio|de|do|da|e)\b\.?/gi, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ");
  const nf = d.nfe || d.observacao.match(/(\d{3,})\s*$/)?.[1];
  const ref = nf ? `NFE ${nf}` : d.fatura ? d.fatura : d.booking || d.bl || d.linhas[0]?.certificado || "";
  return `DECL. ${curto.toUpperCase() || "DECLARACAO"}${ref ? ` ${ref}` : ""}`.replace(/[\\/:*?"<>|]/g, "-").trim() + ".docx";
}

/** Coluna "Lote" só quando difere do ciclo (na LG o lote é o próprio ciclo). */
export const mostrarLote = (linhas: LinhaTratamento[]) => linhas.some((l) => l.lote && l.lote !== l.ciclo);
