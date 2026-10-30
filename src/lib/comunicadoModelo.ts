// Modelo do comunicado de tratamento de cada empresa: o Excel que ela já usa (timbre, logo e os rótulos
// "Comunicado de tratamento nº:", "Razão Social/ CNPJ (Tomador de serviço):"…). O site acha cada campo
// pelo rótulo (a linha muda de empresa para empresa) e escreve o valor na célula ao lado, sem mexer no
// resto do arquivo. O valor que está no modelo é o do último comunicado emitido nele. Roda no navegador.
import JSZip from "jszip";

export type CampoComunicado =
  | "numero"
  | "tomador"
  | "aviso"
  | "local"
  | "unidade"
  | "destino"
  | "produto"
  | "volumes"
  | "quantidade"
  | "marcas"
  | "modalidade"
  | "data"
  | "horario"
  | "duracao"
  | "temperatura"
  | "observacao"
  // Modelo em tabela (CJ Tedeski): o interessado (razão social) e a cidade do local vão em colunas próprias.
  | "interessado"
  | "cidade";

/** Rótulos do modelo do MAPA (iguais em todas as empresas; só a linha muda). */
export const ROTULOS_COMUNICADO: [CampoComunicado, RegExp, string][] = [
  ["numero", /^(?:comunicado de tratamento (?:fitossanit[áa]rio\s+)?n|n[º°o]?\s*do comunicado de tratamento)/i, "Comunicado de tratamento nº"],
  ["tomador", /^(?:raz[ãa]o social\s*\/\s*cnpj|tomador de servi[çc]o)/i, "Razão Social / CNPJ (tomador de serviço)"],
  ["aviso", /^n[úu]mero do aviso/i, "Número do aviso"],
  ["local", /^(?:endere[çc]o (?:do local\s+)?de realiza[çc][ãa]o|local de tratamento)/i, "Endereço do local de realização do tratamento"],
  ["unidade", /^unidade volante/i, "Unidade volante"],
  ["destino", /^destino/i, "Destino"],
  ["produto", /^produto a ser tratado/i, "Produto a ser tratado"],
  ["volumes", /^n[º°o]?\s*e descri[çc][ãa]o dos volumes/i, "Nº e descrição dos volumes"],
  ["quantidade", /^quantidade/i, "Quantidade"],
  ["marcas", /^marcas distintivas/i, "Marcas distintivas"],
  ["modalidade", /^modalidade de tratamento/i, "Modalidade de tratamento"],
  ["data", /^data [ds]o in[íi]cio do tratamento/i, "Data do início do tratamento"],
  ["horario", /^hor[áa]rio do in[íi]cio/i, "Horário do início do tratamento"],
  ["duracao", /^dura[çc][ãa]o do tratamento/i, "Duração do tratamento"],
  ["temperatura", /^temperatura/i, "Temperatura"],
  ["observacao", /^observa[çc][ãa]o/i, "Observação"],
  ["interessado", /^interessado$/i, "Interessado (tabela)"],
  ["cidade", /^local$/i, "Local (tabela)"],
];

/**
 * Modelo em tabela (CJ Tedeski: uma linha de cabeçalho "LOCAL | INTERESSADO | MERCADORIA… | DATA | HORA")
 * — o valor vai na célula logo abaixo do título.
 */
const TITULOS_TABELA: [CampoComunicado, RegExp][] = [
  ["cidade", /^local$/i],
  ["interessado", /^interessado$/i],
  ["produto", /^mercadoria/i],
  ["unidade", /^unidade de tratamento$/i],
  ["quantidade", /^quantidade$/i],
  ["data", /^data$/i],
  ["horario", /^hora$/i],
  ["duracao", /^tempo de exposi[çc][ãa]o$/i],
  ["temperatura", /^temperatura$/i],
];

export interface CampoModelo {
  campo: CampoComunicado;
  rotulo: string;
  celula: string; // "B10"
  valor: string; // o que está no modelo (último comunicado)
}

export interface ModeloComunicado {
  aba: string; // caminho da planilha no zip
  campos: Partial<Record<CampoComunicado, CampoModelo>>;
  /** Para o PDF: título ("COMUNICADO DE TRATAMENTO COM FINS QUARENTENÁRIOS"), registro e cabeçalho do modelo. */
  titulo?: string;
  registro?: string;
  /** Textos do cabeçalho (coluna A, acima do título): no modelo em tabela é o quadro da empresa. */
  cabecalho: string[];
  /** Modelo em tabela (CJ): as colunas na ordem, com o campo de cada uma ou o valor fixo (Nº "1", identificação). */
  tabela?: { titulo: string; campo?: CampoComunicado; fixo: string }[];
}

const desescapar = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colunaDe = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const letraDe = (n: number): string => (n <= 0 ? "" : letraDe(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));

function dataDeSerial(n: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

async function abrir(bytes: ArrayBuffer | Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
  const sst = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const textos = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("")));
  const abas = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="(\w+)"/g)].map((m) => {
    const alvo = rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`))?.[1] ?? "";
    return { nome: desescapar(m[1]), caminho: `xl/${alvo.replace(/^\/?xl\//, "")}` };
  });
  return { zip, textos, abas };
}

/** Células da planilha: valor em texto (compartilhado, inline ou número; data do Excel vira dd/mm/aaaa nos campos de data). */
function celulas(xml: string, textos: string[]): Map<string, { valor: string; numero: boolean }> {
  const out = new Map<string, { valor: string; numero: boolean }>();
  for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const corpo = c[3] ?? "";
    const v = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    const inline = [...corpo.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((t) => t[1]).join("");
    const tipo = c[2].match(/t="(\w+)"/)?.[1];
    if (tipo === "s" && v != null) out.set(c[1], { valor: textos[+v] ?? "", numero: false });
    else if (tipo === "inlineStr") out.set(c[1], { valor: desescapar(inline), numero: false });
    else if (tipo === "str" && v != null) out.set(c[1], { valor: desescapar(v), numero: false });
    else if (v != null) out.set(c[1], { valor: v, numero: !tipo || tipo === "n" });
  }
  return out;
}

/** Acha os campos do comunicado no modelo (a aba que tem os rótulos). */
export async function lerModeloComunicado(bytes: ArrayBuffer | Uint8Array): Promise<ModeloComunicado> {
  const { zip, textos, abas } = await abrir(bytes);
  let melhor: ModeloComunicado | null = null;
  for (const a of abas) {
    const xml = await zip.file(a.caminho)?.async("string");
    if (!xml) continue;
    const cel = celulas(xml, textos);
    const campos: ModeloComunicado["campos"] = {};
    // Rótulo mesclado (CJ: "COMUNICADO … Nº" em E2:J2): o valor fica depois da mescla (K2).
    const mesclas = [...xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)].map((m) => ({ c1: colunaDe(m[1]), l1: +m[2], c2: colunaDe(m[3]), l2: +m[4] }));
    const fimDaMescla = (ref: string) => {
      const c = colunaDe(ref);
      const l = +ref.replace(/[A-Z]+/, "");
      return mesclas.find((m) => m.c1 === c && m.l1 === l)?.c2 ?? c;
    };
    const tituloDeTabela = (t: string) => TITULOS_TABELA.some(([, re]) => re.test(t));
    for (const [ref, { valor: texto }] of cel) {
      const t = texto.replace(/\s+/g, " ").trim();
      if (!/(?::|\bn[º°o]\.?)$/i.test(t) || t.length > 90 || tituloDeTabela(t)) continue;
      const achado = ROTULOS_COMUNICADO.find(([, re]) => re.test(t));
      if (!achado || campos[achado[0]]) continue;
      const linha = ref.replace(/[A-Z]+/, "");
      const celula = `${letraDe(fimDaMescla(ref) + 1)}${linha}`;
      const v = cel.get(celula);
      let valor = v?.valor ?? "";
      if (achado[0] === "data" && v?.numero && /^\d{5}(\.\d+)?$/.test(valor)) valor = dataDeSerial(parseFloat(valor));
      if (/^=|^IF\(/i.test(valor)) valor = "";
      campos[achado[0]] = { campo: achado[0], rotulo: t, celula, valor: valor.trim() };
    }
    // Tabela: a linha com 4 ou mais títulos conhecidos; o valor é a célula de baixo.
    const porLinha = new Map<number, [string, string][]>();
    for (const [ref, { valor }] of cel) {
      const l = +ref.replace(/[A-Z]+/, "");
      porLinha.set(l, [...(porLinha.get(l) ?? []), [ref, valor.replace(/\s+/g, " ").trim()]]);
    }
    const cab = [...porLinha.entries()].find(([, cs]) => cs.filter(([, t]) => tituloDeTabela(t)).length >= 4);
    if (cab) {
      for (const [ref, t] of cab[1]) {
        const achado = TITULOS_TABELA.find(([, re]) => re.test(t));
        if (!achado || campos[achado[0]]) continue;
        const celula = `${ref.replace(/\d+/, "")}${cab[0] + 1}`;
        const v = cel.get(celula);
        let valor = v?.valor ?? "";
        if (achado[0] === "data" && v?.numero && /^\d{5}(\.\d+)?$/.test(valor)) valor = dataDeSerial(parseFloat(valor));
        if (/^=|^IF\(/i.test(valor)) valor = "";
        campos[achado[0]] = { campo: achado[0], rotulo: t, celula, valor: valor.trim() };
      }
    }
    // Título, registro e cabeçalho (para desenhar o PDF).
    const textoDe = (ref: string) => (cel.get(ref)?.valor ?? "").replace(/[ \t]+/g, " ").trim();
    const refs = [...cel.keys()];
    const refTitulo = refs.find((r) => /^COMUNICADO DE TRATAMENTO/i.test(textoDe(r)) && !/:\s*$/.test(textoDe(r)));
    const titulo = refTitulo ? textoDe(refTitulo).replace(/\s*N[º°o]\s*$/i, "").trim() : undefined;
    const refReg = refs.find((r) => /^REGISTRO\s+M\.?A\.?P\.?A/i.test(textoDe(r)));
    const linhaTitulo = refTitulo ? +refTitulo.replace(/[A-Z]+/, "") : 6;
    const cabecalho = refs
      .filter((r) => /^A\d+$/.test(r) && +r.slice(1) < linhaTitulo + (cab ? 6 : 0) && +r.slice(1) <= 8)
      .sort((x, y) => +x.slice(1) - +y.slice(1))
      .map(textoDe)
      .filter((x) => x && !/^COMUNICADO/i.test(x) && !/:\s*$/.test(x));
    let tabela: ModeloComunicado["tabela"];
    if (cab) {
      tabela = cab[1]
        .sort((x, y) => colunaDe(x[0]) - colunaDe(y[0]))
        .filter(([, tt]) => tt)
        .map(([ref, tt]) => {
          const achado = TITULOS_TABELA.find(([, re]) => re.test(tt));
          const fixo = textoDe(`${ref.replace(/\d+/, "")}${cab[0] + 1}`);
          return { titulo: tt, campo: achado?.[0], fixo: /^=|^IF\(/i.test(fixo) ? "" : fixo };
        });
    }
    const modeloAba: ModeloComunicado = { aba: a.caminho, campos, titulo, registro: refReg ? textoDe(refReg) : undefined, cabecalho, tabela };
    if (!melhor || Object.keys(campos).length > Object.keys(melhor.campos).length) melhor = modeloAba;
  }
  if (!melhor || !melhor.campos.numero) throw new Error("Não achei os campos do comunicado neste Excel (rótulo “Comunicado de tratamento nº:”).");
  return melhor;
}

/** Escreve os valores nas células do modelo e devolve o Excel novo (o resto do arquivo fica igual). */
export async function preencherComunicado(
  bytes: ArrayBuffer | Uint8Array,
  modelo: ModeloComunicado,
  valores: Partial<Record<CampoComunicado, string>>
): Promise<Uint8Array> {
  const { zip } = await abrir(bytes);
  let xml = (await zip.file(modelo.aba)?.async("string")) ?? "";
  let estilos = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const comQuebra = new Map<string, number>();
  // Estilo igual ao da célula, com "quebrar texto" (para o valor em várias linhas aparecer em várias linhas).
  const estiloComQuebra = (s: string): number | null => {
    if (comQuebra.has(s)) return comQuebra.get(s)!;
    const bloco = estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (!bloco) return null;
    const xfs = [...bloco[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((x) => x[0]);
    const xf = xfs[+s];
    if (!xf) return null;
    if (/wrapText="(1|true)"/.test(xf)) {
      comQuebra.set(s, +s);
      return +s;
    }
    let novoXf = /wrapText="/.test(xf)
      ? xf.replace(/wrapText="[^"]*"/, 'wrapText="1"')
      : /<alignment\b/.test(xf)
      ? xf.replace(/<alignment\b/, '<alignment wrapText="1"')
      : xf.endsWith("/>")
        ? xf.replace(/\/>$/, '><alignment wrapText="1"/></xf>')
        : xf.replace(/^(<xf\b[^>]*>)/, '$1<alignment wrapText="1"/>');
    if (!/applyAlignment=/.test(novoXf)) novoXf = novoXf.replace(/^<xf\b/, '<xf applyAlignment="1"');
    const idx = xfs.length;
    estilos = estilos.replace(bloco[0], bloco[0].replace(/<\/cellXfs>$/, `${novoXf}</cellXfs>`).replace(/(<cellXfs\b[^>]*count=")\d+/, `$1${idx + 1}`));
    comQuebra.set(s, idx);
    return idx;
  };
  // Altura da linha para n linhas de texto (Arial 12 → 15 pt por linha, como o Excel).
  const tamanhoFonte = (s: string): number => {
    const xf = [...(estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)][+s]?.[0] ?? "";
    const fontes = [...(estilos.match(/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/)?.[1] ?? "").matchAll(/<font\b[\s\S]*?<\/font>|<font\b[^>]*\/>/g)].map((x) => x[0]);
    return +(fontes[+(xf.match(/fontId="(\d+)"/)?.[1] ?? 0)]?.match(/<sz val="([\d.]+)"/)?.[1] ?? 11);
  };
  for (const [campo, valor] of Object.entries(valores) as [CampoComunicado, string][]) {
    const c = modelo.campos[campo];
    if (!c || valor == null) continue;
    const ref = c.celula;
    const novo = (estilo: string) => `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
    const re = new RegExp(`<c r="${ref}"([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    const m = xml.match(re);
    if (m) {
      let estilo = m[1].match(/\ss="\d+"/)?.[0] ?? "";
      // Valor em várias linhas (quantidade com um item por linha): quebra o texto e aumenta a linha.
      const nLinhas = valor.split("\n").length;
      if (nLinhas > 1) {
        const s = estilo.match(/\d+/)?.[0] ?? "0";
        const q = estiloComQuebra(s);
        if (q != null) estilo = ` s="${q}"`;
        const linha = ref.replace(/[A-Z]+/, "");
        const precisa = Math.ceil((nLinhas * tamanhoFonte(s) * 1.25 + 4) * 4) / 4;
        xml = xml.replace(new RegExp(`<row\\b[^>]*\\sr="${linha}"[^>]*>`), (tag) => {
          const ht = +(tag.match(/\sht="([\d.]+)"/)?.[1] ?? 0);
          if (ht >= precisa) return tag;
          const semHt = tag.replace(/\sht="[\d.]+"/, "").replace(/\scustomHeight="\w+"/, "");
          return semHt.replace(/>$/, ` ht="${precisa}" customHeight="1">`);
        });
      }
      xml = xml.replace(re, novo(estilo));
    } else {
      // Célula que não existe no XML: entra na linha, na ordem das colunas.
      const linha = ref.replace(/[A-Z]+/, "");
      const reLinha = new RegExp(`<row [^>]*r="${linha}"[^>]*>([\\s\\S]*?)<\\/row>`);
      const ml = xml.match(reLinha);
      if (ml) {
        const col = colunaDe(ref);
        const cels = [...ml[1].matchAll(/<c r="([A-Z]+)\d+"[\s\S]*?(?:\/>|<\/c>)/g)];
        const depois = cels.find((x) => colunaDe(x[1]) > col);
        const corpo = depois ? ml[1].replace(depois[0], novo("") + depois[0]) : ml[1] + novo("");
        xml = xml.replace(ml[0], ml[0].replace(ml[1], corpo));
      }
    }
  }
  zip.file(modelo.aba, xml);
  if (comQuebra.size) zip.file("xl/styles.xml", estilos);
  // Fórmulas trocadas por valor (modelo da Mann): a cadeia de cálculo antiga sai, senão o Excel pede reparo.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const ct = (await zip.file("[Content_Types].xml")?.async("string")) ?? "";
    zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*calcChain[^>]*\/>/g, ""));
    const rels = (await zip.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "";
    zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/g, ""));
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** Próximo número: "357/2026" -> "358/2026" (mesmos dígitos); outro ano -> "001/<ano>". */
export function proximoNumero(ultimo: string | null | undefined, ano: number): string {
  const m = (ultimo ?? "").match(/(\d{1,5})\s*[/-]\s*(\d{2,4})/);
  if (!m) return `001/${ano}`;
  const anoUlt = m[2].length === 2 ? 2000 + +m[2] : +m[2];
  const digitos = Math.max(3, m[1].length);
  if (anoUlt !== ano) return `${"1".padStart(digitos, "0")}/${ano}`;
  return `${String(+m[1] + 1).padStart(digitos, "0")}/${ano}`;
}

/**
 * Observação da retificação ("Obs: Alteração de horário", "Obs: comunicado cancelado"): no campo
 * "Observação:" quando o modelo tem (Mann); senão na linha logo abaixo da tabela, mesclada e centralizada,
 * como nos comunicados retificados no Excel (361-2026-A, 054-2026-C). Devolve o Excel novo.
 */
export async function comObservacao(bytes: ArrayBuffer | Uint8Array, modelo: ModeloComunicado, texto: string): Promise<Uint8Array> {
  if (modelo.campos.observacao) return preencherComunicado(bytes, modelo, { observacao: texto });
  const { zip } = await abrir(bytes);
  let xml = (await zip.file(modelo.aba)?.async("string")) ?? "";
  let estilos = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const cels = Object.values(modelo.campos).map((c) => c!.celula);
  const linha = Math.max(...cels.map((c) => +c.replace(/[A-Z]+/, ""))) + 1;
  const ultimaCol = Math.max(...cels.map(colunaDe));
  const valor = `Obs: ${texto}`;
  const celula = (ref: string, s: string) => `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
  const reLinha = new RegExp(`<row\\b[^>]*\\sr="${linha}"[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/row>)`);
  const ml = xml.match(reLinha);
  // Já tem texto na linha (modelo com "OBS: …" de um comunicado anterior): troca o texto dessa célula.
  const comTexto = ml?.[1]?.match(/<c r="([A-Z]+\d+)"([^>]*?)>(?:(?!<\/c>)[\s\S])*?(?:<v>|<t)[\s\S]*?<\/c>/);
  if (comTexto) {
    const s = comTexto[2].match(/\ss="\d+"/)?.[0] ?? "";
    xml = xml.replace(comTexto[0], celula(comTexto[1], s));
  } else {
    // Estilo: a fonte do valor de um campo (sem negrito do rótulo), centralizado e sem borda.
    const bloco = estilos.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    const xfs = bloco ? [...bloco[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((x) => x[0]) : [];
    const refValor = modelo.campos.temperatura?.celula ?? cels[cels.length - 1];
    const sValor = xml.match(new RegExp(`<c r="${refValor}"[^>]*?\\ss="(\\d+)"`))?.[1] ?? "0";
    let s = "";
    if (bloco && xfs[+sValor]) {
      const base = xfs[+sValor].replace(/\sborderId="\d+"/, ' borderId="0"').replace(/<alignment\b[^>]*\/>|<alignment\b[^>]*>[\s\S]*?<\/alignment>/, "");
      const centro = '<alignment horizontal="center" vertical="center"/>';
      // O <alignment> vem antes do <protection> (ordem que o Excel exige).
      const alinhado = base.endsWith("/>") ? base.replace(/\/>$/, `>${centro}</xf>`) : base.replace(/^(<xf\b[^>]*>)/, `$1${centro}`);
      const final = /applyAlignment=/.test(alinhado) ? alinhado : alinhado.replace(/^<xf\b/, '<xf applyAlignment="1"');
      estilos = estilos.replace(bloco[0], bloco[0].replace(/<\/cellXfs>$/, `${final}</cellXfs>`).replace(/(<cellXfs\b[^>]*count=")\d+/, `$1${xfs.length + 1}`));
      s = ` s="${xfs.length}"`;
      zip.file("xl/styles.xml", estilos);
    }
    const nova = celula(`A${linha}`, s);
    if (ml) {
      // Linha existe (vazia ou com células só de borda): a célula A entra no começo.
      const semA = (ml[1] ?? "").replace(new RegExp(`<c r="A${linha}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`), "");
      const tag = ml[0].match(/^<row\b[^>]*?(?=\/?>)/)![0];
      const ht = +(tag.match(/\sht="([\d.]+)"/)?.[1] ?? 0);
      const tagNova = ht >= 20 ? tag : `${tag.replace(/\sht="[\d.]+"/, "").replace(/\scustomHeight="\w+"/, "")} ht="22" customHeight="1"`;
      xml = xml.replace(ml[0], `${tagNova}>${nova}${semA}</row>`);
    } else {
      // Linha nova, na ordem das linhas.
      const depois = [...xml.matchAll(/<row\b[^>]*\sr="(\d+)"/g)].find((r) => +r[1] > linha);
      const row = `<row r="${linha}" ht="22" customHeight="1">${nova}</row>`;
      xml = depois ? xml.replace(depois[0], row + depois[0]) : xml.replace(/<\/sheetData>/, `${row}</sheetData>`);
    }
    // Mescla A:última coluna, se ainda não houver mescla nessa linha.
    if (!new RegExp(`<mergeCell ref="A${linha}:`).test(xml)) {
      const merge = `<mergeCell ref="A${linha}:${letraDe(ultimaCol)}${linha}"/>`;
      xml = /<mergeCells\b/.test(xml)
        ? xml.replace(/<mergeCells\b([^>]*)count="(\d+)"([^>]*)>/, (_, a, n, b) => `<mergeCells${a}count="${+n + 1}"${b}>${merge}`)
        : xml.replace(/<\/sheetData>/, `</sheetData><mergeCells count="1">${merge}</mergeCells>`);
    }
  }
  zip.file(modelo.aba, xml);
  // Área de impressão que acaba antes da linha da observação: estende até ela.
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  const novoWb = wb.replace(/(<definedName\b[^>]*name="_xlnm.Print_Area"[^>]*>[^<]*?\$?[A-Z]+\$?)(\d+)(<\/definedName>)/, (t, a, n, b) => (+n < linha ? `${a}${linha}${b}` : t));
  if (novoWb !== wb) zip.file("xl/workbook.xml", novoWb);
  return zip.generateAsync({ type: "uint8array" });
}
