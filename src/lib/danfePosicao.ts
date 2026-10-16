// Leitura do DANFE pela posição dos textos na página: o valor de cada campo é o que está logo abaixo
// do rótulo, na mesma caixa. Serve para os DANFEs cujo texto sai embaralhado (rótulos todos juntos
// e os valores depois), como o da Renascer. Só roda no servidor.
import "pdf-parse/worker";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

interface Item {
  s: string;
  x: number;
  y: number; // do topo da página
  w: number;
}

export interface DanfePosicional {
  numero: string | null;
  emitente: { razao: string | null; cnpj: string | null };
  destinatario: { razao: string | null; cnpj: string | null; endereco: string | null; bairro: string | null; cep: string | null; municipio: string | null; uf: string | null };
}

async function itensDaPagina(buf: Uint8Array): Promise<Item[]> {
  const doc = await getDocument({ data: buf, useSystemFonts: false, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const pg = await doc.getPage(1);
    const alt = pg.getViewport({ scale: 1 }).height;
    const tc = await pg.getTextContent();
    return tc.items
      .map((it) => it as { str: string; transform: number[]; width: number })
      .filter((it) => it.str?.trim())
      .map((it) => ({ s: it.str.replace(/\s+/g, " ").trim(), x: it.transform[4], y: alt - it.transform[5], w: it.width }));
  } finally {
    await doc.destroy();
  }
}

/** Valor da caixa do rótulo: os textos logo abaixo dele, até o próximo rótulo à direita. */
function abaixo(itens: Item[], rot: Item, rotulos: Item[]): string | null {
  const direita = rotulos.filter((r) => Math.abs(r.y - rot.y) < 3 && r.x > rot.x + 5).sort((a, b) => a.x - b.x)[0];
  const limite = direita ? direita.x - 2 : rot.x + 320;
  const cand = itens
    .filter((i) => i.y > rot.y + 2 && i.y < rot.y + 16 && i.x >= rot.x - 6 && i.x < limite && !rotulos.includes(i))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (!cand.length) return null;
  const linha = cand.filter((i) => Math.abs(i.y - cand[0].y) < 2.5);
  return linha.map((i) => i.s).join(" ").trim() || null;
}

const ROTULO = /^(NOME\s*\/\s*RAZ[ÃA]O SOCIAL|RAZ[ÃA]O SOCIAL|CNPJ\s*\/\s*CPF|CPF\s*\/\s*CNPJ|ENDERE[ÇC]O|BAIRRO\s*\/\s*DISTRITO|CEP|MUNIC[ÍI]PIO|UF|FONE\s*\/\s*FAX|INSCRI[ÇC][ÃA]O ESTADUAL|DATA (?:DA |DE )?EMISS[ÃA]O|DATA (?:DA )?ENTRADA\s*\/\s*SA[ÍI]DA|HORA (?:DA |DE )?SA[ÍI]DA)$/i;

export async function lerDanfePosicional(buf: Uint8Array, texto: string): Promise<DanfePosicional | null> {
  let itens: Item[];
  try {
    itens = await itensDaPagina(buf);
  } catch {
    return null;
  }
  const rotulos = itens.filter((i) => ROTULO.test(i.s));
  // Seção do destinatário: os rótulos abaixo de "DESTINATÁRIO/REMETENTE".
  const sec = itens.find((i) => /^DESTINAT[ÁA]RIO\s*\/\s*REMETENTE$/i.test(i.s));
  const fimSec = itens.find((i) => sec && i.y > sec.y + 10 && /FATURA|DUPLICATA|C[ÁA]LCULO DO IMPOSTO/i.test(i.s));
  const naSecao = (r: Item) => !!sec && r.y > sec.y - 1 && (!fimSec || r.y < fimSec.y);
  const campo = (re: RegExp) => {
    const r = rotulos.find((x) => naSecao(x) && re.test(x.s));
    return r ? abaixo(itens, r, rotulos) : null;
  };
  const plano = texto.replace(/\s+/g, " ");
  const numero = plano.match(/N[º°o]?\.?\s*:?\s*(\d{3}\.\d{3}\.\d{3})/)?.[1]?.replace(/\D/g, "") ?? plano.match(/\bN[º°o]?\.?\s+(\d{3,9})\b/)?.[1] ?? null;
  // Emitente: "RECEBEMOS DE <razão> OS PRODUTOS" (canhoto) e o 1º CNPJ fora da seção do destinatário.
  const emitRazao = plano.match(/RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i)?.[1]?.trim() ?? null;
  const cnpjs = itens.filter((i) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(i.s));
  const emitCnpj = cnpjs.find((c) => !sec || c.y < sec.y)?.s ?? null;
  return {
    numero: numero ? String(parseInt(numero, 10)) : null,
    emitente: { razao: emitRazao, cnpj: emitCnpj },
    destinatario: {
      razao: campo(/RAZ[ÃA]O SOCIAL/i),
      cnpj: campo(/CNPJ|CPF/i)?.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/)?.[0] ?? null,
      endereco: campo(/^ENDERE[ÇC]O$/i),
      bairro: campo(/BAIRRO/i),
      cep: campo(/^CEP$/i),
      municipio: campo(/MUNIC[ÍI]PIO/i),
      uf: campo(/^UF$/i)?.match(/\b[A-Z]{2}\b/)?.[0] ?? null,
    },
  };
}
