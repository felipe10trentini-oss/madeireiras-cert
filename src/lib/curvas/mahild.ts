import { m3DoTexto } from "../produtoTexto";
import { minutosEntre, numeroBR, pad2, somarMinutos, type DataHora } from "../util";
import { curvaVazia, type Curva } from "./tipos";

const MESES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** "Wed Sep 02 2026 10:08:25" -> { data: "02/09/2026", hora: "10:08" }; null se o OCR errou o dia/mês. */
function dataMahild(texto: string, rotulo: string): DataHora | null {
  const m = texto.match(new RegExp(`${rotulo}\\s*[:;]?\\s*[A-Za-z]{3}\\s+([A-Za-z]{3})\\s+(\\d{1,2})\\s+(\\d{4})\\s+(\\d{1,2}):(\\d{2})`, "i"));
  if (!m) return null;
  const mes = MESES[m[1].toUpperCase()];
  const dia = parseInt(m[2], 10);
  if (!mes || dia < 1 || dia > 31) return null;
  return { data: `${pad2(dia)}/${pad2(mes)}/${m[3]}`, hora: `${pad2(parseInt(m[4], 10))}:${m[5]}` };
}

/**
 * Programa Mahild (Salamoni) — "Relatorio de: Secagem de Madeira - KD", lido por OCR:
 *   LOTE(UR): C 8/66     TOTAL CICLO: 51:18 hh:mm
 *   ESTUFA : 2           QTD.(Mt3) : 100,00
 *   INICIO: Wed Sep 02 2026 10:08:25    PRODUCTO : Madeira de Pinus
 *   FIM : Fri Sep 04 2026 13:27:00      MC% FINAL : 9,2
 *   T SET : 60 DegC
 * No certificado: lote "8-66", ciclo "Estufa 08 - Ciclo 66" (a estufa é a do lote).
 * A bitola e os fardos não vêm na curva.
 */
export function parseMahild(texto: string): Curva {
  const c = curvaVazia("Mahild");
  c.nomeEmpresa = texto.split("\n").find((l) => l.trim())?.trim() ?? null;

  const mLote = texto.match(/LOTE\s*\(?\s*UR\s*\)?\s*[:;]?\s*[A-Z]?\s*(\d+)\s*[/:]\s*(\d+)/i);
  if (mLote) {
    const estufa = parseInt(mLote[1], 10);
    c.camara = String(estufa);
    c.lote = `${estufa}-${parseInt(mLote[2], 10)}`;
    c.ciclo = `Estufa ${pad2(estufa)} - Ciclo ${parseInt(mLote[2], 10)}`;
  }

  const mTotal = texto.match(/TOTAL\s*CICLO\s*[:;]?\s*(\d+):(\d{2})/i);
  c.cicloDuracaoMin = mTotal ? parseInt(mTotal[1], 10) * 60 + parseInt(mTotal[2], 10) : null;

  c.cicloInicio = dataMahild(texto, "INICIO");
  const fimLido = dataMahild(texto, "FIM");
  const fimCalculado = c.cicloInicio && c.cicloDuracaoMin != null ? somarMinutos(c.cicloInicio, c.cicloDuracaoMin) : null;
  // O FIM lido por OCR vale se bater (±10 min) com INICIO + TOTAL CICLO; senão usa o calculado.
  if (fimLido && (!fimCalculado || Math.abs(minutosEntre(fimCalculado, fimLido)) <= 10)) c.cicloFim = fimLido;
  else if (fimCalculado) {
    c.cicloFim = fimCalculado;
    c.fimEstimado = !fimLido;
  }
  if (c.cicloDuracaoMin == null && c.cicloInicio && c.cicloFim) c.cicloDuracaoMin = minutosEntre(c.cicloInicio, c.cicloFim);

  c.temperatura = numeroBR(texto.match(/T\s*SET\s*[:;]?\s*(\d{2,3})/i)?.[1]) ?? 60;

  const qtd = texto.match(/QTD\s*\.?\s*\(?\s*Mt?3?\s*\)?\s*[:;]?\s*([\d.,]+)/i)?.[1];
  const m3 = qtd ? m3DoTexto(`${qtd} m³`) : null;
  if (m3) {
    c.totalM3 = m3.valor;
    c.m3Bruto = m3.bruto;
  }
  const produto = texto.match(/PRODUCTO\s*[:;]?\s*([^\n|—]+)/i)?.[1].trim() ?? "";
  c.descricao = produto || null;
  c.textoProduto = produto;
  c.umidadeFinal = numeroBR(texto.match(/MC%\s*FINAL\s*[:;]?\s*([\d,.]+)/i)?.[1]);
  c.statusTipo = "KD";
  return c;
}
