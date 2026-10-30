// DR em Excel da empresa (RELATÓRIOS 2025\DEMONSTRATIVO DE RASTREABILIDADE\<EMPRESA> - DR.xlsx): a aba
// CONSOLIDADOS HT é o tratamento da remessa que está sendo montada (ciclo UR…, lote "2-302", início e
// final com data e hora, HT, temperatura, duração "00h82m") e a aba DADOS HT, o histórico de todos os
// lotes. A Pinustan tira as declarações daí (não do relatório do MAPA). Lido no navegador.
import JSZip from "jszip";
import type { LinhaTratamento } from "./declaracao";
import { colunaDe, data, desescapar, horaDe } from "./planilhaDR";

export interface DrHt {
  /** Linhas da aba CONSOLIDADOS HT (as da remessa). */
  consolidado: LinhaTratamento[];
  /** Todos os lotes da aba DADOS HT, pelo lote ("2-302") e pelo ciclo ("UR020302PR120922"). */
  historico: LinhaTratamento[];
}

type Celulas = Record<number, string>;

async function abas(bytes: ArrayBuffer | Uint8Array): Promise<{ nome: string; linhas: Celulas[] }[]> {
  const zip = await JSZip.loadAsync(bytes);
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const textos = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  const out: { nome: string; linhas: Celulas[] }[] = [];
  for (const m of wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(\w+)"/g)) {
    const nome = desescapar(m[1]);
    if (!/^(dados|consolidados)\s+ht$/i.test(nome.trim())) continue;
    const alvo = rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`))?.[1];
    const xml = alvo ? await zip.file(`xl/${alvo.replace(/^\/?xl\//, "")}`)?.async("string") : null;
    if (!xml) continue;
    const linhas: Celulas[] = [];
    for (const r of xml.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
      const cel: Celulas = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
        if (v != null) cel[colunaDe(c[1])] = (/t="s"/.test(c[2]) ? (textos[+v] ?? "") : desescapar(v)).trim();
      }
      linhas.push(cel);
    }
    out.push({ nome: nome.trim().toUpperCase(), linhas });
  }
  return out;
}

/** Linhas de tratamento da aba: as colunas pelo cabeçalho (a linha que tem "Lote" e "ciclo"). */
function linhasDaAba(linhas: Celulas[]): LinhaTratamento[] {
  const iCab = linhas.findIndex((l) => Object.values(l).some((t) => /^lote/i.test(t)) && Object.values(l).some((t) => /ciclo/i.test(t)));
  if (iCab < 0) return [];
  const cab = Object.entries(linhas[iCab]).map(([c, t]) => [+c, t.replace(/\s+/g, " ")] as const);
  const col = (re: RegExp, n = 0) => cab.filter(([, t]) => re.test(t))[n]?.[0] ?? null;
  const k = {
    lote: col(/^lote/i),
    ciclo: col(/ciclo/i),
    dataIni: col(/^data/i, 0),
    horaIni: col(/^hor[áa]rio/i, 0),
    dataFim: col(/^data/i, 1),
    horaFim: col(/^hor[áa]rio/i, 1),
    tipo: col(/^ht\s*(ou|\/)\s*kd/i),
    temperatura: col(/^temperatura/i),
    duracao: col(/^dura[çc][ãa]o/i),
    certificado: col(/certificado mestre/i),
  };
  const de = (l: Celulas, c: number | null) => (c == null ? "" : (l[c] ?? ""));
  const out: LinhaTratamento[] = [];
  for (const l of linhas.slice(iCab + 1)) {
    const lote = de(l, k.lote);
    const ciclo = de(l, k.ciclo);
    const di = data(de(l, k.dataIni));
    // Linha em branco da planilha (fórmula sem lote, data 00/01/1900): fica de fora.
    if (!/^\d/.test(lote) || !/^\d{2}\/\d{2}\/\d{4}$/.test(di) || di.endsWith("1899") || di.endsWith("1900")) continue;
    const df = data(de(l, k.dataFim));
    out.push({
      certificado: de(l, k.certificado),
      ciclo,
      lote,
      inicio: [di, horaDe(de(l, k.horaIni))].filter(Boolean).join(" "),
      fim: /^\d{2}\/\d{2}\/\d{4}$/.test(df) && !df.endsWith("1899") ? [df, horaDe(de(l, k.horaFim))].filter(Boolean).join(" ") : "",
      tipo: /KD/i.test(de(l, k.tipo)) ? "KD" : "HT",
      temperatura: de(l, k.temperatura).replace(/\s*°?\s*C$/i, "") || "56",
      duracao: de(l, k.duracao),
    });
  }
  return out;
}

/** A DR em Excel (abas DADOS HT e CONSOLIDADOS HT), ou null se a planilha não for a DR. */
export async function lerDrHt(bytes: ArrayBuffer | Uint8Array): Promise<DrHt | null> {
  const lidas = await abas(bytes);
  const cons = lidas.find((a) => a.nome === "CONSOLIDADOS HT");
  const dados = lidas.find((a) => a.nome === "DADOS HT");
  if (!cons && !dados) return null;
  return { consolidado: cons ? linhasDaAba(cons.linhas) : [], historico: dados ? linhasDaAba(dados.linhas) : [] };
}

/** Lote ("2-302", "1-655") ou ciclo (código UR…) digitado -> a linha da DR. */
export function linhaDaDr(dr: DrHt, c: string): LinhaTratamento | null {
  // "02-329" = "2-329" (zeros da frente não contam em nenhum dos lados).
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "").replace(/^0*(\d+)-0*(\d+)$/, "$1-$2");
  const alvo = norm(c);
  const igual = (l: LinhaTratamento) => norm(l.lote) === alvo || l.ciclo.toUpperCase() === alvo;
  return dr.consolidado.find(igual) ?? [...dr.historico].reverse().find(igual) ?? null;
}
