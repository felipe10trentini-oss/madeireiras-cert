// Planilha do Demonstrativo de Rastreabilidade (aba DADOS): uma linha por lote com o tratamento.
// Lida direto do XML do .xlsx porque as colunas vêm de fórmulas ligadas a outra planilha
// (relatório do MAPA) e o horário de início é texto ("17h48m") com formato de hora — o valor
// guardado no arquivo é o que vale. Roda no navegador.
import JSZip from "jszip";

export interface LinhaDR {
  lote: string;
  processo: string;
  ciclo: string;
  dataInicio: string; // dd/mm/aaaa
  horaInicio: string; // 17h48m
  dataFim: string;
  horaFim: string;
  tipo: string; // HT / KD
  umidade: string;
  temperatura: string; // "56"
  duracao: string; // "32"
  certificado: string; // nº do certificado mestre
  material: string;
}

export const desescapar = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");

export function dataDeSerial(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function horaDe(v: string): string {
  if (/^\d{1,2}h\d{2}m?$/i.test(v)) return v.replace(/m?$/i, "m").padStart(6, "0");
  const n = parseFloat(v);
  if (!isNaN(n) && n >= 0 && n < 1) {
    const min = Math.round(n * 1440);
    return `${String(Math.floor(min / 60)).padStart(2, "0")}h${String(min % 60).padStart(2, "0")}m`;
  }
  const m = v.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}h${m[2]}m` : v;
}

export function data(v: string): string {
  if (/^\d{5}(\.\d+)?$/.test(v)) return dataDeSerial(parseFloat(v));
  return v;
}

export const colunaDe = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);

/** Lê a aba DADOS (ou a primeira) e devolve os lotes indexados pelo nº do lote. */
export async function lerPlanilhaDR(bytes: ArrayBuffer | Uint8Array): Promise<Map<string, LinhaDR>> {
  const zip = await JSZip.loadAsync(bytes);
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const abas = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(\w+)"/g)].map((m) => ({ nome: desescapar(m[1]), id: m[2] }));
  const aba = abas.find((a) => /^dados$/i.test(a.nome.trim())) ?? abas[0];
  if (!aba) throw new Error("Planilha sem abas.");
  const alvo = rels.match(new RegExp(`Id="${aba.id}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${aba.id}"`))?.[1];
  const caminho = alvo ? `xl/${alvo.replace(/^\/?xl\//, "")}` : "xl/worksheets/sheet1.xml";
  const xml = await zip.file(caminho)?.async("string");
  if (!xml) throw new Error("Não achei a aba DADOS da DR.");
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const textos = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));

  const out = new Map<string, LinhaDR>();
  for (const linha of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (+linha[1] < 4) continue;
    const cel: Record<number, string> = {};
    for (const c of linha[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
      if (v == null) continue;
      cel[colunaDe(c[1])] = /t="s"/.test(c[2]) ? (textos[+v] ?? "") : desescapar(v);
    }
    const lote = (cel[1] ?? "").trim();
    if (!/^\d+$/.test(lote)) continue;
    out.set(String(parseInt(lote, 10)), {
      lote,
      processo: cel[2] ?? "",
      ciclo: cel[3] ?? lote,
      dataInicio: data(cel[4] ?? ""),
      horaInicio: horaDe(cel[5] ?? ""),
      dataFim: data(cel[6] ?? ""),
      horaFim: horaDe(cel[7] ?? ""),
      tipo: (cel[9] ?? "HT").trim() || "HT",
      umidade: cel[10] ?? "",
      temperatura: cel[11] ?? "",
      duracao: cel[12] ?? "",
      certificado: cel[13] ?? "",
      material: cel[14] ?? "",
    });
  }
  return out;
}
