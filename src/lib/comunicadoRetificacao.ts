// Retificação do comunicado: lê o comunicado emitido (texto do PDF ou o Excel), troca os campos que
// mudaram (nº com sufixo, produto, quantidade, horário) e põe o motivo na observação. Sufixos como nos
// comunicados já retificados: alteração "-A", "-A2", "-A3"…; cancelamento "-C". Na Mann Móvel (nº = aviso)
// vale a tabela da aba AVISO do Excel dela: AC cancelamento, AH horário, AM material, AMH material e horário,
// AQ quantidade, AU unidade volante, AUM, AUH, AUHM; a segunda alteração igual leva o número ("-AH1").
// Roda no navegador.
import { ROTULOS_COMUNICADO, type CampoComunicado } from "./comunicadoModelo";

export type TipoRetificacao = "alteracao" | "cancelamento";
export const CAMPOS_RETIFICAVEIS: CampoComunicado[] = ["produto", "quantidade", "horario"];
/** Na Mann Móvel a unidade volante também muda (AU…). */
export const CAMPOS_RETIFICAVEIS_MANN: CampoComunicado[] = ["unidade", "produto", "quantidade", "horario"];

/** Tabela de sufixos da Mann Móvel (aba AVISO): campos que mudaram -> sufixo e a descrição. */
const SUFIXOS_MANN: { campos: CampoComunicado[]; sufixo: string; descricao: string }[] = [
  { campos: ["horario"], sufixo: "AH", descricao: "Alteração do horário de início do tratamento" },
  { campos: ["produto"], sufixo: "AM", descricao: "Alteração de material" },
  { campos: ["produto", "horario"], sufixo: "AMH", descricao: "Alteração de material e horário" },
  { campos: ["quantidade"], sufixo: "AQ", descricao: "Alteração de quantidade" },
  { campos: ["unidade"], sufixo: "AU", descricao: "Alteração da unidade volante" },
  { campos: ["unidade", "produto"], sufixo: "AUM", descricao: "Alteração da unidade volante e material" },
  { campos: ["unidade", "horario"], sufixo: "AUH", descricao: "Alteração da unidade volante e horário" },
  { campos: ["unidade", "horario", "produto"], sufixo: "AUHM", descricao: "Alteração da unidade volante, horário e material" },
];
const mesmos = (a: CampoComunicado[], b: CampoComunicado[]) => a.length === b.length && a.every((x) => b.includes(x));
/** Sufixo da Mann para o que mudou (null quando a combinação não está na tabela). */
export const sufixoMann = (mudou: CampoComunicado[]) => SUFIXOS_MANN.find((s) => mesmos(s.campos, mudou)) ?? null;

/** Campos que continuam na linha de baixo no PDF (endereço comprido, um item por linha na quantidade). */
const CONTINUA = new Set<CampoComunicado>(["tomador", "local", "quantidade", "produto"]);

/**
 * Valores do comunicado pelo texto do PDF: cada rótulo do MAPA ("Quantidade:", "Horário do início do
 * tratamento:"…) e o que vem depois dele, até o próximo rótulo.
 */
export function lerComunicadoDoTexto(texto: string): Partial<Record<CampoComunicado, string>> {
  const out: Partial<Record<CampoComunicado, string>> = {};
  let atual: CampoComunicado | null = null;
  for (const bruta of texto.replace(/\r/g, "").split("\n")) {
    const l = bruta.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    if (!l) continue;
    const achado = ROTULOS_COMUNICADO.find(([, re]) => re.test(l) && l.includes(":"));
    if (achado && !out[achado[0]]) {
      atual = achado[0];
      out[atual] = l.slice(l.indexOf(":") + 1).trim();
      continue;
    }
    // Cabeçalho, título e observação não continuam campo nenhum.
    if (/^(?:COMUNICADO DE TRATAMENTO|REGISTRO M\.?A\.?P\.?A|CNPJ\s*:|CEP\s*:|Obs\b|Reg\.?\s*CREA)/i.test(l)) {
      atual = null;
      continue;
    }
    if (atual && CONTINUA.has(atual)) out[atual] = out[atual] ? `${out[atual]}${atual === "quantidade" ? "\n" : " "}${l}` : l;
    else atual = null;
  }
  return out;
}

/** "361/2026-A" -> { base: "361/2026", sufixo: "A" }. */
export function partirNumero(numero: string): { base: string; sufixo: string } {
  const m = numero.trim().match(/^(\d{1,5}\s*\/\s*\d{2,4})\s*(?:-\s*([A-Z]{1,4}\d*))?/i);
  return m ? { base: m[1].replace(/\s+/g, ""), sufixo: (m[2] ?? "").toUpperCase() } : { base: numero.trim(), sufixo: "" };
}

/**
 * Sufixo da retificação. `existentes`: os sufixos que esse nº já tem (do arquivo enviado e dos PDFs da
 * pasta), para a segunda alteração virar "-A2" (ou "-AH1" na Mann).
 */
export function sufixoRetificacao(tipo: TipoRetificacao, existentes: string[], op: { mann: boolean; mudou: CampoComunicado[] }): string {
  if (tipo === "cancelamento") return op.mann ? "AC" : "C";
  if (op.mann) {
    // Fora da tabela (ex.: quantidade e horário juntos): as letras na ordem U, M, Q, H — confira.
    const base =
      sufixoMann(op.mudou)?.sufixo ??
      `A${op.mudou.includes("unidade") ? "U" : ""}${op.mudou.includes("produto") ? "M" : ""}${op.mudou.includes("quantidade") ? "Q" : ""}${op.mudou.includes("horario") ? "H" : ""}`;
    const ja = existentes.filter((s) => s.replace(/\d+$/, "") === base);
    if (!ja.length) return base;
    const n = Math.max(0, ...ja.map((s) => +(s.match(/\d+$/)?.[0] ?? 0)));
    return `${base}${n + 1}`;
  }
  const alteracoes = existentes.filter((s) => /^A\d*$/.test(s));
  if (!alteracoes.length) return "A";
  const n = Math.max(...alteracoes.map((s) => (s === "A" ? 1 : +s.slice(1))));
  return `A${n + 1}`;
}

/** Motivo padrão: "Alteração de horário", "Alteração de quantidade e horário", "Comunicado cancelado". */
export function motivoPadrao(tipo: TipoRetificacao, mudou: CampoComunicado[], mann = false): string {
  if (tipo === "cancelamento") return mann ? "Cancelamento" : "Comunicado cancelado";
  if (mann && sufixoMann(mudou)) return sufixoMann(mudou)!.descricao;
  const nomes: Partial<Record<CampoComunicado, string>> = { unidade: "unidade volante", produto: "produto", quantidade: "quantidade", horario: "horário" };
  const ps = mudou.map((c) => nomes[c]).filter(Boolean) as string[];
  if (!ps.length) return "Alteração do comunicado";
  return `Alteração de ${ps.length === 1 ? ps[0] : `${ps.slice(0, -1).join(", ")} e ${ps[ps.length - 1]}`}`;
}

/** Sufixos que um nº já tem nos nomes dos PDFs ("COMUNICADO 361-2026-A …", "COMUNICADO 1612-2026-AH1 …"). */
export function sufixosNosNomes(nomes: string[], base: string): string[] {
  const [n, ano] = base.split("/");
  const re = new RegExp(`^COMUNICADO\\s*0*${+n}\\s*-\\s*(?:${ano}|${ano.slice(-2)})\\s*-\\s*([A-Z]{1,4}\\d*)\\b`, "i");
  return nomes.map((x) => x.match(re)?.[1]?.toUpperCase()).filter((x): x is string => !!x);
}

/**
 * Nome do arquivo pelo nome do modelo: "COMUNICADO 001-2026- MADEPALLETE- BR-PR0940.xlsx" + "360/2026" ->
 * "COMUNICADO 360-2026- MADEPALLETE- BR-PR0940.xlsx"; com sufixo, ele fica no lugar do hífen
 * ("COMUNICADO 361-2026-A MADEPALLETE- BR-PR0940", como nos retificados no Excel).
 */
export function nomeComunicado(modelo: string | null, numero: string, apelido: string): string {
  const { base, sufixo } = partirNumero(numero);
  const nome = modelo ?? `COMUNICADO 000-0000 - ${apelido}.xlsx`;
  // Ano com 2 dígitos quando o nome do modelo usa assim ("COMUNICADO 001-26 - AGK…" -> "118-26").
  const anoCurto = /COMUNICADO\s+\d{1,5}-\d{2}(?!\d)/i.test(nome);
  const n = base.replace(/\//g, "-").replace(/-(\d{2})(\d{2})$/, (t, a, b) => (anoCurto ? `-${b}` : t));
  const re = /(COMUNICADO\s+)\d{1,5}(?:-[A-Z]{1,4}\d*)?-\d{2,4}(?:-[A-Z]{1,4}\d*)?(\s*-?)/i;
  let trocado = nome.replace(re, (_, ini: string, depois: string) => (sufixo ? `${ini}${n}-${sufixo}${depois.replace(/^\s*-/, "")}` : `${ini}${n}${depois}`));
  if (trocado === nome) trocado = `COMUNICADO ${n}${sufixo ? `-${sufixo}` : ""} - ${apelido}.xlsx`;
  if (sufixo) trocado = trocado.replace(new RegExp(`(${n}-${sufixo})(?=\S)`), "$1 ");
  return trocado.replace(/[\/:*?"<>|]/g, "-");
}
