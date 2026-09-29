import { m3DoTexto } from "../produtoTexto";
import { minutosEntre, numeroBR, pad2, somarMinutos } from "../util";
import { curvaVazia, primeiroCnpj, type Curva, type Sistema } from "./tipos";

function identificarSistema(texto: string): Sistema {
  if (/NTrat/i.test(texto)) return "CRG08 HT";
  if (/NSec|CRG08KDHT/i.test(texto)) return "CRG08 KDHT";
  if (/Dados gerais/i.test(texto) && /Secagem n[ºo°]/i.test(texto)) return "Digisystem Relatório";
  if (/TForn|Relat[óo]rio Tratamento/i.test(texto)) return "DMC2051 Gráfico";
  return "DMC2051";
}

/** "138 hora(s) 09 minuto(s)" ou "80:19" -> minutos. */
function tempo(texto: string, rotulo: string): number | null {
  const m =
    // "hora\S*": tolera "hora(s)" lido por OCR como "horaís)"
    texto.match(new RegExp(`${rotulo}[:;]\\s*(\\d+)\\s*hora\\S*\\s*(\\d+)\\s*minuto`, "i")) ??
    texto.match(new RegExp(`${rotulo}[:;]\\s*(\\d+):(\\d{2})`, "i"));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function comum(c: Curva, texto: string) {
  c.cnpj = primeiroCnpj(texto);
  c.regMapa =
    texto.match(/N[ºo°]\s*Credenciamento[:;]\s*(BR[\s\-–]*[A-Z]{2}[\s\-–]*\d{3,4}|[^\s\t]+)/i)?.[1] ?? null;
  const primeira = texto.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!/^(Dados|Relat|Per[íi]odo|NLT)/i.test(primeira)) c.nomeEmpresa = primeira;
}

/**
 * Relatório novo do Digisystem ("Relatório Tratamento / Dados gerais"):
 *   Secagem nº: 7 · Tipo de madeira: EUCALIPTO 50MM · Volume: 38,509 m³
 *   Equipamento: Estufa 1 · Início: 22/09/2026 11:07 · Duração: 0d 08h 04m
 *   Tratamento: madeira a 74 °C, Smad 2, 379 min registrados (programado: 360 min)
 */
function parseRelatorio(texto: string): Curva {
  const c = curvaVazia("Digisystem Relatório");
  comum(c, texto);
  const secagem = texto.match(/Secagem n[ºo°][:;]?\s*(\d+)/i)?.[1] ?? null;
  const estufa = texto.match(/Equipamento[:;]\s*Estufa\s*(\d+)/i)?.[1] ?? null;
  c.camara = estufa;
  if (secagem) {
    c.ciclo = estufa ? `Estufa ${estufa} Ciclo ${pad2(parseInt(secagem, 10))}` : secagem;
    c.lote = estufa ? `${estufa}-${pad2(parseInt(secagem, 10))}` : secagem;
  }
  const mIni = texto.match(/In[íi]cio[:;]\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/i);
  const mDur = texto.match(/Dura[çc][ãa]o[:;]\s*(\d+)d\s*(\d+)h\s*(\d+)m/i);
  if (mIni) c.cicloInicio = { data: mIni[1], hora: mIni[2] };
  if (mDur) c.cicloDuracaoMin = parseInt(mDur[1], 10) * 1440 + parseInt(mDur[2], 10) * 60 + parseInt(mDur[3], 10);
  if (c.cicloInicio && c.cicloDuracaoMin != null) c.cicloFim = somarMinutos(c.cicloInicio, c.cicloDuracaoMin);

  const mTrat = texto.match(/Tratamento[:;]\s*madeira a\s*([\d,.]+)\s*°?\s*C/i);
  c.temperatura = numeroBR(mTrat?.[1]);
  const prog = texto.match(/programado[:;]\s*(\d+)\s*min/i)?.[1];
  c.htDuracaoMin = prog ? parseInt(prog, 10) : null;
  c.duracaoFixa = c.htDuracaoMin ? `${c.htDuracaoMin} min` : null;

  const tipoMadeira = texto.match(/Tipo de madeira[:;]\s*([^\t\n]+)/i)?.[1] ?? "";
  const volume = texto.match(/Volume[:;]\s*([\d.,]+\s*m[³3])/i)?.[1] ?? "";
  c.descricao = texto.match(/Descri[çc][ãa]o[:;]\s*([^\t\n]+)/i)?.[1].trim() ?? null;
  c.textoProduto = [tipoMadeira, c.descricao ?? "", volume].join(" ");
  const m3 = m3DoTexto(volume);
  if (m3) {
    c.totalM3 = m3.valor;
    c.m3Bruto = m3.bruto;
  }
  c.statusTipo = "KD";
  return c;
}

/**
 * Controladores Digisystem: CRG08 HT, CRG08 KDHT e DMC2051 (relatório e gráfico).
 * Os quatro trazem os mesmos dados com rótulos ligeiramente diferentes, ex.:
 *   "Início do Tratamento na leitura 71 - 25/09/2026 09:04:00"
 *   "Tratamento iniciou na fase 1 com UM= 15,8 - leitura 94 - 22/09/2026 08:15"
 *   "O Tratamento iniciou na fase:7 , na leitura 137 - 13/09/2026 - 18:20"
 */
export function parseDigisystem(texto: string): Curva {
  if (identificarSistema(texto) === "Digisystem Relatório") return parseRelatorio(texto);
  const c = curvaVazia(identificarSistema(texto));
  comum(c, texto);

  c.ciclo = texto.match(/\((?:NTrat|NSec|N[ºo°]\s*Secagem)[:;]?\s*(\d+)\)/i)?.[1] ?? null;
  c.camara = texto.match(/Controlador\s*N[ºo°]\s*(\d+)/i)?.[1] ?? null;

  // Período do ciclo; o fim pode faltar quando a curva é impressa antes do fim da secagem.
  const mPer = texto.match(
    /Per[íi]odo do c\w{2,4}[:;]\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})(?::\d{2})?\s*(?:-|at[ée])\s*(?:(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}))?/i
  );
  const tempoTotal = tempo(texto, "Tempo total da secagem");
  const tempoReal = tempo(texto, "Tempo real da secagem");
  if (mPer) {
    c.cicloInicio = { data: mPer[1], hora: mPer[2] };
    if (mPer[3]) c.cicloFim = { data: mPer[3], hora: mPer[4] };
    else if (tempoTotal != null) {
      c.cicloFim = somarMinutos(c.cicloInicio, tempoTotal);
      c.fimEstimado = true;
    }
  }
  // A duração da secagem no certificado é o "Tempo real da secagem" da curva.
  c.cicloDuracaoMin =
    tempoReal ?? (c.cicloInicio && c.cicloFim ? minutosEntre(c.cicloInicio, c.cicloFim) : null);

  c.temperatura = numeroBR(
    texto.match(/Temperatura do Tratamento\s*\(Tt\)(?:\s*no SETUP)?[:;]\s*([\d,.]+)/i)?.[1]
  );
  const tt = texto.match(/Tempo (?:total )?do Tratamento\s*\(tt\)(?:\s*no SETUP)?[:;]\s*(\d+)/i)?.[1];
  c.htDuracaoMin = tt ? parseInt(tt, 10) : null;

  const mIni = texto.match(
    /(?:In[íi]cio do tratamento na leitura|Tratamento iniciou)[^\n]*?(\d{2}\/\d{2}\/\d{4})\s*-?\s*(\d{2}:\d{2})/i
  );
  if (mIni) {
    c.htInicio = { data: mIni[1], hora: mIni[2] };
    // Convenção da equipe: início e último minuto contam inteiros -> término = início + (tt - 1).
    if (c.htDuracaoMin) c.htFim = somarMinutos(c.htInicio, c.htDuracaoMin - 1);
  }

  c.umidadeFinal = numeroBR(texto.match(/UM Final\s*[:;=]\s*([\d,.]+)/i)?.[1]);
  c.descricao = texto.match(/Descri[çc][ãa]o:\s*([^\t\n]+)/i)?.[1].trim() ?? null;

  // Texto livre do produto: descrição, bitola, linhas de "Produto(s):" e volume total.
  const bitola = texto.match(/Bitola da madeira:\s*([^\t\n]+)/i)?.[1] ?? "";
  const linhasProduto = [...texto.matchAll(/^(.+?\scom\s[\d.,]+\s*(?:m[³3]|pe[çc]as|p[çc]s|unidades)[^\n]*)$/gim)].map(
    (m) => m[1]
  );
  const volumeTotal = texto.match(/Volume total:\s*([^\n]+)/i)?.[1] ?? "";
  c.textoProduto = [c.descricao ?? "", bitola, ...linhasProduto, volumeTotal].join(" ");
  const m3 = m3DoTexto([bitola, volumeTotal, ...linhasProduto, c.descricao ?? ""].join(" "));
  if (m3) {
    c.totalM3 = m3.valor;
    c.m3Bruto = m3.bruto;
  }

  const mQtd =
    texto.match(/Bitola da madeira:\s*([^\t\n]*?)\s+com\s+([\d.]+)\s+(Unidades|pe[çc]as)/i) ??
    texto.match(/Volume total:\s*()([\d.]+)\s*(pe[çc]as)/i);
  if (mQtd) {
    const qtd = parseInt(mQtd[2].replace(/\./g, ""), 10);
    if (qtd > 0) c.produtos = [{ descricao: mQtd[1] || "Peças", quantidade: qtd, m3: null }];
  }

  return c;
}
