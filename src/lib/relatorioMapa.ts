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

/** Lê a aba TÉRMICO do relatório (as colunas pelo nome do cabeçalho: o modelo do MAPA muda de ano em ano). */
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

  // Linhas da planilha (célula por coluna, 1 = A).
  const linhas: { n: number; cel: Record<number, string> }[] = [];
  for (const linha of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cel: Record<number, string> = {};
    for (const c of linha[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c[3]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
      if (v == null) continue;
      cel[colunaDe(c[1])] = (/t="s"/.test(c[2]) ? (textos[+v] ?? "") : desescapar(v)).trim();
    }
    linhas.push({ n: +linha[1], cel });
  }

  // O modelo muda de ano em ano e entre cadastradas e credenciadas (as cadastradas não têm o tomador e
  // têm a coluna "Lote"): as colunas são achadas pelo cabeçalho, não pela posição.
  const cab = linhas.slice(0, 20).find((l) => {
    const t = Object.values(l.cel).join(" | ");
    return /ciclo de tratamento/i.test(t) && /certificado de tratamento/i.test(t);
  });
  if (!cab) throw new Error("Não achei o cabeçalho da aba TÉRMICO (“Número do Ciclo de Tratamento”, “Nº do Certificado de Tratamento”).");
  const achar = (re: RegExp, depois = 0) => {
    const k = Object.entries(cab.cel).find(([c, t]) => +c > depois && re.test(t.replace(/\s+/g, " ").trim()));
    return k ? +k[0] : null;
  };
  const col = {
    tomador: achar(/^nome da empresa tomadora/i),
    tomadorCnpj: achar(/^cnpj da empresa tomadora/i),
    produto: achar(/^produto tratado/i),
    volumes: achar(/^n[úu]mero de volumes/i),
    data: achar(/^data do tratamento/i),
    hora: achar(/^hor[áa]rio do in[íi]cio/i),
    local: achar(/^local do tratamento/i),
    modalidade: achar(/^modalidade/i),
    ciclo: achar(/^n[úu]mero do ciclo/i),
    temperatura: achar(/^temperatura/i),
    duracao: achar(/^dura[çc][ãa]o/i),
    lote: achar(/^lote\b/i),
    certificado: achar(/^n[º°o.]*\s*do certificado de tratamento/i),
  };
  const faltam = (["ciclo", "certificado", "data"] as const).filter((k) => col[k] == null);
  if (faltam.length) throw new Error(`A aba TÉRMICO mudou: não achei a coluna ${faltam.map((k) => ({ ciclo: "do ciclo", certificado: "do nº do certificado", data: "da data do tratamento" })[k]).join(", ")}.`);
  // "Unidade" logo depois do nº de volumes.
  const colUnidade = col.volumes != null && /^unidade/i.test(cab.cel[col.volumes + 1] ?? "") ? col.volumes + 1 : null;
  const de = (cel: Record<number, string>, c: number | null) => (c == null ? "" : (cel[c] ?? ""));

  const out: LinhaRelatorio[] = [];
  for (const { n, cel } of linhas) {
    if (n <= cab.n) continue;
    const certificado = de(cel, col.certificado);
    const ciclo = de(cel, col.ciclo);
    if (!/^\d{1,5}\/\d{4}/.test(certificado) || !ciclo) continue; // "não realizado", "cancelado", meses sem tratamento
    const dur = de(cel, col.duracao);
    const min = /^\d+(\.\d+)?$/.test(dur)
      ? // número: minutos ("32") ou fração de dia (hora do Excel)
        parseFloat(dur) < 1
        ? Math.round(parseFloat(dur) * 1440)
        : Math.round(parseFloat(dur))
      : minutosDe(dur);
    out.push({
      ciclo,
      lote: de(cel, col.lote).replace(/\.0+$/, "") || loteDoCodigo(ciclo),
      certificado,
      data: data(de(cel, col.data)),
      hora: horaDe(de(cel, col.hora)),
      modalidade: de(cel, col.modalidade),
      temperatura: de(cel, col.temperatura).replace(/\s*°?\s*C$/i, ""),
      minutos: min,
      local: de(cel, col.local),
      volumes: de(cel, col.volumes),
      unidadeVolumes: de(cel, colUnidade),
      produto: de(cel, col.produto),
      tomador: de(cel, col.tomador),
      tomadorCnpj: dig(de(cel, col.tomadorCnpj)),
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

/** "03/10/2026" + "08h24m" + 31 min -> "03/10/2026 08h55m" (virando o dia, a data acompanha). */
function terminoDe(data: string, hora: string, minutos: number | null): string {
  const d = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const h = hora.match(/^(\d{1,2})h(\d{2})m$/);
  if (!d || !h || !minutos) return "";
  const t = new Date(Date.UTC(+d[3], +d[2] - 1, +d[1], +h[1], +h[2]) + minutos * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p(t.getUTCHours())}h${p(t.getUTCMinutes())}m`;
}

/** Linha do tratamento da declaração a partir da linha do relatório. */
export function linhaDoRelatorio(l: LinhaRelatorio): LinhaTratamento {
  const unidade = /^unidades?$/i.test(l.unidadeVolumes) || !l.unidadeVolumes ? (l.produto.split(/\s+/)[0] ?? "") : l.unidadeVolumes;
  return {
    certificado: l.certificado,
    ciclo: l.ciclo,
    lote: l.lote,
    inicio: [l.data, l.hora].filter(Boolean).join(" "),
    fim: terminoDe(l.data, l.hora, l.minutos),
    tipo: /KD/i.test(l.modalidade) ? "KD" : "HT",
    temperatura: l.temperatura || "56",
    duracao: l.minutos ? `${l.minutos} min` : "",
    quantidade: l.volumes ? `${l.volumes} ${unidade.toLowerCase()}`.trim() : "",
  };
}
