import { minutosEntre, numeroBR, type DataHora } from "../util";
import { curvaVazia, primeiroCnpj, type Curva, type ProdutoCurva } from "./tipos";

/** Linha que fecha um item da tabela de produtos: "54208 \t0,0013500 \t73,181". */
const FIM_ITEM = /(\d+)\s+(\d+,\d{4,})\s+(\d+,\d{3})\s*$/;

function lerProdutos(texto: string): ProdutoCurva[] {
  const ini = texto.search(/Subtotal\s*\n/);
  const fim = texto.search(/Total \(m/);
  if (ini < 0 || fim < 0 || fim < ini) return [];
  const linhas = texto
    .slice(ini, fim)
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);

  const produtos: ProdutoCurva[] = [];
  let acumulado: string[] = [];
  for (const linha of linhas) {
    const m = linha.match(FIM_ITEM);
    if (!m) {
      acumulado.push(linha);
      continue;
    }
    acumulado.push(linha.slice(0, m.index).trim());
    // Remove o nº do item ("1 \t") do começo.
    const descricao = acumulado.join(" ").replace(/^\d+\s+/, "").replace(/\s+/g, " ").trim();
    produtos.push({ descricao, quantidade: parseInt(m[1], 10), m3: numeroBR(m[3]) });
    acumulado = [];
  }
  return produtos;
}

interface Leitura {
  n: number;
  tratamento: boolean;
  dh: DataHora;
}

/** Leituras "25# \t18/09/2026 14:56" (duas colunas por linha no texto extraído). */
function lerLeituras(texto: string): Leitura[] {
  const leituras: Leitura[] = [];
  const re = /(?:^|\t|\s)(\d+)([#*]?)\s+(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2})/gm;
  for (const m of texto.matchAll(re)) {
    leituras.push({ n: parseInt(m[1], 10), tratamento: m[2] === "#", dh: { data: m[3], hora: m[4] } });
  }
  return leituras.sort((a, b) => a.n - b.n);
}

/**
 * Marrari SV580 — "Relatório de Tratamento Fitossanitário". Duas variações:
 *  HT: "Data Início: 16/09/2026 17:24" / "Data Fim: 21/09/2026 10:46 (113:22)"
 *  KD: "Data Início/Fim: 21/09/2026 08:35 a 24/09/2026 04:43 (68:08)" + "Umidade Início/Fim"
 * As leituras marcadas com "#" são o período em tratamento.
 */
export function parseSV580(texto: string): Curva {
  const c = curvaVazia("SV580");

  c.cnpj = primeiroCnpj(texto);
  const mCred = texto.match(/Credenciamento:\s*([^\t\n]+?)\s*(?:\t|\n|UF:)/);
  const mUf = texto.match(/UF:\s*([A-Z]{2})/);
  c.regMapa = mCred ? (/^[\d\s]+$/.test(mCred[1]) && mUf ? `BR-${mUf[1]}${mCred[1].trim()}` : mCred[1].trim()) : null;
  c.nomeEmpresa = texto.split("\n")[0]?.trim() || null;

  const mStatus = texto.match(/Status do Tratamento:\s*\w+\s*\((KD|HT)\)/i);
  c.statusTipo = mStatus ? (mStatus[1].toUpperCase() as "KD" | "HT") : null;
  const mUm = texto.match(/Umidade In[íi]cio\/Fim:\s*[\d,]+%\s*\/\s*([\d,]+)%/);
  c.umidadeFinal = mUm ? numeroBR(mUm[1]) : null;

  c.camara = texto.match(/C[âa]mara:\s*(\d+)/)?.[1] ?? null;
  c.ciclo = texto.match(/Ciclo:\s*(\S+)/)?.[1] ?? null;
  // "UR030851PR160926" -> câmara 03, ciclo 0851 -> lote "3-851"
  const mUr = c.ciclo?.match(/^UR(\d{2})(\d{4})/);
  if (mUr) c.lote = `${parseInt(mUr[1], 10)}-${parseInt(mUr[2], 10)}`;

  c.temperatura = numeroBR(texto.match(/Temperatura m[íi]nima:\s*([\d,.]+)/)?.[1]);
  const tempoMinimo = texto.match(/Tempo m[íi]nimo:\s*(\d+)/)?.[1];

  const mKd = texto.match(
    /Data In[íi]cio\/Fim:\s*(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2}) a (\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2})/
  );
  const mIni = texto.match(/Data In[íi]cio:\s*(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2})/);
  const mFim = texto.match(/Data Fim:\s*(\d{2}\/\d{2}\/\d{4}) (\d{2}:\d{2})/);
  if (mKd) {
    c.cicloInicio = { data: mKd[1], hora: mKd[2] };
    c.cicloFim = { data: mKd[3], hora: mKd[4] };
  } else if (mIni && mFim) {
    c.cicloInicio = { data: mIni[1], hora: mIni[2] };
    c.cicloFim = { data: mFim[1], hora: mFim[2] };
  }
  if (c.cicloInicio && c.cicloFim) c.cicloDuracaoMin = minutosEntre(c.cicloInicio, c.cicloFim);

  const emTratamento = lerLeituras(texto).filter((l) => l.tratamento);
  if (emTratamento.length) {
    c.htInicio = emTratamento[0].dh;
    c.htFim = emTratamento[emTratamento.length - 1].dh;
  }
  c.htDuracaoMin = tempoMinimo ? parseInt(tempoMinimo, 10) : c.htInicio && c.htFim ? minutosEntre(c.htInicio, c.htFim) : null;

  c.produtos = lerProdutos(texto);
  c.totalM3 = numeroBR(texto.match(/Total \(m³\)\s*([\d,]+)/)?.[1]);
  return c;
}
