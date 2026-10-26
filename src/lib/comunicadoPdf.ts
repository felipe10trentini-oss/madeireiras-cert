// PDF do comunicado de tratamento, direto do site (sem abrir o Excel): A4 deitado, como a planilha da
// empresa impressa. Modelo comum: logo e dados da empresa no topo, título, registro no MAPA e os campos
// em linhas (rótulo em negrito à esquerda, valor à direita). Modelo em tabela (CJ): quadro da empresa,
// título com o número, tomador e local, e a tabela com uma linha.
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { CampoComunicado, ModeloComunicado } from "./comunicadoModelo";
import type { FontesPdf } from "./declaracaoLgPdf";

const A4 = { w: 841.89, h: 595.28 };
const TINTA = rgb(0, 0, 0);
const LINHA = rgb(0.15, 0.15, 0.15);

export interface EmpresaComunicado {
  razaoSocial: string;
  cnpj: string;
  crea?: string | null;
  endereco?: string | null;
  email?: string | null;
  telefone?: string | null;
  regMapa?: string | null;
}

/** Quebra o texto em linhas que cabem na largura. */
function quebrar(f: PDFFont, t: string, tam: number, larg: number): string[] {
  const out: string[] = [];
  for (const par of t.split("\n")) {
    let atual = "";
    for (const p of par.split(/\s+/).filter(Boolean)) {
      const tent = atual ? `${atual} ${p}` : p;
      if (f.widthOfTextAtSize(tent, tam) <= larg || !atual) atual = tent;
      else {
        out.push(atual);
        atual = p;
      }
    }
    out.push(atual);
  }
  return out;
}

/** Texto com y medido do topo da página. */
const escrever = (pg: PDFPage, t: string, x: number, y: number, f: PDFFont, tam: number) =>
  pg.drawText(t, { x, y: A4.h - y - tam, size: tam, font: f, color: TINTA });
const centro = (pg: PDFPage, t: string, cx: number, y: number, f: PDFFont, tam: number) => escrever(pg, t, cx - f.widthOfTextAtSize(t, tam) / 2, y, f, tam);
const linhaH = (pg: PDFPage, x1: number, x2: number, y: number, esp = 0.8) =>
  pg.drawLine({ start: { x: x1, y: A4.h - y }, end: { x: x2, y: A4.h - y }, thickness: esp, color: LINHA });
const retangulo = (pg: PDFPage, x: number, y: number, w: number, h: number, fundo?: ReturnType<typeof rgb>) =>
  pg.drawRectangle({ x, y: A4.h - y - h, width: w, height: h, borderColor: LINHA, borderWidth: 0.9, color: fundo });

async function imagem(doc: PDFDocument, b: Uint8Array | null): Promise<PDFImage | null> {
  if (!b) return null;
  try {
    return b[0] === 0x89 ? await doc.embedPng(b) : await doc.embedJpg(b);
  } catch {
    return null;
  }
}

/** Linhas do cabeçalho pelo cadastro (o texto do Excel às vezes tem sobra escondida atrás do logo). */
function cabecalhoDoCadastro(e: EmpresaComunicado): string[] {
  const end = (e.endereco ?? "").replace(/\s+/g, " ").trim();
  // "Rua X, 425 - CEP: 83.025-580 - São José dos Pinhais - PR" -> "Rua X, 425" / "CEP: … - São José dos Pinhais - PR"
  const i = end.search(/\s*[-–,]?\s*CEP/i);
  const linhasEnd = i > 0 ? [end.slice(0, i).replace(/[-–,]\s*$/, "").trim(), end.slice(i).replace(/^[\s,–-]+/, "")] : [end];
  return [e.razaoSocial, ...linhasEnd.filter(Boolean), [`CNPJ: ${e.cnpj}`, e.crea ? `Reg. CREA: ${e.crea}` : ""].filter(Boolean).join("     ")];
}

export async function gerarPdfComunicado(
  modelo: ModeloComunicado,
  valores: Partial<Record<CampoComunicado, string>>,
  empresa: EmpresaComunicado,
  logo: Uint8Array | null,
  fontes: FontesPdf
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const r = await doc.embedFont(fontes.r, { subset: true });
  const b = await doc.embedFont(fontes.b, { subset: true });
  doc.setTitle(`Comunicado de tratamento ${valores.numero ?? ""}`.trim());
  doc.setAuthor(empresa.razaoSocial);
  const pg = doc.addPage([A4.w, A4.h]);
  const img = await imagem(doc, logo);
  const v = (c: CampoComunicado) => (valores[c] ?? "").trim();

  if (modelo.tabela?.length) {
    // ---------- modelo em tabela (CJ Tedeski) ----------
    const X = 36;
    const W = A4.w - 72;
    const Y = 60;
    const H = 92;
    const wEmp = W * 0.37;
    retangulo(pg, X, Y, wEmp, H, rgb(0.973, 0.796, 0.678));
    retangulo(pg, X + wEmp, Y, W - wEmp, H);
    const linhasEmp = modelo.cabecalho.length ? modelo.cabecalho : cabecalhoDoCadastro(empresa);
    linhasEmp.slice(0, 6).forEach((l, i) => centro(pg, l, X + wEmp / 2, Y + 7 + i * 14, i === 0 ? b : r, i === 0 ? 9 : 8));
    const xd = X + wEmp + 6;
    const titulo = `${modelo.titulo ?? "COMUNICADO DE TRATAMENTO FITOSSANITÁRIO"} Nº`;
    escrever(pg, titulo, xd, Y + 6, b, 12);
    const wNum = 105;
    retangulo(pg, X + W - wNum, Y + 4, wNum, 16);
    centro(pg, v("numero"), X + W - wNum / 2, Y + 8, r, 8);
    const rotTom = "Tomador de serviço:";
    const rotLoc = "Local de Tratamento:";
    escrever(pg, rotTom, xd, Y + 42, b, 10);
    escrever(pg, rotLoc, xd, Y + 60, b, 10);
    const xv = xd + b.widthOfTextAtSize(rotLoc, 10) + 14;
    escrever(pg, quebrar(r, v("tomador"), 7.5, X + W - xv - 6)[0] ?? "", xv, Y + 44, r, 7.5);
    escrever(pg, quebrar(r, v("local"), 7.5, X + W - xv - 6)[0] ?? "", xv, Y + 62, r, 7.5);
    // Tabela: colunas proporcionais ao título (a mercadoria e a unidade são as mais largas).
    const cols = modelo.tabela;
    // Larguras como no PDF da CJ (as colunas sem par na lista usam o tamanho do título).
    const PESOS: [RegExp, number][] = [
      [/^n[º°o]$/i, 2], [/^local/i, 7], [/^interessado/i, 9.5], [/^mercadoria/i, 19], [/^unidade/i, 15], [/^identifica/i, 10],
      [/^quantidade/i, 7], [/^data/i, 7], [/^hora/i, 4], [/^tempo/i, 6.5], [/^temperatura/i, 11],
    ];
    const pesos = cols.map((c) => PESOS.find(([re]) => re.test(c.titulo))?.[1] ?? Math.max(4, Math.min(16, c.titulo.length * 0.6)));
    const soma = pesos.reduce((a, x) => a + x, 0);
    let x = X;
    const yT = 210;
    const hCab = 26;
    const hLin = 14;
    cols.forEach((c, i) => {
      const w = (W * pesos[i]) / soma;
      retangulo(pg, x, yT, w, hCab);
      retangulo(pg, x, yT + hCab, w, hLin);
      const ls = quebrar(b, c.titulo.toUpperCase(), 6.2, w - 4);
      ls.slice(0, 2).forEach((l, k) => centro(pg, l, x + w / 2, yT + (ls.length > 1 ? 6 : 10) + k * 8, b, 6.2));
      const val = c.campo ? v(c.campo) : c.fixo;
      let tam = 7;
      while (tam > 5 && r.widthOfTextAtSize(val, tam) > w - 4) tam -= 0.25;
      centro(pg, val, x + w / 2, yT + hCab + 4, r, tam);
      x += w;
    });
    // Linhas vazias abaixo (como na planilha).
    retangulo(pg, X, yT + hCab + hLin, W, 26);
    retangulo(pg, X, yT + hCab + hLin + 26, W, 14);
    return doc.save();
  }

  // ---------- modelo comum (formulário) ----------
  const ME = 22;
  const MD = A4.w - 22;
  let xTxt = ME;
  if (img) {
    let h = 82;
    let w = (img.width / img.height) * h;
    if (w > 250) {
      w = 250;
      h = (img.height / img.width) * w;
    }
    pg.drawImage(img, { x: ME + 6, y: A4.h - 14 - h - (82 - h) / 2, width: w, height: h });
    xTxt = ME + 6 + w + 12;
  }
  const cab = cabecalhoDoCadastro(empresa);
  const cx = (xTxt + MD) / 2;
  const y0 = Math.max(20, 54 - (cab.length * 14) / 2);
  cab.forEach((l, i) => centro(pg, l, cx, y0 + i * 14, i === 0 ? b : r, i === 0 ? 11 : 10));
  linhaH(pg, ME, MD, 104, 1);
  centro(pg, modelo.titulo ?? "COMUNICADO DE TRATAMENTO COM FINS QUARENTENÁRIOS", A4.w / 2, 112, b, 10.5);
  const registro = modelo.registro || (empresa.regMapa ? `REGISTRO MAPA: ${empresa.regMapa}` : "");
  if (registro) escrever(pg, registro.replace(/\s+/g, " "), ME, 132, b, 10);
  linhaH(pg, ME, MD, 146, 1);

  // Campos na ordem do modelo (pela linha da célula).
  const campos = Object.values(modelo.campos)
    .filter((c): c is NonNullable<typeof c> => !!c && !["interessado", "cidade"].includes(c.campo))
    .sort((x2, y2) => +x2.celula.replace(/[A-Z]+/, "") - +y2.celula.replace(/[A-Z]+/, "") || x2.celula.localeCompare(y2.celula));
  const xVal = 400;
  let y = 146;
  for (const c of campos) {
    if (c.campo === "aviso" && v("aviso") === v("numero")) continue; // Mann/Exata: o aviso é o próprio número
    const linhas = quebrar(r, v(c.campo) || " ", 10, MD - xVal - 4);
    const h = Math.max(24, linhas.length * 13 + 10);
    escrever(pg, c.rotulo.replace(/\s+/g, " "), ME, y + (h - 10) / 2 - 1, b, 10);
    linhas.forEach((l, i) => escrever(pg, l, xVal, y + (h - linhas.length * 13) / 2 + i * 13, r, 10));
    y += h;
    linhaH(pg, ME, MD, y, 0.8);
  }
  return doc.save();
}
