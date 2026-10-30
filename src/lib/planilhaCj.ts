// Planilha de controle da CJ Tedeski (Controle_Tratamentos_CJ.xlsx): a aba CONTROLE tem um tratamento por
// linha (Aviso, Data, Horário, Empresa, Local, Material Tratado, Quant., Operador, Unidade…) e os pendentes de
// comunicado estão em vermelho. Daqui saem só esses, com o nº do aviso; a aba DADOS dá o nome, o CNPJ e o
// endereço de cada empresa. A aba PETICIONAMENTO (senhas do SEI) não é lida. Roda no navegador.
import JSZip from "jszip";

export interface LinhaControleCj {
  aviso: string;
  data: string; // "04/11/2026"
  horario: string; // "1:00", como no comunicado da CJ
  empresa: string; // "Elopack Matriz"
  local: string; // "Torrinha"
  material: string;
  quantidade: string;
  unidade: string; // "Móvel DWI3H89", "Fixa Salto"
  nome: string; // razão social (DADOS)
  cnpj: string;
  endereco: string;
}

const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");
const colunaDe = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const p2 = (n: number) => String(n).padStart(2, "0");

/** Data do Excel (nº de série ou "2026-11-04…" ou "04/11/2026") -> "04/11/2026". */
function dataDe(v: string): string {
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86400000);
    return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return v;
}

/** Hora do Excel (fração do dia ou "01:00:00") -> "1:00" (sem zero na frente, como a CJ escreve). */
function horaDe(v: string): string {
  // Fração do dia, às vezes em notação científica ("4.1666666666666664E-2" = 1:00).
  if (/^\d*\.?\d+(?:E-?\d+)?$/i.test(v) && Number.isFinite(parseFloat(v))) {
    const min = Math.round((parseFloat(v) % 1) * 1440) % 1440;
    return `${Math.floor(min / 60)}:${p2(min % 60)}`;
  }
  const m = v.match(/^(\d{1,2})[:h](\d{2})/);
  return m ? `${+m[1]}:${m[2]}` : v;
}

/**
 * As linhas em vermelho da aba CONTROLE (os comunicados pendentes), ou null se o Excel não é a planilha de
 * controle da CJ.
 */
export async function pendentesDaPlanilhaCj(bytes: ArrayBuffer | Uint8Array): Promise<LinhaControleCj[] | null> {
  const zip = await JSZip.loadAsync(bytes);
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const caminho = (nome: RegExp) => {
    const s = [...wb.matchAll(/<sheet\b[^>]*>/g)].find((m) => nome.test(desescapar(m[0].match(/name="([^"]+)"/)?.[1] ?? "")));
    const rid = s?.[0].match(/r:id="([^"]+)"/)?.[1];
    const alvo = rid ? rels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*>`))?.[0]?.match(/Target="([^"]+)"/)?.[1] : undefined;
    return alvo ? `xl/${alvo.replace(/^\/?xl\//, "")}` : null;
  };
  const cControle = caminho(/^controle$/i);
  if (!cControle) return null;
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const textos = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  // Estilos com fonte vermelha (cor FF0000).
  const estilos = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const fontes = [...(estilos.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)?.[1] ?? "").matchAll(/<font\b[\s\S]*?<\/font>|<font\b[^>]*\/>/g)].map((m) =>
    /<color\b[^>]*rgb="(?:FF)?FF0000"/i.test(m[0])
  );
  const vermelho = [...(estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(
    (m) => fontes[+(m[0].match(/fontId="(\d+)"/)?.[1] ?? 0)] ?? false
  );

  const linhasDa = async (c: string) => {
    const xml = (await zip.file(c)?.async("string")) ?? "";
    const out: { cel: Record<number, string>; vermelha: boolean }[] = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cel: Record<number, string> = {};
      let vermelha = false;
      for (const c2 of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = c2[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? c2[3]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1];
        const col = colunaDe(c2[1]);
        if (v == null) continue;
        cel[col] = (/t="s"/.test(c2[2]) ? (textos[+v] ?? "") : desescapar(v)).trim();
        if (col <= 2 && vermelho[+(c2[2].match(/\ss="(\d+)"/)?.[1] ?? 0)]) vermelha = true;
      }
      out.push({ cel, vermelha });
    }
    return out;
  };

  const controle = await linhasDa(cControle);
  const iCab = controle.findIndex((l) => Object.values(l.cel).some((t) => /^aviso$/i.test(t)) && Object.values(l.cel).some((t) => /^empresa$/i.test(t)));
  if (iCab < 0) return null;
  const cab = controle[iCab].cel;
  const col = (re: RegExp) => +(Object.entries(cab).find(([, t]) => re.test(semAcento(t)))?.[0] ?? 0);
  const k = {
    aviso: col(/^aviso$/),
    data: col(/^data$/),
    hora: col(/^horario$/),
    empresa: col(/^empresa$/),
    local: col(/^local$/),
    material: col(/^material/),
    qtd: col(/^quant/),
    unidade: col(/^unidade$/),
  };

  // DADOS: Empresa -> Nome, CNPJ, Endereço.
  const dados = new Map<string, { nome: string; cnpj: string; endereco: string }>();
  const cDados = caminho(/^dados$/i);
  if (cDados) {
    const ls = await linhasDa(cDados);
    const iD = ls.findIndex((l) => Object.values(l.cel).some((t) => /^empresa$/i.test(t)));
    if (iD >= 0) {
      const cd = ls[iD].cel;
      const c = (re: RegExp) => +(Object.entries(cd).find(([, t]) => re.test(semAcento(t)))?.[0] ?? 0);
      const [cE, cN, cC, cEnd] = [c(/^empresa$/), c(/^nome$/), c(/^cnpj$/), c(/^endereco$/)];
      for (const l of ls.slice(iD + 1)) if (l.cel[cE]) dados.set(semAcento(l.cel[cE]), { nome: l.cel[cN] ?? "", cnpj: l.cel[cC] ?? "", endereco: l.cel[cEnd] ?? "" });
    }
  }

  const out: LinhaControleCj[] = [];
  for (const l of controle.slice(iCab + 1)) {
    const aviso = l.cel[k.aviso] ?? "";
    if (!l.vermelha || !/^\d{1,5}\/\d{2,4}/.test(aviso)) continue;
    const empresa = l.cel[k.empresa] ?? "";
    const d = dados.get(semAcento(empresa));
    out.push({
      aviso,
      data: dataDe(l.cel[k.data] ?? ""),
      horario: horaDe(l.cel[k.hora] ?? ""),
      empresa,
      local: l.cel[k.local] ?? "",
      material: l.cel[k.material] ?? "",
      quantidade: (l.cel[k.qtd] ?? "").replace(/\.0+$/, ""),
      unidade: l.cel[k.unidade] ?? "",
      nome: d?.nome ?? "",
      cnpj: d?.cnpj ?? "",
      endereco: d?.endereco ?? "",
    });
  }
  return out;
}
