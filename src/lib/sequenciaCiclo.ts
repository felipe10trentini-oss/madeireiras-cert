// Sequência dos ciclos por estufa: avisa quando falta curva (1-25 -> 1-27 pulou o 26)
// ou quando o ciclo é anterior ao último já emitido (possível repetição).
import type { Curva } from "./curvas/tipos";

export interface ChaveCiclo {
  estufa: string;
  numero: number;
}

/** Estufa e nº do ciclo: "UR030851PR160926" -> 3/851; "Estufa 04 - Ciclo 208" -> 4/208; lote "1-25"; "477" + câmara. */
export function chaveDoCiclo(ciclo: string | null | undefined, camara: string | null | undefined, lote?: string | null): ChaveCiclo | null {
  const c = (ciclo ?? "").trim();
  const ur = c.match(/^UR(\d{2})(\d{4})/i);
  if (ur) return { estufa: String(parseInt(ur[1], 10)), numero: parseInt(ur[2], 10) };
  const ec = c.match(/Estufa\s*(\d+)\D+Ciclo\s*(\d+)/i);
  if (ec) return { estufa: String(parseInt(ec[1], 10)), numero: parseInt(ec[2], 10) };
  const pv = c.match(/^(\d{1,2});(\d+)$/); // "1;82"
  if (pv) return { estufa: String(parseInt(pv[1], 10)), numero: parseInt(pv[2], 10) };
  const l = (lote ?? "").match(/^(\d{1,2})-(\d+)$/);
  if (l) return { estufa: String(parseInt(l[1], 10)), numero: parseInt(l[2], 10) };
  const cam = (camara ?? "").match(/\d+/)?.[0];
  if (/^\d+$/.test(c) && cam) return { estufa: String(parseInt(cam, 10)), numero: parseInt(c, 10) };
  return null;
}

export const chaveDaCurva = (curva: Curva) => chaveDoCiclo(curva.ciclo, curva.camara, curva.lote);

/** Junta os últimos ciclos conhecidos (planilha de relatório e emissões pelo site): vale o maior. */
export function juntarUltimos(...fontes: (Record<string, number> | undefined | null)[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const f of fontes) for (const [k, v] of Object.entries(f ?? {})) if (typeof v === "number" && !(r[k] >= v)) r[k] = v;
  return r;
}

export interface AvisoSequencia {
  id: string;
  texto: string;
}

export function verificarSequencia(chave: ChaveCiclo | null, ultimos: Record<string, number>): AvisoSequencia | null {
  if (!chave) return null;
  const ultimo = ultimos[chave.estufa];
  if (ultimo == null) return null;
  const { estufa, numero } = chave;
  if (numero > ultimo + 1) {
    const faltam = numero - ultimo - 1;
    const lista = faltam <= 5 ? Array.from({ length: faltam }, (_, i) => `${estufa}-${ultimo + 1 + i}`).join(", ") : `${faltam} ciclos`;
    return {
      id: `falta-${estufa}-${ultimo}-${numero}`,
      texto: `Falta curva na estufa ${estufa}: o último ciclo emitido foi o ${estufa}-${ultimo} e este é o ${estufa}-${numero} (falta ${lista}).`,
    };
  }
  if (numero <= ultimo) {
    return {
      id: `repetido-${estufa}-${ultimo}-${numero}`,
      texto: `O ciclo ${estufa}-${numero} não é posterior ao último já emitido nesta estufa (${estufa}-${ultimo}): confira se não é repetido.`,
    };
  }
  return null;
}
