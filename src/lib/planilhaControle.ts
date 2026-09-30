// Planilha de controle da secagem enviada pelo cliente (empresas com curva SV520 /
// Mahild, que não trazem bitola, fardos nem m³). Ex. (NASA):
//   ESTUFA | DATA INÍCIO DA SECAGEM | HORARIO INÍCIO | FINALIDADE | FARDOS | Bitola (mm) | VOLUME M³ | Nº DA SECAGEM | CICLO/LOTE
//   3      | 14/09/2026             | 16:00         | uso interno | 34    | 23 mm       | 68         | 380          | 380/1162
// É lida no navegador; a linha do tratamento é achada pela estufa + nº da secagem da curva.
import ExcelJS from "exceljs";
import type { Curva } from "./curvas/tipos";
import { descricaoSerrada } from "./produtoTexto";
import { chaveNome, m3BR, pad2 } from "./util";

export interface LinhaControle {
  aba: string;
  linha: number;
  estufa: number | null;
  secagem: number | null;
  data: string | null; // dd/mm/aaaa
  fardos: number | null;
  bitola: string | null; // "23 mm"
  volume: number | null;
  especie: string | null;
}

type Col = "estufa" | "secagem" | "data" | "fardos" | "bitola" | "volume" | "especie";

function colunaDe(cabecalho: string): Col | null {
  const c = chaveNome(cabecalho);
  if (!c) return null;
  if (c.includes("FARDO") || c === "PACOTES" || c.includes("GRADES")) return "fardos";
  if (c.includes("BITOLA") || c.includes("ESPESSURA")) return "bitola";
  // "VOLUME M³", "M³" (chaveNome tira o "³" -> "M")
  if (c.includes("VOLUME") || c === "M" || c === "M3" || c.includes("CUBAGEM")) return "volume";
  if (c.startsWith("ESTUFA") || c.startsWith("CAMARA")) return "estufa";
  if (c.includes("SECAGEM") && !c.includes("DATA") && !c.includes("HORA")) return "secagem";
  if (c.startsWith("CICLO") && !c.includes("LOTE")) return "secagem";
  if (c.startsWith("DATA")) return "data";
  // "PRODUTO" traz a espécie e a bitola: "Pinus 19mm", "17mm"
  if (c.startsWith("PRODUTO") || c.includes("ESPECIE") || c.includes("MADEIRA")) return "especie";
  return null;
}

function texto(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return `${pad2(v.getUTCDate())}/${pad2(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return texto(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v).trim();
}

const num = (s: string) => {
  const n = parseFloat(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/** Rio Verde digita "100000" para 100,000 m³: nenhuma carga de estufa passa de 1.000 m³. */
const volumeM3 = (n: number | null) => (n != null && n > 1000 ? n / 1000 : n);

/** "14/09/026", "2026-09-14" -> "14/09/2026" */
function dataBR(s: string): string | null {
  let m = s.match(/(\d{1,2})\/;?(\d{1,2})\/;?(\d{2,4})/);
  if (m) {
    const ano = m[3].length === 4 ? m[3] : m[3].length === 3 ? `2${m[3]}` : `20${m[3]}`;
    return `${pad2(parseInt(m[1], 10))}/${pad2(parseInt(m[2], 10))}/${ano}`;
  }
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/**
 * Quadros por secagem (Selva Norte, "PRODUÇÃO DIÁRIA"), no fim de cada aba mensal:
 *   DIA:    | 01/09/2026
 *   ESTUFA: | 2
 *   CICLO:  | 314
 *   98X1,5X1,100=42,863=47 GRADES        (largura x espessura em cm x comprimento em m = m³ = grades)
 *   12,7X1,5X1,168=13,594=13 GRADES
 *   TOTAL M3: |   | 56,457
 */
function quadrosDeSecagem(ws: ExcelJS.Worksheet): LinhaControle[] {
  const quadros: LinhaControle[] = [];
  const valor = (r: number, c: number) => texto(ws.getRow(r).getCell(c).value);
  for (let r = 1; r <= ws.rowCount; r++) {
    ws.getRow(r).eachCell((cell, c) => {
      if (!/^DIA\s*:?$/i.test(texto(cell.value).trim())) return;
      if (!/^ESTUFA/i.test(valor(r + 1, c)) || !/^CICLO/i.test(valor(r + 2, c))) return;
      const estufa = num(valor(r + 1, c + 1));
      const secagem = num(valor(r + 2, c + 1));
      if (estufa == null || secagem == null) return;
      let fardos = 0;
      let somaM3 = 0;
      const mm: number[] = [];
      let total: number | null = null;
      for (let i = r + 3; i <= Math.min(r + 15, ws.rowCount); i++) {
        const t = valor(i, c);
        if (/^TOTAL\s*M/i.test(t)) {
          total = num(valor(i, c + 2)) ?? num(valor(i, c + 1));
          break;
        }
        const m = t.match(/([\d.,]+)\s*[xX]\s*([\d.,]+)\s*[xX]\s*[\d.,]+\s*=\s*([\d.,]+)\s*=\s*(\d+)\s*grades?/i);
        if (!m) continue;
        const a = num(m[1]) ?? 0;
        const b = num(m[2]) ?? 0;
        const menor = Math.min(a, b);
        // Espessura em cm ("1,5" = 15 mm); peças quadradas grandes já vêm em mm ("75x75").
        mm.push(Math.round((menor < 10 ? menor * 10 : menor) * 10) / 10);
        somaM3 += num(m[3]) ?? 0;
        fardos += parseInt(m[4], 10);
      }
      if (!mm.length) return;
      quadros.push({
        aba: ws.name,
        linha: r,
        estufa,
        secagem,
        data: dataBR(valor(r, c + 1)),
        fardos: fardos || null,
        bitola: [...new Set(mm)].map((n) => `${String(n).replace(".", ",")} mm`).join(" "),
        volume: total ?? (somaM3 ? Math.round(somaM3 * 1000) / 1000 : null),
        especie: null,
      });
    });
  }
  return quadros;
}

export async function lerPlanilhaControle(buffer: ArrayBuffer): Promise<LinhaControle[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const linhas: LinhaControle[] = [];
  for (const ws of wb.worksheets) {
    linhas.push(...quadrosDeSecagem(ws));
    let cab = -1;
    const mapa = new Map<number, Col>();
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && cab < 0; r++) {
      // Uma coluna pode aparecer mais de uma vez (IR: dois blocos com CICLO e M³ lado a lado):
      // fica a mais próxima da coluna de FARDOS.
      const candidatas = new Map<Col, number[]>();
      ws.getRow(r).eachCell((cell, col) => {
        const k = colunaDe(texto(cell.value));
        if (k) candidatas.set(k, [...(candidatas.get(k) ?? []), col]);
      });
      const colFardos = candidatas.get("fardos")?.[0];
      if (colFardos != null && (candidatas.has("volume") || candidatas.has("bitola") || candidatas.has("especie"))) {
        cab = r;
        candidatas.forEach((cols, k) => {
          const melhor = cols.reduce((a, b) => (Math.abs(b - colFardos) < Math.abs(a - colFardos) ? b : a));
          mapa.set(melhor, k);
        });
      }
    }
    if (cab < 0) continue;
    for (let r = cab + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const d: Partial<Record<Col, string>> = {};
      mapa.forEach((k, col) => (d[k] = texto(row.getCell(col).value)));
      if (!d.fardos && !d.volume) continue;
      // Bitola: coluna própria ("23 mm", "22") ou dentro do PRODUTO ("Pinus 19mm", "17mm").
      const bitolaMm =
        d.bitola?.match(/(\d+(?:[.,]\d+)?)/)?.[1] ?? d.especie?.match(/(\d+(?:[.,]\d+)?)\s*mm/i)?.[1];
      // Ciclo: "380", "380/1162" (secagem/lote), "4-354" ou "1_773" (estufa-ciclo).
      const mEC = d.secagem?.match(/^\s*(\d+)\s*[-_]\s*(\d+)\s*$/);
      linhas.push({
        aba: ws.name,
        linha: r,
        estufa: mEC ? parseInt(mEC[1], 10) : d.estufa ? num(d.estufa) : null,
        secagem: mEC ? parseInt(mEC[2], 10) : d.secagem ? num(d.secagem.split("/")[0]) : null,
        data: d.data ? dataBR(d.data) : null,
        fardos: d.fardos ? num(d.fardos) : null,
        bitola: bitolaMm ? `${bitolaMm.replace(".", ",")} mm` : null,
        volume: d.volume ? volumeM3(num(d.volume)) : null,
        especie: d.especie || null,
      });
    }
  }
  return linhas;
}

/** Estufa e nº do ciclo da curva: "Estufa 03 - Ciclo 380" / lote "8-66". */
function estufaCiclo(curva: Curva): { estufa: number | null; ciclo: number | null } {
  const m = curva.ciclo?.match(/Estufa\s*(\d+)\s*-?\s*Ciclo\s*(\d+)/i) ?? curva.lote?.match(/^(\d+)-(\d+)$/);
  return m ? { estufa: parseInt(m[1], 10), ciclo: parseInt(m[2], 10) } : { estufa: null, ciclo: null };
}

/** Acha a linha do tratamento: estufa + nº da secagem; senão estufa + data de início. */
export function acharLinhaControle(linhas: LinhaControle[], curva: Curva): LinhaControle | null {
  const { estufa, ciclo } = estufaCiclo(curva);
  const data = curva.cicloInicio?.data ?? null;
  const porCiclo = linhas.filter((l) => ciclo != null && l.secagem === ciclo);
  const exata = porCiclo.find((l) => estufa == null || l.estufa == null || l.estufa === estufa);
  if (exata) return exata;
  const porData = linhas.filter((l) => data && l.data === data);
  return porData.find((l) => estufa != null && l.estufa === estufa) ?? (porData.length === 1 ? porData[0] : null);
}

/** Produto, volumes e quantidade do certificado a partir da linha da planilha. */
export function produtoDaLinha(l: LinhaControle): { produto: string; volumes: string; quantidade: string } {
  const especieTexto = l.especie && /eucalip/i.test(l.especie) ? "eucalipto" : "pinus";
  return {
    produto: descricaoSerrada(`${especieTexto} ${l.bitola ?? ""}`),
    volumes: l.fardos != null ? `${l.fardos} Fardos` : "",
    quantidade: l.volume != null ? `${m3BR(l.volume)} m³` : "",
  };
}
