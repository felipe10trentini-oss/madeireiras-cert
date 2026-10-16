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

export function lerNotaFiscal(texto: string): NotaFiscal | null {
  const t = texto.replace(/[ \t]+/g, " ");
  if (!/DANFE|NF-e/i.test(t)) return null;
  // O 1º "RAZÃO SOCIAL" sozinho na linha é o do destinatário (o do transportador vem com "FRETE").
  const iDest = t.search(/DESTINAT[ÁA]RIO\s*\/\s*REMETENTE/i);
  const dest = iDest >= 0 ? t.slice(iDest) : t;
  const plano = t.replace(/\s+/g, " ");
  const obs =
    plano.match(/Inf\. Contribuinte:\s*([\s\S]*?)(?:\s*Trib aprox|\s*RESERVADO AO FISCO|$)/i)?.[1]?.trim() ??
    plano.match(/INFORMA[ÇC][ÕO]ES COMPLEMENTARES\s*([\s\S]*?)RESERVADO AO FISCO/i)?.[1]?.trim() ??
    null;

  // Itens: "141 PALLET MADEIRA 980X1170X135MM ME PLES02 44152000 000 6.101 UN 650,00 37,68 …"
  const iItens = plano.search(/DESCRI[ÇC][ÃA]O DO PRODUTO\s*\/\s*SERVI[ÇC]O/i);
  const blocoItens = iItens >= 0 ? plano.slice(iItens).replace(/^.*?IPI\s+ALIQ\.\s+ICMS\s+ALIQ\.\s+IPI\s*/i, "") : "";
  const itens: ItemNota[] = [];
  for (const m of blocoItens.matchAll(/(?:^|\s)\d{1,8}\s+(.+?)\s+(\d{8})\s+\d{3}\s+\d\.\d{3}\s+([A-Z]{1,4}\.?)\s+([\d.]+,\d{2,4})/g)) {
    itens.push({ descricao: m[1].replace(/\s*\|\s*/g, " ").trim(), quantidade: num(m[4]), unidade: m[3].replace(".", "") });
  }

  return {
    numero: plano.match(/N[º°o]\.?:?\s*(\d{1,9})\s+S[ée]rie/i)?.[1] ?? null,
    emissao: abaixo(dest, /DATA DE EMISS[ÃA]O/) ?? plano.match(/Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null,
    destinatario: {
      razao: abaixo(dest, /RAZ[ÃA]O SOCIAL(?! FRETE)/),
      cnpj: abaixo(dest, /CNPJ\s*\/\s*CPF/),
      endereco: abaixo(dest, /ENDERE[ÇC]O/),
      bairro: abaixo(dest, /BAIRRO\s*\/\s*DISTRITO/),
      cep: abaixo(dest, /\bCEP/),
      municipio: abaixo(dest, /MUNIC[ÍI]PIO/),
      uf: abaixo(dest, /\bUF/)?.match(/^[A-Z]{2}$/)?.[0] ?? null,
    },
    itens,
    lotes: obs ? lotesDaObservacao(obs) : [],
    observacao: obs,
  };
}
