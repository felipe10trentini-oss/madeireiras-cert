// Leitura do DANFE (PDF da nota fiscal de venda): destinatário, itens e os lotes da observação
// ("421 UN LOTE/UR 716, 229 UN LOTE/UR 717"). Base da declaração de tratamento da LG.

export interface ItemNota {
  descricao: string;
  quantidade: number;
  unidade: string;
}

export interface LoteNota {
  lote: string;
  quantidade: number | null;
}

export interface NotaFiscal {
  numero: string | null;
  emissao: string | null;
  destinatario: {
    razao: string | null;
    cnpj: string | null;
    endereco: string | null;
    bairro: string | null;
    cep: string | null;
    municipio: string | null;
    uf: string | null;
  };
  itens: ItemNota[];
  lotes: LoteNota[];
  observacao: string | null;
  /** Quem emitiu a nota (o cliente da Mann Unidade Volante é o exportador). */
  emitente?: { razao: string | null; cnpj: string | null };
  /** Ciclos escritos na nota ("CICLO MANN 0249" na observação ou na descrição do item). */
  ciclos?: string[];
}

const num = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", "."));

/** Valor logo abaixo do rótulo do DANFE ("RAZÃO SOCIAL\nBRF S.A."). */
function abaixo(t: string, rotulo: RegExp): string | null {
  const m = t.match(new RegExp(`${rotulo.source}\\s*\\n([^\\n]+)`, "i"));
  const v = m?.[1].replace(/\s+-\s*\.?\s*$/, "").trim();
  return v || null;
}

/** Lotes da observação: "600 UN LOTE/UR 715", "421 UN LOTE/UR 716, 229 UN LOTE/UR 717", "LOTE/UR 715/716". */
export function lotesDaObservacao(obs: string): LoteNota[] {
  const out: LoteNota[] = [];
  const re = /(?:(\d[\d.]*)\s*UN\.?\s*)?LOTES?\s*\/?\s*(?:UR)?\s*:?\s*(\d+(?:\s*(?:\/|\be\b|;)\s*\d+)*)/gi;
  for (const m of obs.matchAll(re)) {
    const lotes = m[2].split(/\s*(?:\/|\be\b|;)\s*/i).filter(Boolean);
    const q = m[1] ? num(m[1]) : null;
    for (const l of lotes) out.push({ lote: String(parseInt(l, 10)), quantidade: lotes.length === 1 ? q : null });
  }
  return out;
}

/**
 * Nº da nota pela chave de acesso (44 dígitos: UF, AAMM, CNPJ, modelo 55, série, nº com 9 dígitos…),
 * quando o DANFE não traz "Nº 27905 Série" (Madeico: "000.027.905").
 */
function numeroDaChave(plano: string): string | null {
  for (const m of plano.matchAll(/\b(?:\d{4}\s?){10}\d{4}\b/g)) {
    const c = m[0].replace(/\s/g, "");
    if (c.length === 44 && c.slice(20, 22) === "55") return String(parseInt(c.slice(25, 34), 10));
  }
  return null;
}

export function lerNotaFiscal(texto: string): NotaFiscal | null {
  const t = texto.replace(/[ \t]+/g, " ");
  // Print de um pedaço do DANFE (só o quadro do destinatário) também é nota.
  if (!/DANFE|NF-e|DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i.test(t)) return null;
  // O 1º "RAZÃO SOCIAL" sozinho na linha é o do destinatário (o do transportador vem com "FRETE").
  const iDest = t.search(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i);
  const dest = iDest >= 0 ? t.slice(iDest) : t;
  // Print/foto (OCR): os rótulos saem tortos ("CNP) / CPF") e o nome pode nem ter rótulo; a linha do
  // destinatário é a 1ª com CNPJ depois de "DESTINATÁRIO": o nome antes do CNPJ.
  const linhaCnpj = iDest >= 0 ? dest.split("\n").slice(1).find((l) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(l)) : undefined;
  const mOcr = linhaCnpj?.match(/^(.*?)\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  const razaoOcr = mOcr?.[1].replace(/^[^A-ZÀ-Ú]+/, "").replace(/[\s|:;,.-]+$/, "").trim();
  const ocr = { razao: razaoOcr && /[A-ZÀ-Ú]{3,}.*\s.*[A-ZÀ-Ú]{2,}/.test(razaoOcr) ? razaoOcr : null, cnpj: mOcr?.[2] ?? null };
  const plano = t.replace(/\s+/g, " ");
  const obs =
    plano.match(/Inf\. Contribuinte:\s*([\s\S]*?)(?:\s*Trib aprox|\s*RESERVADO AO FISCO|$)/i)?.[1]?.trim() ||
    plano.match(/INFORMA[ÇC][ÕO]ES COMPLEMENTARES\s*([\s\S]*?)RESERVADO AO FISCO/i)?.[1]?.trim() ||
    // Madeico: os rótulos "INFORMAÇÕES COMPLEMENTARES RESERVADO AO FISCO" juntos e o texto depois do quadro do ISSQN.
    plano.match(/INFORMA[ÇC][ÕO]ES COMPLEMENTARES\s+RESERVADO AO FISCO\s+(?:.*C[ÁA]LCULO DO ISSQN\s*)?([\s\S]+)$/i)?.[1]?.replace(/\s*--\s*\d+ of \d+\s*--\s*$/, "").trim() ||
    null;

  // Itens: "141 PALLET MADEIRA 980X1170X135MM ME PLES02 44152000 000 6.101 UN 650,00 37,68 …"
  const iItens = plano.search(/DESCRI[ÇC][ÃA]O DO PRODUTO\s*\/\s*SERVI[ÇC]O/i);
  const blocoItens = iItens >= 0 ? plano.slice(iItens).replace(/^.*?IPI\s+ALIQ\.\s+ICMS\s+ALIQ\.\s+IPI\s*/i, "") : "";
  const itens: ItemNota[] = [];
  for (const m of blocoItens.matchAll(/(?:^|\s)\d{1,8}\s+(.+?)\s+(\d{8})\s+\d{3}\s+\d\.\d{3}\s+([A-Z]{1,4}\.?)\s+([\d.]+,\d{2,4})/g)) {
    itens.push({ descricao: m[1].replace(/\s*\|\s*/g, " ").trim(), quantidade: num(m[4]), unidade: m[3].replace(".", "") });
  }
  // Outro layout: código, NCM, CST, CFOP (sem ponto), unidade, quantidade… e a descrição no fim da linha
  // ("2940-014 44152000 051 5101 PC 100,0000 68,33 … 19.50 Pallet 1000 x 1200 HT Ped 4551417535").
  // Madeico: NCM, CST, CFOP, unidade, valor unitário, valor total… e, depois dos tabs, a descrição, o
  // código e a quantidade no fim ("44152000 051 5101 PC 63,1100 7.573,20 … 0 %\tPALETE … HT\t0864-01 120").
  // Vale só se quantidade x unitário = total.
  if (!itens.length) {
    for (const l of texto.split("\n")) {
      const m = l.match(/\b\d{8}\s+\d{3}\s+\d{4}\s+([A-Z]{1,4})\.?\s+([\d.]+,\d{2,4})\s+([\d.]+,\d{2})\s.*?\t\s*(.+?)\s*\t\s*\S+\s+(\d[\d.]*(?:,\d+)?)\s*$/);
      if (m && Math.abs(num(m[5]) * num(m[2]) - num(m[3])) < 0.05) itens.push({ descricao: m[4].trim(), quantidade: num(m[5]), unidade: m[1] });
    }
  }
  if (!itens.length) {
    for (const l of t.split("\n")) {
      const m = l.match(/\b(\d{8})\s+\d{3}\s+\d{4}\s+([A-Z]{1,4})\.?\s+([\d.]+,\d{2,4})\s+((?:[\d.,]+\s+)*)(.*)$/);
      if (m && m[5].trim()) itens.push({ descricao: m[5].trim(), quantidade: num(m[3]), unidade: m[2] });
    }
  }

  return {
    numero: plano.match(/N[º°o]\.?:?\s*(\d{1,9})\s+S[ée]rie/i)?.[1] ?? numeroDaChave(plano),
    emissao:
      // No print (OCR) a linha de baixo traz nome, CNPJ e data juntos: fica só a data.
      ((v) => (v && /\d{2}\/\d{2}\/\d{4}/.test(v) ? v.match(/\d{2}\/\d{2}\/\d{4}/)![0] : v))(abaixo(dest, /DATA DE EMISS[ÃA]O/)) ??
      plano.match(/Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ??
      // "DATA EMISSÃO\nDATA ENTRADA/SAIDA\n26/10/2026": a 1ª data depois do rótulo.
      dest.match(/DATA\s+(?:DE\s+)?EMISS[ÃA]O[\s\S]{0,120}?(\d{2}\/\d{2}\/\d{4})/i)?.[1] ??
      null,
    destinatario: {
      razao: ((r) => (r && !/CNP[J)]|CPF|DATA DE/i.test(r) ? r : (ocr.razao ?? r)))(abaixo(dest, /RAZ[ÃA]O SOCIAL(?! FRETE)/)),
      cnpj: abaixo(dest, /CNPJ\s*\/\s*CPF/) ?? ocr.cnpj,
      endereco: abaixo(dest, /ENDERE[ÇC]O/),
      bairro: abaixo(dest, /BAIRRO\s*\/\s*DISTRITO/),
      cep: abaixo(dest, /\bCEP/),
      municipio: abaixo(dest, /MUNIC[ÍI]PIO/),
      uf: abaixo(dest, /\bUF/)?.match(/^[A-Z]{2}$/)?.[0] ?? null,
    },
    itens,
    lotes: obs ? lotesDaObservacao(obs) : [],
    observacao: obs,
    emitente: { razao: plano.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i)?.[1]?.trim() ?? null, cnpj: null },
    // Ciclo na observação/itens; o código da curva (UR…) vale em qualquer lugar da nota (a Maxi escreve
    // "CICLO DE TRATAMENTO SKIDS UR010164SC180826" nos dados adicionais).
    ciclos: [...new Set([...ciclosDoTexto(`${obs ?? ""} ${itens.map((i) => i.descricao).join(" ")}`), ...(plano.match(/\bUR\d{6}[A-Z]{2}\d{6}\b/g) ?? [])])],
  };
}

export interface CartaCorrecao {
  numeroNf: string | null; // "6317" (sem os zeros da frente)
  chave: string | null; // chave de acesso da NF (44 dígitos)
  sequencia: string | null; // nº da correção
  correcao: string;
  lotes: LoteNota[];
}

/**
 * Carta de Correção Eletrônica (DACCe) da nota: o texto da correção ("650 UN LOTE/UR 720") troca os
 * lotes da nota. O texto vem entre o quadro de condições de uso e "DESCRIÇÃO DA CORREÇÃO".
 */
export function lerCartaCorrecao(texto: string): CartaCorrecao | null {
  if (!/Carta de Corre[çc][ãa]o|DACCe/i.test(texto)) return null;
  const t = texto.replace(/[ \t]+/g, " ");
  const numero = t.match(/N[º°o]\.?\s*0*(\d{1,9})\s*\n\s*S[ée]rie/i)?.[1] ?? t.match(/N[º°o]\.?\s*0*(\d{1,9})/i)?.[1] ?? null;
  const chave = t.replace(/\s+/g, " ").match(/((?:\d{4}\s?){11})/)?.[1].replace(/\s/g, "") ?? null;
  // Linhas que não são o modelo fixo do DACCe = a correção.
  const fixo =
    /^(N[º°o]|S[ée]rie|PROTOCOLO|CHAVE|CNPJ|DACCe|Documento Auxiliar|Carta de Corre|A Carta de Corre|de erro ocorrido|I+ ?-|presta[çc][ãa]o|III|CONDI[ÇC][ÕO]ES|DESCRI[ÇC][ÃA]O DA CORRE|N[ÚU]MERO CORRE|DATA E HORA|--|\d{4} \d{4} \d{4}|\d{14,}$|\d{12,} - \d{2}\/)/i;
  const linhas = t.split("\n").map((l) => l.trim()).filter((l) => l && !fixo.test(l));
  const correcao = linhas.join(" ").trim();
  return {
    numeroNf: numero ? String(parseInt(numero, 10)) : null,
    chave: chave && chave.length === 44 ? chave : null,
    sequencia: t.match(/N[ÚU]MERO CORRE[ÇC][ÃA]O:\s*(\d+)/i)?.[1] ?? null,
    correcao,
    lotes: lotesDaObservacao(correcao),
  };
}

/** Ciclos escritos no texto: "CICLO MANN 0249", "Ciclo 249", "CICLO: 870" (sem os zeros da frente). */
export function ciclosDoTexto(texto: string): string[] {
  const out: string[] = [];
  for (const m of texto.matchAll(/\bCICLOS?\s*(?:MANN)?\s*[:#nNº°.]*\s*(\d{1,5}(?:\s*(?:[,/e]|\be\b)\s*\d{1,5})*)/gi)) {
    for (const n of m[1].split(/\s*(?:[,/]|\be\b)\s*/)) {
      const c = String(parseInt(n, 10));
      if (n && c !== "NaN" && !out.includes(c)) out.push(c);
    }
  }
  // "MATERIAL TRATADO REFERENTE A UR: 553-573" (Madeico): os ciclos 553 e 573.
  for (const m of texto.matchAll(/\bUR\s*:\s*(\d{1,5}(?:\s*(?:[-,/]|\be\b)\s*\d{1,5})*)/gi)) {
    for (const n of m[1].split(/\s*(?:[-,/]|\be\b)\s*/)) {
      const c = String(parseInt(n, 10));
      if (n && c !== "NaN" && !out.includes(c)) out.push(c);
    }
  }
  // Código da curva (UR + estufa + lote + UF + data): "CICLO DE TRATAMENTO SKIDS UR010164SC180826" (Maxi).
  for (const m of texto.matchAll(/\bUR\d{6}[A-Z]{2}\d{6}\b/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

/** Junta a leitura por posição (DANFE em caixas) com a do texto: a da posição vale quando achou. */
export function juntarDanfe(
  nf: NotaFiscal,
  pos: { numero: string | null; emitente: { razao: string | null; cnpj: string | null }; destinatario: NotaFiscal["destinatario"] } | null
): NotaFiscal {
  if (!pos) return nf;
  const d = Object.fromEntries(
    Object.entries(nf.destinatario).map(([k, v]) => [k, (pos.destinatario as Record<string, string | null>)[k]?.replace(/\s+-\s*\.?\s*$/, "") || v])
  ) as NotaFiscal["destinatario"];
  return {
    ...nf,
    numero: nf.numero ?? pos.numero,
    destinatario: d,
    emitente: { razao: pos.emitente.razao ?? nf.emitente?.razao ?? null, cnpj: pos.emitente.cnpj ?? nf.emitente?.cnpj ?? null },
  };
}
