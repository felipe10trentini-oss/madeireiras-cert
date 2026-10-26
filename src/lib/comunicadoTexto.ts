// Interpreta o texto colado (mensagem do cliente, e-mail, lista) para o comunicado de tratamento: tomador
// (pelo CNPJ ou pelo nome no Cadastro de terceiros), data, horário, itens e quantidades, aviso e unidade
// volante. O que não vier no texto fica como no modelo da empresa (último comunicado), e o operador confere.
import type { CampoComunicado } from "./comunicadoModelo";
import type { Tomador } from "./relatorio";
import { snMinusculo, soDigitos } from "./util";

export interface Interpretado {
  valores: Partial<Record<CampoComunicado, string>>;
  /** Campos achados no texto (os outros ficam como no modelo). */
  achados: CampoComunicado[];
  avisos: string[];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtCnpj = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/** Itens de madeira que aparecem no texto, com a forma que vai no "Produto a ser tratado". */
const ITENS: { re: RegExp; produto: string; plural: string }[] = [
  { re: /kits?\s+(?:de\s+)?caixas?/i, produto: "Kit caixas", plural: "kit caixas" },
  { re: /kits?\s+(?:de\s+)?embalage\w*/i, produto: "Kit embalagens", plural: "kit embalagens" },
  { re: /kits?/i, produto: "Kit caixas", plural: "kits" },
  { re: /pal+et+e?s?|pal+ets?/i, produto: "Paletes", plural: "paletes" },
  { re: /caixas?|engradados?/i, produto: "Caixas", plural: "caixas" },
  { re: /skids?|suportes?/i, produto: "Suportes", plural: "suportes" },
  { re: /t[áa]buas?|ripas?|sarrafos?/i, produto: "Tábuas", plural: "tábuas" },
  { re: /tampas?/i, produto: "Tampas", plural: "tampas" },
  { re: /cavaletes?/i, produto: "Cavaletes", plural: "cavaletes" },
  { re: /bobinas?|carret[ée]is/i, produto: "Bobinas", plural: "bobinas" },
];

/** "50 kit caixas (1000x1200x680mm)", "300 paletes 1000x1200", "8 PALETES" -> itens com quantidade e medida. */
function itensDoTexto(texto: string): { qtd: string; item: (typeof ITENS)[number]; medida: string }[] {
  const out: { qtd: string; item: (typeof ITENS)[number]; medida: string }[] = [];
  const nomes = ITENS.map((i) => i.re.source).join("|");
  const re = new RegExp(`(\\d[\\d.]*)\\s*(?:un(?:idades?|d\\.?)?\\s*(?:de\\s+)?)?(${nomes})(?:\\s+de\\s+madeira)?\\s*(\\(?\\s*\\d{2,4}\\s*[xX×]\\s*\\d{2,4}(?:\\s*[xX×]\\s*\\d{2,4})?\\s*(?:mm|cm)?\\s*\\)?)?`, "gi");
  for (const m of texto.matchAll(re)) {
    const item = ITENS.find((i) => new RegExp(`^(?:${i.re.source})$`, "i").test(m[2].trim())) ?? ITENS.find((i) => i.re.test(m[2]))!;
    const medida = (m[3] ?? "").replace(/[()\s]/g, "").replace(/×/g, "x").toLowerCase();
    out.push({ qtd: m[1].replace(/\./g, ""), item, medida: medida && !/mm|cm$/.test(medida) ? `${medida}mm` : medida });
  }
  return out;
}

/** Data do texto: "27/10", "27/10/2026", "27.10.26", "hoje", "amanhã". */
function dataDoTexto(t: string, hoje: Date): string | null {
  const m = t.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m) {
    const ano = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : hoje.getFullYear();
    if (+m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) return `${pad2(+m[1])}/${pad2(+m[2])}/${ano}`;
  }
  const rel = semAcento(t).toLowerCase();
  const d = new Date(hoje);
  if (/\bamanha\b/.test(rel)) d.setDate(d.getDate() + 1);
  else if (!/\bhoje\b/.test(rel)) return null;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Horário: "13:30", "13h30", "13h", "às 8 horas" -> "13h30m". */
function horaDoTexto(t: string): string | null {
  const m = t.match(/\b(\d{1,2})\s*(?::|h(?:oras?)?|hs)\s*(\d{2})?\s*(?:m(?:in)?)?\b/i);
  if (!m || +m[1] > 23) return null;
  return `${pad2(+m[1])}h${m[2] ?? "00"}m`;
}

/**
 * Tabela (planilha ou Word: células com " | "): pela linha de títulos (quantidade/qtd, produto/material/
 * descrição, medida), cada linha vira uma frase como a da mensagem ("300 Paletes 1000x1200 | 27/10/2026").
 */
function tabelaEmFrases(texto: string): { texto: string; itensTabela: string[] } {
  const linhas = texto.split("\n");
  const itensTabela: string[] = [];
  const iCab = linhas.findIndex((l) => l.includes("|") && /quant|qtd|qtde/i.test(l) && /produto|material|mercadoria|descri|item|embalage/i.test(l));
  if (iCab < 0) return { texto, itensTabela };
  const cab = linhas[iCab].split("|").map((c) => semAcento(c).toLowerCase().trim());
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
  const cQtd = col(/quant|qtd|qtde/);
  const cProd = col(/produto|material|mercadoria|descri|item|embalage/);
  const cMed = col(/medida|dimens|tamanho|bitola/);
  const frases: string[] = [];
  for (const l of linhas.slice(iCab + 1)) {
    if (!l.includes("|")) continue;
    const c = l.split("|").map((x) => x.trim());
    const qtd = c[cQtd]?.match(/\d[\d.,]*/)?.[0];
    if (!qtd || !c[cProd]) continue;
    const item = `${qtd.replace(/[.,]0+$/, "")} ${c[cProd]}${cMed >= 0 && c[cMed] ? ` ${c[cMed]}` : ""}`;
    itensTabela.push(item);
    frases.push(`${item} | ${c.filter((_, i) => i !== cQtd && i !== cProd && i !== cMed).join(" | ")}`);
  }
  return { texto: [...linhas.slice(0, iCab), ...frases].join("\n"), itensTabela };
}

export function interpretarTexto(
  texto: string,
  op: { tomadores: Tomador[]; prestadora: boolean; hoje?: Date; modelo: Partial<Record<CampoComunicado, string>> }
): Interpretado {
  const tab = tabelaEmFrases(texto.replace(/\r/g, ""));
  const t = tab.texto;
  const plano = t.replace(/\s+/g, " ");
  const v: Partial<Record<CampoComunicado, string>> = {};
  const achados: CampoComunicado[] = [];
  const avisos: string[] = [];
  const marcar = (c: CampoComunicado, valor: string | null | undefined) => {
    if (!valor) return;
    v[c] = valor;
    achados.push(c);
  };

  // Tomador: pelo CNPJ do texto; senão pelo nome de um terceiro cadastrado que apareça no texto.
  const cnpjs = [...plano.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\s*\/?\s*\d{4}\s*-?\s*\d{2}\b/g)].map((m) => soDigitos(m[0]));
  const chave = (s: string) => semAcento(s).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const planoChave = ` ${chave(plano)} `;
  const porCnpj = op.tomadores.find((x) => cnpjs.includes(soDigitos(x.cnpj)));
  const porNome = porCnpj
    ? null
    : op.tomadores
        .map((x) => ({ x, nome: chave(x.razao).replace(/\b(LTDA|ME|EIRELI|S A|SA|EPP|IND|COM|E|DE|DO|DA)\b/g, " ").replace(/\s+/g, " ").trim() }))
        .filter(({ nome }) => nome.length >= 4 && planoChave.includes(` ${nome.split(" ").slice(0, 2).join(" ")} `))
        .sort((a, b) => b.nome.length - a.nome.length)[0]?.x;
  const tom = porCnpj ?? porNome ?? null;
  if (tom) {
    marcar("tomador", `${tom.razao} - CNPJ ${tom.cnpj}`);
    // Prestadora (trata no cliente): o local é o do cliente.
    if (op.prestadora && tom.endereco) marcar("local", snMinusculo(tom.endereco));
  } else if (cnpjs.length) {
    const nome = t.split("\n").find((l) => /\b(ltda|s\/?a|eireli|me|epp)\b/i.test(l))?.replace(/cnpj.*$/i, "").replace(/[-–:;,]+\s*$/, "").trim();
    marcar("tomador", `${nome || "?"} - CNPJ ${fmtCnpj(cnpjs[0])}`);
    avisos.push("O tomador do CNPJ do texto não está no Cadastro de terceiros: confira o nome e cadastre-o para os próximos.");
  }

  // Local explícito ("local: …", "endereço: …").
  const local = t.match(/(?:local(?: do tratamento)?|endere[çc]o)\s*:\s*(.+)/i)?.[1]?.trim();
  if (local) marcar("local", snMinusculo(local));

  marcar("data", dataDoTexto(plano, op.hoje ?? new Date()));
  marcar("horario", horaDoTexto(plano.replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, " ")));

  // Itens: quantidade ("50 kit caixas (1000x1200x680mm); 8 paletes (1300x1300mm)") e produto.
  const itens = itensDoTexto(plano);
  if (itens.length) {
    const um = itens.length === 1;
    marcar(
      "quantidade",
      itens.map((i) => `${i.qtd}${um && !i.medida ? "" : ` ${i.item.plural}`}${i.medida ? ` (${i.medida})` : ""}`).join("; ")
    );
    // "Kit caixas e palete de madeira", "Paletes de madeira".
    const nomes = [...new Set(itens.map((i) => i.item.produto))];
    const produto =
      nomes.length === 1
        ? `${nomes[0]} de madeira`
        : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1].toLowerCase().replace(/s$/, "")} de madeira`;
    marcar("produto", produto);
  } else if (tab.itensTabela.length) {
    // Tabela com um item que não é palete/caixa/kit…: vai como veio ("300 PBR").
    marcar("quantidade", tab.itensTabela.join("; "));
  }

  // Aviso da Mann/Exata ("aviso 1764/2026", "AV 1764") e unidade volante ("unidade 3").
  // Sufixo só em maiúsculas e colado ("-AH", "-AMH", "-C"): "1770/2026 - Gelprime" não é sufixo.
  const av = plano.match(/\baviso\s*(?:n[º°o.]*\s*)?(\d{1,5}\s*\/\s*\d{4})/i);
  const sufixo = av ? plano.slice(av.index! + av[0].length).match(/^-(A[CHMQU]{0,3}|C)\b/)?.[1] : null;
  marcar("aviso", av ? `${av[1].replace(/\s+/g, "")}${sufixo ? `-${sufixo}` : ""}` : null);
  const unidade = plano.match(/\bunidade\s*(?:volante\s*)?(?:n[º°o.]*\s*)?(\d{1,2})\b/i)?.[1];
  if (unidade) marcar("unidade", `Unidade ${+unidade}`);

  // Duração e temperatura, se o texto disser.
  const dur = plano.match(/\b(\d{2,3})\s*min(?:utos)?\b/i)?.[1];
  if (dur) marcar("duracao", `${dur} min`);
  const temp = plano.match(/\b(\d{2})\s*°?\s*C\b/)?.[1];
  if (temp) marcar("temperatura", `${temp}°C`);
  const destino = t.match(/destino\s*:\s*(.+)/i)?.[1]?.trim();
  if (destino) marcar("destino", destino);

  if (!achados.includes("tomador") && op.prestadora) avisos.push("Não achei o tomador no texto: escolha o cliente ou digite o CNPJ.");
  if (!achados.includes("data")) avisos.push("Não achei a data do tratamento no texto: confira.");
  if (!achados.includes("horario")) avisos.push("Não achei o horário do início no texto: confira.");
  if (!achados.includes("quantidade")) avisos.push("Não achei a quantidade/itens no texto: confira.");
  return { valores: { ...op.modelo, ...v }, achados, avisos };
}
