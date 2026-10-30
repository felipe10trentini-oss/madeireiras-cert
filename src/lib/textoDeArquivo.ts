// Texto do pedido do cliente quando ele manda arquivo: planilha do Excel (.xlsx) ou Word (.docx), lidos
// no navegador. Cada linha da planilha (ou da tabela do Word) vira uma linha de texto com as células
// separadas por " | ", que o interpretador do comunicado lê como se fosse a mensagem.
import JSZip from "jszip";

const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
const colunaDe = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);

function dataDeSerial(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** Planilha: todas as abas com dado, linha por linha. Datas e horas do Excel viram "27/10/2026" e "13:30". */
export async function textoDaPlanilha(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const textos = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  // Formatos de data/hora (estilos): para saber se o número é data.
  const estilos = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const fmtsData = new Set<number>([14, 15, 16, 17, 22]);
  const fmtsHora = new Set<number>([18, 19, 20, 21, 45, 46, 47]);
  for (const m of estilos.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]+)"/g)) {
    const f = desescapar(m[2]).toLowerCase();
    if (/[dy]/.test(f) && !/h/.test(f)) fmtsData.add(+m[1]);
    else if (/h/.test(f)) fmtsHora.add(+m[1]);
  }
  const xfs = [...(estilos.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? "").matchAll(/<xf [^>]*numFmtId="(\d+)"/g)].map((m) => +m[1]);
  // Abas com senhas (PETICIONAMENTO da CJ, acessos do SEI) nunca entram no texto.
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const proibidas = new Set(
    [...wb.matchAll(/<sheet\b[^>]*>/g)]
      .filter((m) => /peticionamento|acesso|senha/i.test(desescapar(m[0].match(/name="([^"]+)"/)?.[1] ?? "")))
      .map((m) => {
        const rid = m[0].match(/r:id="([^"]+)"/)?.[1] ?? "";
        const alvo = rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`))?.[0]?.match(/Target="([^"]+)"/)?.[1] ?? "";
        return `xl/${alvo.replace(/^\/?xl\//, "")}`;
      })
  );
  const abas = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n) && !proibidas.has(n))
    .sort();
  const linhas: string[] = [];
  for (const aba of abas) {
    const xml = (await zip.file(aba)?.async("string")) ?? "";
    for (const row of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      const cel: [number, string][] = [];
      for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const corpo = c[3] ?? "";
        const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const tipo = c[2].match(/t="(\w+)"/)?.[1];
        const s = +(c[2].match(/\ss="(\d+)"/)?.[1] ?? -1);
        let txt = "";
        if (tipo === "s" && v != null) txt = textos[+v] ?? "";
        else if (tipo === "inlineStr") txt = desescapar([...corpo.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join(""));
        else if (v != null) {
          txt = desescapar(v);
          const n = parseFloat(txt);
          const fmt = xfs[s];
          if (!isNaN(n) && fmt != null && fmtsData.has(fmt) && n > 20000) txt = dataDeSerial(n);
          else if (!isNaN(n) && fmt != null && fmtsHora.has(fmt) && n < 1) {
            const min = Math.round(n * 1440);
            txt = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
          }
        }
        if (txt.trim()) cel.push([colunaDe(c[1]), txt.trim()]);
      }
      if (cel.length) linhas.push(cel.sort((a, b) => a[0] - b[0]).map((x) => x[1]).join(" | "));
    }
  }
  return linhas.join("\n");
}

/** Word: parágrafos e tabelas (uma linha por linha da tabela, células com " | "). */
export async function textoDoWord(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const par = (p: string) => desescapar([...p.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br\/>/g, "<w:t>\n</w:t>").matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""));
  const corpo = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const out: string[] = [];
  // Blocos de primeiro nível: tabela ou parágrafo.
  for (const m of corpo.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith("<w:tbl>")) {
      for (const tr of m[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)) {
        const cels = [...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => [...tc[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => par(p[0])).join(" ").trim());
        if (cels.some(Boolean)) out.push(cels.join(" | "));
      }
    } else {
      const t = par(m[0]).trim();
      if (t) out.push(t);
    }
  }
  return out.join("\n");
}
