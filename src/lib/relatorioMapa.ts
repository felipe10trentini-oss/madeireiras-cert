// Relatório mensal do MAPA da empresa (RELATÓRIOS 2025\<EMPRESA> - 2026.xlsx, aba TÉRMICO): uma linha
// por tratamento, com ciclo, nº do certificado, data, temperatura e duração. As declarações do modelo
// padrão (todas menos a LG) só precisam do mês do tratamento, então o relatório basta no lugar dos
// certificados mestres. Lido direto do XML do .xlsx, no navegador.
import JSZip from "jszip";
import { minutosDe, type LinhaTratamento } from "./declaracao";
import { colunaDe, data, desescapar, horaDe } from "./planilhaDR";

export interface LinhaRelatorio {
  ciclo: string; // "249", "UR010993PR191026"
  lote: string; // do código da curva (UR010993PR191026 -> "993"); senão vazio
  certificado: string; // "425/2026"
  data: string; // dd/mm/aaaa
  hora: string; // 13h20m
  modalidade: string; // AQF, HT, KD…
  temperatura: string; // "56"
  minutos: number | null;
  local: string; // cidade
  volumes: string; // "200"
  unidadeVolumes: string; // "Unidades", "PALETES"
  produto: string;
  tomador: string;
  tomadorCnpj: string;
}

const dig = (s: string) => s.replace(/\D/g, "");

/** Lote dentro do código da curva: "UR010993PR191026" -> "993" (UR + nº da estufa + lote + UF + data). */
export function loteDoCodigo(ciclo: string): string {
  return ciclo.match(/^UR\d{2}0*(\d+)[A-Z]{2}\d{6}$/i)?.[1] ?? "";
}

/** Lê a aba TÉRMICO (colunas do modelo do MAPA: F tomador, G CNPJ, O data, U ciclo, V temperatura, W duração, X certificado). */
export async function lerRelatorioTermico(bytes: ArrayBuffer | Uint8Array): Promise<LinhaRelatorio[]> {
  const zip = await JSZip.loadAsync(bytes);
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const abas = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(\w+)"/g)].map((m) => ({ nome: desescapar(m[1]), id: m[2] }));
  const aba = abas.find((a) => /t[ée]rmico/i.test(a.nome));
  if (!aba) throw new Error("Não achei a aba TÉRMICO: é o relatório mensal do MAPA da empresa?");
  const alvo = rels.match(new RegExp(`Id="${aba.id}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${aba.id}"`))?.[1];
  const xml = alvo ? await zip.file(`xl/${alvo.replace(/^\/?xl\//, "")}`)?.async("string") : null;
  if (!xml) throw new Error("Não consegui abrir a aba TÉRMICO.");
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const textos = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));

  const out: LinhaRelatorio[] = [];
  for (const linha of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    if (+linha[1] < 9) continue;
    const cel: Record<number, string> = {};
    for (const c of linha[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
      if (v == null) continue;
      cel[colunaDe(c[1])] = (/t="s"/.test(c[2]) ? (textos[+v] ?? "") : desescapar(v)).trim();
    }
    const certificado = cel[24] ?? "";
    const ciclo = cel[21] ?? "";
    if (!/^\d{1,5}\/\d{4}/.test(certificado) || !ciclo) continue; // "não realizado", "cancelado", meses sem tratamento
    const dur = cel[23] ?? "";
    const min = /^\d+(\.\d+)?$/.test(dur)
      ? // número: minutos ("32") ou fração de dia (hora do Excel)
        parseFloat(dur) < 1
        ? Math.round(parseFloat(dur) * 1440)
        : Math.round(parseFloat(dur))
      : minutosDe(dur);
    out.push({
      ciclo,
      lote: loteDoCodigo(ciclo),
      certificado,
      data: data(cel[15] ?? ""),
      hora: horaDe(cel[16] ?? ""),
      modalidade: cel[18] ?? "",
      temperatura: (cel[22] ?? "").replace(/\s*°?\s*C$/i, ""),
      minutos: min,
      local: cel[17] ?? "",
      volumes: cel[10] ?? "",
      unidadeVolumes: cel[11] ?? "",
      produto: cel[9] ?? "",
      tomador: cel[6] ?? "",
      tomadorCnpj: dig(cel[7] ?? ""),
    });
  }
  return out;
}

const semZeros = (c: string) => (/^\d+$/.test(c) ? String(parseInt(c, 10)) : c.toUpperCase());

/** Linhas do relatório do ciclo (ou lote) pedido. */
export function linhasDoCiclo(rel: LinhaRelatorio[], ciclo: string): LinhaRelatorio[] {
  const c = semZeros(ciclo.trim());
  return rel.filter((l) => semZeros(l.ciclo) === c || (l.lote && l.lote === c));
}

/**
 * O ciclo se repete (cada unidade/caminhão da Mann tem a sua contagem): fica a linha do tomador da
 * remessa (pelo CNPJ ou pelo nome) e, empatando, a mais recente.
 */
export function escolherLinha(cands: LinhaRelatorio[], tomador: { cnpj?: string | null; nome?: string | null }): LinhaRelatorio | null {
  if (!cands.length) return null;
  const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/\s+/)[0] ?? "";
  const quando = (l: LinhaRelatorio) => l.data.split("/").reverse().join("") + l.hora;
  const porCnpj = tomador.cnpj ? cands.filter((l) => l.tomadorCnpj && l.tomadorCnpj === dig(tomador.cnpj!)) : [];
  const porNome = tomador.nome ? cands.filter((l) => l.tomador && chave(l.tomador) === chave(tomador.nome!)) : [];
  const base = porCnpj.length ? porCnpj : porNome.length ? porNome : cands;
  return [...base].sort((a, b) => quando(b).localeCompare(quando(a)))[0];
}

/** Linha do tratamento da declaração a partir da linha do relatório. */
export function linhaDoRelatorio(l: LinhaRelatorio): LinhaTratamento {
  const unidade = /^unidades?$/i.test(l.unidadeVolumes) || !l.unidadeVolumes ? (l.produto.split(/\s+/)[0] ?? "") : l.unidadeVolumes;
  return {
    certificado: l.certificado,
    ciclo: l.ciclo,
    lote: l.lote,
    inicio: [l.data, l.hora].filter(Boolean).join(" "),
    fim: "",
    tipo: /KD/i.test(l.modalidade) ? "KD" : "HT",
    temperatura: l.temperatura || "56",
    duracao: l.minutos ? `${l.minutos} min` : "",
    quantidade: l.volumes ? `${l.volumes} ${unidade.toLowerCase()}`.trim() : "",
  };
}
