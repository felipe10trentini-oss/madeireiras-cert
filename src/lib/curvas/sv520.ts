import { curvaVazia, type Curva } from "./tipos";

/** Temperatura que vai no certificado para curvas SV520 (a curva não traz o setpoint). */
export const TEMPERATURA_SV520 = 60;

/**
 * Marrari SV520 — "Histórico da Secagem". Só o cabeçalho tem dados:
 *   Estufa 04 - Ciclo 208
 *   Início: 15/09/2026 (ter) 14:57
 *   Fim: 23/09/2026 (qua) 14:28        (em versões mais antigas: "Último:")
 *   Duração: 191 horas e 30 minutos
 * Não traz empresa, produto nem cubagem: a empresa vem do nome do arquivo e o
 * produto é digitado (vem da planilha do cliente).
 */
export function parseSV520(texto: string): Curva {
  const c = curvaVazia("SV520");

  // "Estufa 04 - Ciclo 208" (versões antigas: "CLP 01 - Ciclo 171"); no certificado sai sempre "Estufa".
  const mEstufa = texto.match(/(?:Estufa|CLP)\s*(\d+)\s*-?\s*Ciclo\s*(\d+)/i);
  if (mEstufa) {
    c.camara = String(parseInt(mEstufa[1], 10));
    c.ciclo = `Estufa ${mEstufa[1]} - Ciclo ${mEstufa[2]}`;
    c.lote = `${parseInt(mEstufa[1], 10)}-${parseInt(mEstufa[2], 10)}`;
  }

  const dataHora = (rotulo: string) => {
    const m = texto.match(new RegExp(`${rotulo}:\\s*(\\d{2}/\\d{2}/\\d{4})\\s*(?:\\([^)]*\\))?\\s*(\\d{2}:\\d{2})`, "i"));
    return m ? { data: m[1], hora: m[2] } : null;
  };
  c.cicloInicio = dataHora("In[íi]cio");
  c.cicloFim = dataHora("Fim") ?? dataHora("[ÚU]ltimo");

  const mDur = texto.match(/Dura[çc][ãa]o:\s*(\d+)\s*horas?\s*e\s*(\d+)\s*minutos?/i);
  if (mDur) c.cicloDuracaoMin = parseInt(mDur[1], 10) * 60 + parseInt(mDur[2], 10);

  c.temperatura = TEMPERATURA_SV520;
  c.statusTipo = "KD";
  return c;
}
