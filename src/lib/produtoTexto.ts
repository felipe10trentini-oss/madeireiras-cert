// Leitura do texto livre que os operadores digitam nos sistemas das curvas
// (descrição do produto, bitola, nº de fardos, m³). Exemplos reais:
//   "MADEIRA DE PINUS SERRADA (1200.000X75.000X15.000)"   -> 15 mm
//   "madeira de pinus (0,18*0,92*2050*5 fardos)"           -> 18 mm, 5 fardos
//   "Madeiras de Pinus 0,19 x 118 x 2400 A"                -> 19 mm
//   "MADEIRA SERRADA DE PINUS 18X91X2,100"                 -> 18 mm
//   "22mmx128mmx2700mm", "15 mm x 89 mm x 1016 mm"         -> 22 mm / 15 mm
//   "20MM 48 GRADES", "40FAR MAD 15x70x1200mm 54m³"        -> 20 mm, 48 fardos / 15 mm, 40 fardos, 54 m³
import { semAcento } from "./util";

/** "2,100" (vírgula + 3 dígitos) é milhar; "0,19" / "17,5" são decimais. */
function numero(s: string): number {
  if (/^\d{1,3},\d{3}$/.test(s) && !s.startsWith("0")) return parseFloat(s.replace(",", ""));
  return parseFloat(s.replace(",", "."));
}

/** Medida em mm: "0,017" (metros) = 17 mm; "0,19" (como os operadores escrevem) = 19 mm. */
function emMm(n: number): number {
  if (n < 0.1) return Math.round(n * 10000) / 10;
  return n < 1 ? Math.round(n * 1000) / 10 : n;
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)\s*(?:mm)?`;
const SEP = String.raw`\s*[xX*×]\s*`;
const MM = String.raw`(\d+(?:[.,]\d+)?)\s*mm\s*`;
// "22mmx128mmx2700mm", "0,18*0,92*2050" ou sem separador: "21mm126mm2700mm"
const BITOLA = new RegExp(`${NUM}${SEP}${NUM}${SEP}${NUM}|${MM}${MM}${MM}`, "gi");

/** Espessuras (menor dimensão de cada bitola) encontradas no texto, em mm. */
export function espessuras(texto: string): number[] {
  // Centímetros (REIS): "36cmx100cmx2050cm" traz os números em mm com a unidade errada;
  // "3,6cm" (decimal pequeno) é cm de verdade -> 36 mm.
  texto = texto.replace(/(\d+(?:[.,]\d+)?)\s*cm(?![a-wyz])/gi, (_, n: string) => {
    const v = numero(n);
    return `${v < 10 && /[.,]/.test(n) ? Math.round(v * 100) / 10 : n}mm`;
  });
  const achadas: number[] = [];
  for (const m of texto.matchAll(BITOLA)) {
    const dims = (m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]]).map((x) => emMm(numero(x)));
    // Em geral a espessura vem primeiro ("17X145X2280", "0,18*0,145*2050"); quando o
    // comprimento vem primeiro ("1200.000X75.000X15.000") a espessura é a menor medida.
    achadas.push(dims[0] === Math.max(...dims) ? Math.min(...dims) : dims[0]);
  }
  if (!achadas.length) {
    // Sem bitola completa: "17 mm", "20MM", "16MM 22MM"
    for (const m of texto.matchAll(/(\d+(?:[.,]\d+)?)\s*mm\b/gi)) achadas.push(emMm(numero(m[1])));
  }
  return [...new Set(achadas.map((n) => Math.round(n * 10) / 10))].sort((a, b) => a - b);
}

/** "17,5" para 17.5; "15" para 15. */
export const mmBR = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));

/**
 * Soma das unidades de uma quantidade com vários itens: "530 Paletes + 140 tampas +2 caixas" = 672;
 * "60 Paletes (1000x1200mm) 40 Kit caixas (1000x1200x680mm)" = 100. Vale o número que abre cada
 * item — medidas (1000x1200), números entre parênteses e mm/cm/m não contam. "2.500 skids" = 2500.
 */
export function somaDeItens(texto: string): number | null {
  const t = (texto ?? "").replace(/\([^)]*\)/g, " ");
  const itens = [...t.matchAll(/(?<![\dx×.,/])(\d{1,3}(?:\.\d{3})+|\d+)(?![\dx×.,])\s*(?!mm\b|cm\b|m\b|m[³3])(?=[a-zà-ú])/gi)].map((m) =>
    parseInt(m[1].replace(/\./g, ""), 10)
  );
  return itens.length ? itens.reduce((s, n) => s + n, 0) : null;
}

/** Soma dos fardos/grades/pacotes citados no texto ("5 fardos", "48 GRADES", "40FAR"). */
export function fardos(texto: string): number | null {
  let total = 0;
  let achou = false;
  for (const m of texto.matchAll(/(\d+)\s*(?:fardos?|far\b|far(?=[^a-z])|grades?|pacotes?)/gi)) {
    total += parseInt(m[1], 10);
    achou = true;
  }
  return achou && total > 0 ? total : null;
}

/** Volume em m³ citado no texto ("com 85 M3", "54m³", "Volume total: 19,064m³"). */
export function m3DoTexto(texto: string): { valor: number; bruto: string } | null {
  const m = texto.match(/(\d+(?:[.,]\d+)?)\s*m[³3](?![a-z])/i);
  if (!m) return null;
  const bruto = m[1];
  // "46.1106" (ponto decimal) ou "19,064" (vírgula decimal)
  return { valor: parseFloat(bruto.replace(",", ".")), bruto };
}

export function especies(texto: string): string[] {
  const t = semAcento(texto).toUpperCase();
  const r: string[] = [];
  if (t.includes("PINUS")) r.push("pinus");
  if (t.includes("EUCALIP")) r.push("eucalipto");
  return r;
}

/** "Madeira serrada de pinus 16 mm; 17 mm" a partir do texto dos produtos. */
export function descricaoSerrada(texto: string): string {
  const esp = especies(texto);
  const mm = espessuras(texto);
  const base = `Madeira serrada de ${esp.length ? esp.join(" e ") : "pinus"}`;
  return mm.length ? `${base} ${mm.map((n) => `${mmBR(n)} mm`).join("; ")}` : base;
}

/** "Madeiras serrada para embalagens" -> "Madeira serrada para embalagens" (1ª maiúscula). */
export function frasePropria(s: string): string {
  const t = s.trim().replace(/\s+/g, " ").replace(/^madeiras\s+serrada/i, "Madeira serrada");
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
