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
  if (c.includes("VOLUME") || c === "M3" || c.includes("CUBAGEM")) return "volume";
  if (c.startsWith("ESTUFA") || c.startsWith("CAMARA")) return "estufa";
  if (c.includes("SECAGEM") && !c.includes("DATA") && !c.includes("HORA")) return "secagem";
  if (c.startsWith("CICLO") && !c.includes("LOTE")) return "secagem";
  if (c.startsWith("DATA")) return "data";
  if (c.includes("ESPECIE") || c.includes("MADEIRA")) return "especie";
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

export async function lerPlanilhaControle(buffer: ArrayBuffer): Promise<LinhaControle[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const linhas: LinhaControle[] = [];
  for (const ws of wb.worksheets) {
    let cab = -1;
    const mapa = new Map<number, Col>();
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && cab < 0; r++) {
      const tent = new Map<number, Col>();
      ws.getRow(r).eachCell((cell, col) => {
        const k = colunaDe(texto(cell.value));
        if (k && ![...tent.values()].includes(k)) tent.set(col, k);
      });
      const ks = [...tent.values()];
      if (ks.includes("fardos") && (ks.includes("volume") || ks.includes("bitola"))) {
        cab = r;
        tent.forEach((v, k) => mapa.set(k, v));
      }
    }
    if (cab < 0) continue;
    for (let r = cab + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const d: Partial<Record<Col, string>> = {};
      mapa.forEach((k, col) => (d[k] = texto(row.getCell(col).value)));
      if (!d.fardos && !d.volume) continue;
      const bitolaMm = d.bitola?.match(/(\d+(?:[.,]\d+)?)/)?.[1];
      linhas.push({
        aba: ws.name,
        linha: r,
        estufa: d.estufa ? num(d.estufa) : null,
        secagem: d.secagem ? num(d.secagem.split("/")[0]) : null,
        data: d.data ? dataBR(d.data) : null,
        fardos: d.fardos ? num(d.fardos) : null,
        bitola: bitolaMm ? `${bitolaMm.replace(".", ",")} mm` : null,
        volume: d.volume ? num(d.volume) : null,
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
