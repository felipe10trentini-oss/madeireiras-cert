// Aba "Clientes (2)" do Excel de comunicado da Madepallete: quando o tomador é a própria Madepallete, cada
// cliente do pedido (a tabela do Word: EMPRESA, PRODUTO, QUANTIDADE, MEDIDAS) entra numa linha — nº do
// comunicado (só na 1ª linha dele), cliente, CNPJ (a fórmula PROCV da coluna C acha pelos lançamentos
// anteriores do mesmo cliente), produto, quantidade e tamanho. Roda no navegador.
import JSZip from "jszip";
import type { ClienteDoPedido } from "./comunicadoTexto";

export interface LinhaCliente extends ClienteDoPedido {
  comunicado: string;
}

const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const compacto = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const colunaDe = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);

/** Caminho da aba "Clientes (2)" no zip (ou null se o Excel não tem essa aba). */
async function abaClientes(zip: JSZip): Promise<string | null> {
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const s = [...wb.matchAll(/<sheet\b[^>]*>/g)].find((m) => /name="Clientes \(2\)"/i.test(m[0]));
  const rid = s?.[0].match(/r:id="([^"]+)"/)?.[1];
  if (!rid) return null;
  const alvo = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`))?.[0]?.match(/Target="([^"]+)"/)?.[1];
  return alvo ? `xl/${alvo.replace(/^\/?xl\//, "")}` : null;
}

export const temAbaClientes = async (bytes: ArrayBuffer | Uint8Array) => !!(await abaClientes(await JSZip.loadAsync(bytes)));

/**
 * Acrescenta as linhas no fim da aba "Clientes (2)" e devolve o Excel novo (ou o mesmo, sem a aba).
 * O nome curto do pedido ("YAZAKI", "HORSE", "OMEGAPET") vira o nome completo já usado na aba ("YAZAKI DO
 * BRASIL LTDA", "HORSE BRASIL S.A.", "OMEGA PET LTDA"), para a fórmula achar o CNPJ. Cliente novo: o CNPJ do
 * pedido vai escrito (sem ele, a coluna fica em branco e `semCnpj` avisa).
 */
export async function registrarClientes(bytes: ArrayBuffer | Uint8Array, linhas: LinhaCliente[]): Promise<{ bytes: Uint8Array; semCnpj: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const caminho = await abaClientes(zip);
  if (!caminho || !linhas.length) return { bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), semCnpj: [] };
  let xml = (await zip.file(caminho)?.async("string")) ?? "";
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const textos = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));

  // Células com valor por linha (para achar o fim e os nomes já lançados).
  const valor = (corpo: string, attrs: string) => {
    const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    if (/t="s"/.test(attrs) && v != null) return textos[+v] ?? "";
    if (/t="inlineStr"/.test(attrs)) return desescapar([...corpo.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
    return v != null ? desescapar(v) : "";
  };
  const nomes = new Map<string, number>();
  let ultima = 1;
  for (const r of xml.matchAll(/<row\b[^>]*\sr="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    let tem = false;
    for (const c of (r[2] ?? "").matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = colunaDe(c[1]);
      if (col === 3 || /<f>/.test(c[3] ?? "")) continue; // a coluna C é fórmula em todas as linhas
      const v = valor(c[3] ?? "", c[2]).trim();
      if (!v) continue;
      tem = true;
      if (col === 2) nomes.set(v, (nomes.get(v) ?? 0) + 1);
    }
    if (tem) ultima = Math.max(ultima, +r[1]);
  }
  // Nome completo pelo curto: o lançado mais vezes que contém o curto (sem espaços e acentos).
  const nomeCompleto = (curto: string) => {
    const k = compacto(curto);
    if (k.length < 3) return curto;
    const cands = [...nomes.entries()].filter(([n]) => compacto(n).includes(k)).sort((a, b) => b[1] - a[1]);
    return cands[0]?.[0] ?? curto;
  };

  const celula = (ref: string, conteudo: string, s: string) => `<c r="${ref}"${s}${conteudo}</c>`;
  const texto = (t: string) => ` t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is>`;
  const semCnpj: string[] = [];
  let r = ultima;
  let anterior = "";
  for (const l of linhas) {
    r++;
    const nome = nomeCompleto(l.cliente);
    const conhecido = nomes.has(nome);
    if (!conhecido) nomes.set(nome, 1);
    // Estilo de cada coluna: o da linha de cima (mesma formatação dos lançamentos).
    const estiloAcima = (col: string) => xml.match(new RegExp(`<c r="${col}${ultima}"([^>]*?)(?:/>|>)`))?.[1]?.match(/\ss="\d+"/)?.[0] ?? "";
    const cels: [string, string][] = [];
    if (l.comunicado !== anterior) cels.push(["A", celula(`A${r}`, texto(l.comunicado), estiloAcima("A"))]);
    anterior = l.comunicado;
    cels.push(["B", celula(`B${r}`, texto(nome), estiloAcima("B"))]);
    // CNPJ: a fórmula de sempre (cliente já lançado) ou o CNPJ escrito (cliente novo).
    if (conhecido) cels.push(["C", celula(`C${r}`, `><f>VLOOKUP(B${r},B:C,2,0)</f>`, estiloAcima("C"))]);
    else if (l.cnpj.trim()) cels.push(["C", celula(`C${r}`, texto(l.cnpj.trim()), estiloAcima("C"))]);
    else {
      cels.push(["C", `<c r="C${r}"${estiloAcima("C")}/>`]);
      semCnpj.push(nome);
    }
    cels.push(["D", celula(`D${r}`, texto(l.produto), estiloAcima("D"))]);
    cels.push(["E", celula(`E${r}`, `><v>${l.quantidade}</v>`, estiloAcima("E"))]);
    if (l.tamanho) cels.push(["F", celula(`F${r}`, texto(l.tamanho), estiloAcima("F"))]);
    const novas = cels.map(([, c]) => c).join("");
    const reLinha = new RegExp(`<row\\b[^>]*\\sr="${r}"[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/row>)`);
    const ml = xml.match(reLinha);
    if (ml) {
      // A linha já existe (com a fórmula da coluna C pronta): troca A–F, mantém o resto (G em diante).
      const resto = [...(ml[1] ?? "").matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].filter((c) => colunaDe(c[1]) > 6).map((c) => c[0]).join("");
      const tag = ml[0].match(/^<row\b[^>]*?(?=\/?>)/)![0];
      xml = xml.replace(ml[0], `${tag}>${novas}${resto}</row>`);
    } else {
      const depois = [...xml.matchAll(/<row\b[^>]*\sr="(\d+)"/g)].find((x) => +x[1] > r);
      const row = `<row r="${r}">${novas}</row>`;
      xml = depois ? xml.replace(depois[0], row + depois[0]) : xml.replace(/<\/sheetData>/, `${row}</sheetData>`);
    }
  }
  zip.file(caminho, xml);
  // O Excel recalcula as fórmulas ao abrir (o CNPJ das linhas novas).
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const wbNovo = /<calcPr\b/.test(wb)
    ? wb.replace(/<calcPr\b([^>]*?)(\/?)>/, (t, a: string, f: string) => (/fullCalcOnLoad/.test(a) ? t : `<calcPr${a} fullCalcOnLoad="1"${f}>`))
    : wb.replace(/(<extLst\b|<\/workbook>)/, '<calcPr fullCalcOnLoad="1"/>$1');
  zip.file("xl/workbook.xml", wbNovo);
  return { bytes: await zip.generateAsync({ type: "uint8array" }), semCnpj };
}
