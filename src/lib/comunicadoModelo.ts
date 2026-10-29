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
  for (const [campo, valor] of Object.entries(valores) as [CampoComunicado, string][]) {
    const c = modelo.campos[campo];
    if (!c || valor == null) continue;
    const ref = c.celula;
    const novo = (estilo: string) => `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${esc(valor)}</t></is></c>`;
    const re = new RegExp(`<c r="${ref}"([^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    const m = xml.match(re);
    if (m) {
      const estilo = m[1].match(/\ss="\d+"/)?.[0] ?? "";
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
