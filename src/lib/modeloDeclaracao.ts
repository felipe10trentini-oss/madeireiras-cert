// Modelo de declaração de cada empresa, aprendido de uma declaração que ela já usa (PDF ou Word):
// campos fixos (destinatário, natureza do produto, local do tratamento…), linhas do RT, logo e
// assinatura. Fica na pasta privada "declaracoes/<cnpj>/" do Supabase (config.json + PNGs).
import JSZip from "jszip";
import type { DadosDeclaracao, Sujeito } from "./declaracao";

export interface PadraoDeclaracao {
  destinatario?: string;
  produto?: string;
  origem?: string;
  destino?: string;
  localTratamento?: string;
  localEmissao?: string;
  sujeito?: Sujeito;
  temperatura?: string;
  duracao?: string;
}

export interface ConfigModelo {
  rt: string[];
  padrao: PadraoDeclaracao;
}

export const CAMPOS_PADRAO: { k: keyof Omit<PadraoDeclaracao, "sujeito">; rotulo: string }[] = [
  { k: "destinatario", rotulo: "Destinatário / Consignee" },
  { k: "produto", rotulo: "Natureza do produto / Kind of product" },
  { k: "origem", rotulo: "Origem / Origin" },
  { k: "destino", rotulo: "Destino / Destination" },
  { k: "localTratamento", rotulo: "Local do tratamento" },
  { k: "localEmissao", rotulo: "Local de emissão" },
  { k: "temperatura", rotulo: "Temperatura mínima (°C)" },
  { k: "duracao", rotulo: "Duração (ex.: 32 min)" },
];

const nihil = (v: string) => (/^nihil$/i.test(v.trim()) ? "Nihil" : v.trim());

// Rótulos das declarações que as empresas já usam (o valor de um vai até o próximo).
const S = "\\s*\\/\\s*";
const ROTULOS: [string, RegExp][] = [
  ["exportador", new RegExp(`Exportador${S}Shipper\\s*:`, "i")],
  ["importador", new RegExp(`Importador${S}(?:Importer|Buyer)\\s*:`, "i")],
  ["destinatario", new RegExp(`Destinat[áa]rio(?:\\s+e\\s+Notificar)?${S}Consignee(?:\\s+and\\s+Notify)?\\s*:`, "i")],
  ["outro", /Master HT Certificate\s*:/i],
  ["outro", new RegExp(`Ciclo de Tratamento${S}Treatment Cycle\\s*:`, "i")],
  ["outro", new RegExp(`N[ºo°]?\\s*do lote${S}Lot number\\s*:`, "i")],
  ["outro", new RegExp(`Navio${S}Vessel\\s*:`, "i")],
  ["outro", /\b(?:Fatura(?:\s*\/\s*Invoice)?|Invoice(?:\s*#)?|NF-?e|Nf[’']s|Booking|B\/L|Container)\s*:/i],
  ["outro", new RegExp(`Marcas?${S}Marks?\\s*:`, "i")],
  ["outro", new RegExp(`(?:Cubagem${S}Volume|Quantidade${S}Quantity)\\s*:`, "i")],
  ["produto", new RegExp(`Natureza do produto${S}Kind of product\\s*:`, "i")],
  ["outro", new RegExp(`Descri[çc][ãa]o do produto${S}Product description\\s*:`, "i")],
  ["outro", new RegExp(`Peso (?:L[íi]quido|Bruto)${S}(?:Net|Gross) Weight\\s*:`, "i")],
  ["origem", new RegExp(`Proced[êe]ncia${S}Origin\\s*:`, "i")],
  ["destino", new RegExp(`Destino${S}Destination\\s*:`, "i")],
  ["outro", new RegExp(`(?:Transporte${S}Transport|Contratante${S}Contractor|Programa[çc][ãa]o MAPA|Comunicado de tratamento${S}Treatment notice)\\s*:`, "i")],
  ["outro", new RegExp(`(?:Data do tratamento${S}Time of treatment|Dura[çc][ãa]o do tratamento${S}Duration of treatment|Umidade[^:]{0,20}${S}[^:]{0,20}Moisture)\\s*:`, "i")],
  ["localTratamento", new RegExp(`Local d[eo] Tratamento${S}Place of Treatment\\s*:`, "i")],
  ["outro", new RegExp(`Observa[çc][ãa]o${S}Remark\\s*:`, "i")],
  ["localEmissao", new RegExp(`\\bLocal${S}Place\\s*:`, "i")],
  ["outro", /\b(?:Tratamento|Treatment)\s*:/i],
  ["outro", /REGISTRO\s*M\.?\s*A\.?\s*P\.?\s*A/i],
];

/**
 * Lê os campos fixos e as linhas do RT do texto de uma declaração. Só os campos que se repetem
 * em toda declaração da empresa (destinatário, natureza, origem/destino, locais); os da remessa
 * (exportador, navio, NF…) mudam a cada uma e ficam de fora.
 */
export function aprenderDoTexto(texto: string): ConfigModelo {
  const plano = texto.replace(/\s+/g, " ").trim();
  const achados: { campo: string; ini: number; fim: number }[] = [];
  for (const [campo, re] of ROTULOS) {
    for (const m of plano.matchAll(new RegExp(re.source, "gi"))) achados.push({ campo, ini: m.index!, fim: m.index! + m[0].length });
  }
  achados.sort((a, b) => a.ini - b.ini);
  // Rótulos sobrepostos ("Tratamento:" dentro de "Local de Tratamento/…:"): fica o mais longo.
  const rotulos = achados.filter((r, i) => !achados.some((o, j) => j !== i && o.ini <= r.ini && o.fim >= r.fim && o.fim - o.ini > r.fim - r.ini));
  const padrao: PadraoDeclaracao = {};
  rotulos.forEach((r, i) => {
    const v = plano.slice(r.fim, rotulos[i + 1]?.ini ?? plano.length).replace(/\s*(?:TRATAMENTO\s*\/\s*TREATMENT|DESCRI[ÇC][ÃA]O DA REMESSA).*$/i, "").trim();
    if (!v || v.length > 160 || /^-$/.test(v)) return;
    if (r.campo === "destinatario") padrao.destinatario ??= nihil(v);
    else if (r.campo === "produto") padrao.produto ??= v;
    else if (r.campo === "origem") padrao.origem ??= nihil(v);
    else if (r.campo === "destino") padrao.destino ??= nihil(v);
    else if (r.campo === "localTratamento") padrao.localTratamento ??= v;
    else if (r.campo === "localEmissao")
      padrao.localEmissao ??= v.replace(/\s+\d{1,2}\/\d{1,2}\/\d{2,4}.*$/, "").replace(/\s*[-–,]?\s*(?:brasil|brazil)\.?\s*$/i, "").trim();
  });
  // Destinatário de uma remessa (nome de cliente) não é fixo: só "Nihil" vira padrão.
  if (padrao.destinatario && padrao.destinatario !== "Nihil") delete padrao.destinatario;
  if (padrao.destino && padrao.destino !== "Nihil") delete padrao.destino;
  const temp = plano.match(/(\d{2,3})\s*[°ºo]\s*C\b/)?.[1];
  if (temp) padrao.temperatura = temp;
  const dur = plano.match(/(\d{2,3})\s*(?:\([^)]{3,40}\)\s*)?min(?:utos|utes)?\b/i)?.[1];
  if (dur) padrao.duracao = `${dur} min`;
  const trat = plano.match(/Tratamento:\s*(.{0,80})/i)?.[1] ?? plano;
  padrao.sujeito = /palet|pallet/i.test(trat)
    ? "paletes"
    : /suporte|skid/i.test(trat)
      ? "suportes"
      : /caixa|box/i.test(trat)
        ? "caixas"
        : /fardo|bundle/i.test(trat)
          ? "fardos"
          : "material";

  // RT: linhas do fim com CREA / Responsável Técnico / Eng., e o nome logo antes do CREA.
  const linhas = texto.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const rt: string[] = [];
  linhas.forEach((l, i) => {
    // Fora: datas, registro MAPA e o "CNPJ … Reg. CREA" / e-mail / telefone do timbre da empresa.
    if (l.length > 70 || /\d{2}\/\d{2}\/\d{4}|REGISTRO|M\.A\.P\.A|CNPJ|@|\(\d{2}\)|Reg\.\s*CREA/i.test(l)) return;
    const rtRe = /\bCREA\b|Respons[áa]vel T[ée]cnic|^Eng\b|^Eng\.|Engenheir/i;
    const ehRt = rtRe.test(l);
    const nome = /^[A-ZÀ-Ý][a-zà-ÿ]+(?: (?:d[aeo]s?|[A-ZÀ-Ý][a-zà-ÿ.]+)){1,5}$/.test(l) && rtRe.test(linhas[i + 1] ?? "");
    if ((ehRt || nome) && !rt.includes(l)) rt.push(l.replace(/^_+\s*/, ""));
  });
  return { rt: rt.slice(-4), padrao };
}

/** Aplica o padrão da empresa numa declaração nova. */
export function aplicarPadrao(d: DadosDeclaracao, p: PadraoDeclaracao | undefined): DadosDeclaracao {
  if (!p) return d;
  const linhas = d.linhas.map((l) => ({ ...l, temperatura: p.temperatura || l.temperatura, duracao: p.duracao || l.duracao }));
  return {
    ...d,
    destinatario: p.destinatario ?? d.destinatario,
    produto: p.produto ?? d.produto,
    origem: p.origem ?? d.origem,
    destino: p.destino ?? d.destino,
    localTratamento: p.localTratamento ?? d.localTratamento,
    localEmissao: p.localEmissao ?? d.localEmissao,
    sujeito: p.sujeito ?? d.sujeito,
    linhas,
  };
}

// ---------- Word (no navegador) ----------

const desescapar = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function textoDoXml(xml: string): string {
  // Caixas de texto vêm duas vezes (mc:Choice e mc:Fallback): fica só a primeira.
  const x = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, "");
  return [...x.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((p) => desescapar([...p[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("")))
    .join("\n");
}

/** Texto (cabeçalho + corpo) e imagens de um .docx. */
export async function lerModeloWord(bytes: ArrayBuffer): Promise<{ texto: string; imagens: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const nomes = Object.keys(zip.files);
  const xmls = nomes.filter((n) => /^word\/(header\d*|document|footer\d*)\.xml$/.test(n)).sort((a, b) => (a.includes("header") ? -1 : b.includes("header") ? 1 : 0));
  const texto = (await Promise.all(xmls.map(async (n) => textoDoXml(await zip.file(n)!.async("string"))))).join("\n");
  const imagens: string[] = [];
  for (const n of nomes.filter((x) => /^word\/media\/.+\.(png|jpe?g|gif)$/i.test(x))) {
    const ext = n.split(".").pop()!.toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
    imagens.push(`data:${mime};base64,${await zip.file(n)!.async("base64")}`);
  }
  return { texto, imagens };
}
