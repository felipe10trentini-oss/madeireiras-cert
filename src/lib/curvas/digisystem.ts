import { minutosEntre, numeroBR, somarMinutos } from "../util";
import { curvaVazia, primeiroCnpj, type Curva, type Sistema } from "./tipos";

function identificarSistema(texto: string): Sistema {
  if (/NTrat/i.test(texto)) return "CRG08 HT";
  if (/NSec|CRG08KDHT/i.test(texto)) return "CRG08 KDHT";
  if (/TForn|Relat[óo]rio Tratamento/i.test(texto)) return "DMC2051 Gráfico";
  return "DMC2051";
}

/**
 * Controladores Digisystem: CRG08 HT, CRG08 KDHT e DMC2051 (relatório e gráfico).
 * Os quatro trazem os mesmos dados com rótulos ligeiramente diferentes, ex.:
 *   "Início do Tratamento na leitura 71 - 25/09/2026 09:04:00"
 *   "Tratamento iniciou na fase 1 com UM= 15,8 - leitura 94 - 22/09/2026 08:15"
 *   "O Tratamento iniciou na fase:7 , na leitura 137 - 13/09/2026 - 18:20"
 */
export function parseDigisystem(texto: string): Curva {
  const c = curvaVazia(identificarSistema(texto));

  c.cnpj = primeiroCnpj(texto);
  c.regMapa = texto.match(/N[ºo°]\s*Credenciamento:\s*([^\s\t]+)/i)?.[1] ?? null;
  const primeira = texto.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!/^(Dados|Relat|Per[íi]odo|NLT)/i.test(primeira)) c.nomeEmpresa = primeira;

  c.ciclo = texto.match(/\((?:NTrat|NSec|N[ºo°]\s*Secagem):?\s*(\d+)\)/i)?.[1] ?? null;
  c.camara = texto.match(/Controlador\s*N[ºo°]\s*(\d+)/i)?.[1] ?? null;

  const mPer = texto.match(
    /Per[íi]odo do ciclo:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})(?::\d{2})?\s*(?:-|at[ée])\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/i
  );
  if (mPer) {
    c.cicloInicio = { data: mPer[1], hora: mPer[2] };
    c.cicloFim = { data: mPer[3], hora: mPer[4] };
    c.cicloDuracaoMin = minutosEntre(c.cicloInicio, c.cicloFim);
  }

  c.temperatura = numeroBR(
    texto.match(/Temperatura do Tratamento\s*\(Tt\)(?:\s*no SETUP)?:\s*([\d,.]+)/i)?.[1]
  );
  const tt = texto.match(/Tempo (?:total )?do Tratamento\s*\(tt\)(?:\s*no SETUP)?:\s*(\d+)/i)?.[1];
  c.htDuracaoMin = tt ? parseInt(tt, 10) : null;

  const mIni = texto.match(
    /(?:In[íi]cio do tratamento na leitura|Tratamento iniciou)[^\n]*?(\d{2}\/\d{2}\/\d{4})\s*-?\s*(\d{2}:\d{2})/i
  );
  if (mIni) {
    c.htInicio = { data: mIni[1], hora: mIni[2] };
    // Convenção da equipe: início e último minuto contam inteiros -> término = início + (tt - 1).
    if (c.htDuracaoMin) c.htFim = somarMinutos(c.htInicio, c.htDuracaoMin - 1);
  }

  c.umidadeFinal = numeroBR(texto.match(/UM Final\s*[:=]\s*([\d,.]+)/i)?.[1]);
  c.descricao = texto.match(/Descri[çc][ãa]o:\s*([^\t\n]+)/i)?.[1].trim() ?? null;

  const mQtd =
    texto.match(/Bitola da madeira:\s*([^\t\n]*?)\s+com\s+(\d+)\s+(Unidades|pe[çc]as)/i) ??
    texto.match(/Volume total:\s*()(\d+)\s*(pe[çc]as)/i);
  if (mQtd) c.produtos = [{ descricao: mQtd[1] || "Peças", quantidade: parseInt(mQtd[2], 10), m3: null }];

  return c;
}
