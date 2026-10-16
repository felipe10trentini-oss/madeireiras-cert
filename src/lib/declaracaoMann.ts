// Declaração da Mann Unidade Volante: a Mann trata na casa do cliente, e a declaração sai da nota
// fiscal do cliente (ou do BL/booking da exportação), que traz o nº do ciclo ("CICLO MANN 0249"),
// e do certificado mestre desse ciclo (datas, temperatura, duração e local do tratamento).
// Modelo: as declarações da pasta "Declaração" da Mann Caminhões Matriz 765.
import type { CertificadoMestre } from "./certificadoMestre";
import { dadosIniciais, linhaDoMestre, type DadosDeclaracao } from "./declaracao";
import type { DeclaracaoMontada } from "./declaracaoLg";
import type { Madeireira } from "./madeireiras";
import { ciclosDoTexto, type NotaFiscal } from "./notaFiscal";

export const CNPJ_MANN_VOLANTE = "00093600000141";

export interface MestreLido {
  mestre: CertificadoMestre;
  texto: string;
}

export interface DocumentoExportacao {
  nome: string;
  texto: string;
}

/** O que dá para tirar de um BL ou booking (texto livre de cada armador; o operador confere). */
export interface DadosBL {
  bl: string | null;
  booking: string | null;
  navio: string | null;
  destino: string | null;
  container: string | null;
  destinatario: string | null;
  exportador: string | null;
  ciclos: string[];
}

const linhaApos = (t: string, re: RegExp) => {
  const m = t.match(re);
  if (!m) return null;
  const resto = t.slice(m.index! + m[0].length).replace(/^[\s:.#-]+/, "");
  const v = resto.split("\n")[0].trim();
  return v.length >= 2 && v.length <= 120 ? v : null;
};

export function lerBL(texto: string): DadosBL {
  const t = texto.replace(/[ \t]+/g, " ");
  const plano = t.replace(/\s+/g, " ");
  return {
    bl: plano.match(/\b(?:B\/L|BILL OF LADING)\s*(?:N[ºo°.]*|NO\.?|NUMBER|#)?\s*:?\s*([A-Z]{2,6}[A-Z0-9-]{5,20})/i)?.[1] ?? null,
    booking: plano.match(/\bBOOKING\s*(?:N[ºo°.]*|NO\.?|NUMBER|REF\.?|#)?\s*:?\s*([A-Z0-9-]{6,20})/i)?.[1] ?? null,
    navio: linhaApos(t, /\b(?:OCEAN\s+)?VESSEL(?:\s*(?:\/|&)\s*VOYAGE(?:\s*NO\.?)?)?|\bNAVIO\b/i),
    destino: linhaApos(t, /\bPORT\s+OF\s+DISCHARGE|\bPLACE\s+OF\s+DELIVERY|\bPORTO\s+DE\s+DESCARGA|\bDESTINO\b/i),
    container: [...new Set(plano.match(/\b[A-Z]{4}\s?-?\d{6}-?\d\b/g) ?? [])].slice(0, 6).join(" / ") || null,
    destinatario: linhaApos(t, /\bCONSIGNEE\b/i),
    exportador: linhaApos(t, /\bSHIPPER\b|\bEXPORTER\b/i),
    ciclos: ciclosDoTexto(plano),
  };
}

const MINUSCULAS = new Set(["e", "de", "da", "do", "das", "dos", "em", "para", "com"]);
/** "RENASCER PALLET E EMBALAGEM DE MADEIRA LTDA" -> "Renascer Pallet e Embalagem de Madeira Ltda" (como na declaração). */
export function titulo(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : /^s\.?\/?a\.?$/.test(p) ? "S.A." : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/** Razão social do tomador no certificado mestre (2.1), que é o exportador da declaração. */
function tomadorDoMestre(texto: string): string | null {
  return (
    texto
      .replace(/\s+/g, " ")
      .match(/2\.1\.\s*Raz[ãa]o Social:\s*(.+?)\s+2\.2/i)?.[1]
      ?.trim() ?? null
  );
}

const semZeros = (c: string | null | undefined) => (c ? String(parseInt(c, 10)) : "");

/** "100 paletes de madeira/ wooden pallets" a partir dos itens da nota. */
function volumesDaNota(nf: NotaFiscal): string {
  return nf.itens
    .map((i) => {
      const q = i.quantidade.toLocaleString("pt-BR");
      if (/palet|pallet/i.test(i.descricao)) return `${q} paletes de madeira/ wooden pallets`;
      if (/suporte|skid/i.test(i.descricao)) return `${q} suportes de madeira/ wooden skids`;
      if (/caixa|crate|engradado/i.test(i.descricao)) return `${q} caixas de madeira/ wooden crates`;
      return `${q} ${i.descricao}`;
    })
    .join("\n");
}

/**
 * Monta a declaração de uma remessa: nota fiscal (ou BL/booking) + certificado(s) mestre(s) dos
 * ciclos. Os mestres são casados pelo ciclo escrito na nota/BL.
 */
export function montarDeclaracaoMann(
  nf: NotaFiscal | null,
  bls: DadosBL[],
  mestres: MestreLido[],
  empresa: Madeireira | null,
  hoje: string
): DeclaracaoMontada {
  const avisos: string[] = [];
  const bl = bls[0] ?? null;
  const ciclosDoc = [...new Set([...(nf?.ciclos ?? []), ...bls.flatMap((b) => b.ciclos)])];
  // Mestres do ciclo da nota/BL; sem ciclo escrito, todos os mestres soltos junto.
  const usados = ciclosDoc.length
    ? mestres.filter((m) => ciclosDoc.includes(semZeros(m.mestre.ciclo)) || ciclosDoc.includes(semZeros(m.mestre.lote)))
    : mestres;
  if (!ciclosDoc.length) avisos.push(nf ? "A nota não traz o nº do ciclo (ex.: “CICLO MANN 0249”): confira se o certificado mestre é o desta remessa." : "O BL/booking não traz o nº do ciclo: confira o certificado mestre.");
  for (const c of ciclosDoc) {
    if (!usados.some((m) => semZeros(m.mestre.ciclo) === c || semZeros(m.mestre.lote) === c)) avisos.push(`Ciclo ${c}: solte também o certificado mestre dele.`);
  }
  if (!mestres.length) avisos.push("Sem certificado mestre: as linhas do tratamento ficam em branco.");

  const base = dadosIniciais([], empresa, hoje);
  const m0 = usados[0];
  const exportador = titulo(nf?.emitente?.razao) || titulo(bl?.exportador) || titulo(m0 ? tomadorDoMestre(m0.texto) : null);
  const destinatario = titulo(nf?.destinatario.razao) || bl?.destinatario || "";
  const linhas = usados.map((m) => linhaDoMestre(m.mestre));
  const certs = [...new Set(linhas.map((l) => l.certificado).filter(Boolean))];
  if (!exportador) avisos.push("Não achei o exportador (emitente da nota / shipper do BL): preencha.");
  const locais = [...new Set(usados.map((m) => m.mestre.enderecoTrat).filter(Boolean))] as string[];

  const dados: DadosDeclaracao = {
    ...base,
    exportador,
    enderecoExportador: "",
    destinatario,
    nfe: nf?.numero ?? "",
    navio: bl?.navio ?? "",
    bl: bl?.bl ?? "",
    booking: bl?.booking ?? "",
    container: bl?.container ?? "",
    destino: bl?.destino ?? "",
    volumes: nf ? volumesDaNota(nf) : "",
    produto: "",
    origem: "",
    comunicado: "",
    localTratamento: locais.join("; ").replace(/\s*-\s*[A-Z]{2}\s*$/, ""),
    sujeito: nf?.itens.every((i) => /palet|pallet/i.test(i.descricao)) ? "paletes" : nf?.itens.every((i) => /suporte|skid/i.test(i.descricao)) ? "suportes" : "material",
    linhas,
    localEmissao: "Curitiba - PR",
  };
  if (!dados.volumes.trim()) avisos.push("Não achei a quantidade de material na nota/BL: preencha em “Editar campos” (Cubagem/Volume).");
  if (!certs.length && mestres.length) avisos.push("Os certificados mestres soltos não são do ciclo da nota: confira.");
  // Nome no padrão da pasta: "Declaração HT - Renascer NFe 7376 - Novozymes" / "Declaração HT - Marine ONEYSAOG54885400".
  const curto = (s: string) => s.split(/\s+/)[0] ?? "";
  const ref = nf?.numero ? `NFe ${nf.numero}${destinatario ? ` - ${curto(destinatario)}` : ""}` : bl?.bl || bl?.booking || certs[0] || "";
  const arquivo = `Declaração HT - ${curto(exportador) || "Cliente"} ${ref}`.replace(/[\\/:*?"<>|]/g, "-").trim() + ".docx";
  return { dados, avisos, arquivo };
}
