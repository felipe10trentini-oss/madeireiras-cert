import { parseDigisystem } from "./digisystem";
import { parseSV520 } from "./sv520";
import { parseSV580 } from "./sv580";
import type { Curva } from "./tipos";

export type { Curva, ProdutoCurva, Sistema } from "./tipos";

/** Texto útil mínimo: abaixo disso o PDF é imagem (precisa de OCR ou digitação). */
export function curvaSemTexto(texto: string): boolean {
  return texto.replace(/--\s*\d+ of \d+\s*--/g, "").replace(/\s/g, "").length < 40;
}

/** Descobre o sistema pelo conteúdo e lê a curva. Retorna null se não reconhecer. */
export function lerCurva(texto: string): Curva | null {
  if (/SV580|Relat[óo]rio de Tratamento Fitossanit[áa]rio/i.test(texto) && /\(Treatment status\)|Status do Tratamento/i.test(texto)) {
    return parseSV580(texto);
  }
  if (/SV520|Hist[óo]rico da Secagem/i.test(texto)) return parseSV520(texto);
  if (/Controlador|Dados gerais|Secagem n[ºo°]/i.test(texto)) return parseDigisystem(texto);
  return null;
}
