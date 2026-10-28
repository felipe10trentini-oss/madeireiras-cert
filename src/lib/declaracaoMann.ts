// Declaração no modelo padrão (todas as empresas menos a LG): sai da nota fiscal (ou do BL/booking da
// exportação), que traz o nº do ciclo ("CICLO MANN 0249"), e do certificado mestre desse ciclo (mês,
// temperatura, duração e local do tratamento). Mann Unidade Volante: a nota é a do cliente (o emitente é
// o exportador); empresa que vende o palete (Paletes Maringá -> Avenorte): a nota é dela, e o exportador
// é o destinatário da nota.
import type { CertificadoMestre } from "./certificadoMestre";
import { dadosIniciais, linhaDoMestre, type DadosDeclaracao, type LinhaTratamento } from "./declaracao";
import { linhaDaDr, type DrHt } from "./drHt";
import type { DeclaracaoMontada } from "./declaracaoLg";
import type { Madeireira } from "./madeireiras";
import { ciclosDoTexto, type NotaFiscal } from "./notaFiscal";
import { regraDe } from "./certificado";
import { escolherLinha, estufaCiclo, linhaDoRelatorio, linhasDoCiclo, type LinhaRelatorio } from "./relatorioMapa";
import { clientesDoPedido, lerDocumentoExportacao, lerPedido } from "./documentoExportacao";
import { completarComNihil } from "./preencherModelo";
import { snMinusculo, soDigitos } from "./util";

export const CNPJ_MANN_VOLANTE = "00093600000141";

export interface MestreLido {
  mestre: CertificadoMestre;
  texto: string;
}

export interface DocumentoExportacao {
  nome: string;
  texto: string;
}

/** O que dá para tirar de um BL ou booking (texto livre de cada armador; o operador confere). */
export interface DadosBL {
  bl: string | null;
  booking: string | null;
  navio: string | null;
  destino: string | null;
  container: string | null;
  destinatario: string | null;
  exportador: string | null;
  ciclos: string[];
  // Da tabela do cliente (print do e-mail/planilha: "Booking | Destino | Cliente | Invoice | Gross Weight…").
  importador?: string | null;
  invoice?: string | null;
  pesoBruto?: string | null;
  pesoLiquido?: string | null;
  /** Total de volumes ("Total Packages": 40). */
  pacotes?: string | null;
  /** "Tratamento de Embalagem (skids)": o que foi tratado. */
  tipo?: string | null;
  /** Nº da NF-e escrito no pedido ("NFE 7399"), quando a nota não vem junto. */
  nfe?: string | null;
  /** Quantidade de cada ciclo na remessa (pedido "90 - Pallet Ciclo Mann 0252"): ciclo -> "90 paletes". */
  quantidades?: Record<string, string>;
}

/** Tabela com cabeçalho (células com " | "): o valor de cada título na linha de baixo. */
function daTabela(texto: string): Partial<DadosBL> | null {
  const linhas = texto.split("\n").filter((l) => l.includes("|"));
  if (linhas.length < 2) return null;
  const cab = linhas[0].split("|").map((c) => c.trim().toLowerCase());
  const val = linhas[1].split("|").map((c) => c.trim());
  const de = (re: RegExp) => {
    const i = cab.findIndex((c) => re.test(c));
    return i >= 0 && val[i] ? val[i] : null;
  };
  const r: Partial<DadosBL> = {
    booking: de(/booking/),
    bl: de(/^b\/?l\b|bill of lading/),
    navio: de(/vessel|navio/),
    destino: de(/destin|discharge|\bpod\b/),
    container: de(/container|cont[êe]iner/),
    destinatario: de(/consignee|destinat/),
    importador: de(/cliente|importer|importador|buyer|notify/),
    exportador: de(/exportador|exporter|shipper/),
    // O OCR às vezes separa os pontos: "325247 .26.3" -> "325247.26.3".
    invoice: de(/invoice|fatura/)?.replace(/\s*\.\s*/g, ".") ?? null,
    pesoBruto: de(/gross|bruto/),
    pesoLiquido: de(/net\s*weight|l[íi]quido/),
    // "Total Packages" em duas linhas: o OCR às vezes só pega o "Total".
    pacotes: de(/packages|volumes|pacotes|qtd.*volumes/) ?? de(/^total\b(?!.*(weight|peso|gross|net|bruto|l[íi]quido|valor|amount|value))/),
    tipo: de(/tipo|certif|descri|produto|material/),
  };
  return Object.values(r).some(Boolean) ? r : null;
}

const linhaApos = (t: string, re: RegExp) => {
  const m = t.match(re);
  if (!m) return null;
  const resto = t.slice(m.index! + m[0].length).replace(/^[\s:.#-]+/, "");
  const v = resto.split("\n")[0].trim();
  return v.length >= 2 && v.length <= 120 ? v : null;
};

export function lerBL(texto: string): DadosBL {
  const t = texto.replace(/[ \t]+/g, " ");
  const plano = t.replace(/\s+/g, " ");
  const tab = daTabela(t);
  if (tab) {
    return {
      bl: tab.bl ?? null,
      booking: tab.booking ?? null,
      navio: tab.navio ?? null,
      destino: tab.destino ?? null,
      container: tab.container ?? null,
      destinatario: tab.destinatario ?? null,
      exportador: tab.exportador ?? null,
      ciclos: ciclosDoTexto(plano),
      importador: tab.importador ?? null,
      invoice: tab.invoice ?? null,
      pesoBruto: tab.pesoBruto ?? null,
      pesoLiquido: tab.pesoLiquido ?? null,
      pacotes: tab.pacotes ?? null,
      tipo: tab.tipo ?? null,
    };
  }
  const doc = lerDocumentoExportacao(texto);
  const rotulos = lerBLPorRotulo(t, plano);
  return {
    ...rotulos,
    bl: doc.bl ?? rotulos.bl,
    booking: doc.booking ?? rotulos.booking,
    navio: doc.navio ?? rotulos.navio,
    destino: doc.destino ?? rotulos.destino,
    destinatario: doc.destinatario ?? rotulos.destinatario,
    exportador: doc.exportador ?? rotulos.exportador,
    invoice: doc.invoice,
    importador: doc.importador,
    pacotes: doc.pacotes,
    tipo: doc.tipo,
  };
}

/** Leitura antiga, pelos rótulos "Booking:", "Vessel:"… (BL com o valor logo depois do rótulo). */
function lerBLPorRotulo(t: string, plano: string): DadosBL {
  return {
    bl: plano.match(/\b(?:B\/L|BILL OF LADING)\s*(?:N[ºo°.]*|NO\.?|NUMBER|#)?\s*:?\s*([A-Z]{2,6}[A-Z0-9-]{5,20})/i)?.[1] ?? null,
    booking: plano.match(/\bBOOKING\s*(?:N[ºo°.]*|NO\.?|NUMBER|REF\.?|#)?\s*:?\s*([A-Z0-9-]{6,20})/i)?.[1] ?? null,
    navio: linhaApos(t, /\b(?:OCEAN\s+)?VESSEL(?:\s*(?:\/|&)\s*VOYAGE(?:\s*NO\.?)?)?|\bNAVIO\b/i),
    destino: linhaApos(t, /\bPORT\s+OF\s+DISCHARGE|\bPLACE\s+OF\s+DELIVERY|\bPORTO\s+DE\s+DESCARGA|\bDESTINO\b/i),
    container: [...new Set(plano.match(/\b[A-Z]{4}\s?-?\d{6}-?\d\b/g) ?? [])].slice(0, 6).join(" / ") || null,
    destinatario: linhaApos(t, /\bCONSIGNEE\b/i),
    exportador: linhaApos(t, /\bSHIPPER\b|\bEXPORTER\b/i),
    ciclos: ciclosDoTexto(plano),
  };
}

const MINUSCULAS = new Set(["e", "de", "da", "do", "das", "dos", "em", "para", "com"]);
/** "RENASCER PALLET E EMBALAGEM DE MADEIRA LTDA" -> "Renascer Pallet e Embalagem de Madeira Ltda" (como na declaração). */
export function titulo(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : /^s\/a$/.test(p) ? "S/A" : /^s\.?a\.?$/.test(p) ? "S.A." : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/** Razão social do tomador no certificado mestre (2.1), que é o exportador da declaração. */
function tomadorDoMestre(texto: string): string | null {
  return (
    texto
      .replace(/\s+/g, " ")
      .match(/2\.1\.\s*Raz[ãa]o Social:\s*(.+?)\s+2\.2/i)?.[1]
      ?.trim() ?? null
  );
}

// "0249" -> "249"; código da curva ("UR010972PR031026") fica como está.
const semZeros = (c: string | null | undefined) => (!c ? "" : /^\d+$/.test(c.trim()) ? String(parseInt(c, 10)) : c.trim().toUpperCase());
/** 1ª palavra da razão social, para comparar ("PALETES MARINGA PBR LTDA" ~ "Paletes Maringá Pbr Ltda"). */
const primeira = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/\s+/)[0];

/**
 * Volumes pela tabela do cliente: "40" pacotes + "Tratamento de Embalagem (skids)" -> "40 Suportes de madeira/
 * Wooden skids" (a nota pode ser da madeira serrada, e a declaração é da embalagem).
 */
function volumesDaTabela(bl: DadosBL | null): string | null {
  const n = bl?.pacotes?.match(/\d[\d.]*/)?.[0];
  if (!n) return null;
  const t = bl?.tipo ?? "";
  if (/skid|suporte/i.test(t)) return `${n} Suportes de madeira/ Wooden skids`;
  if (/palet|pallet/i.test(t)) return `${n} Paletes de madeira/ Wooden pallets`;
  if (/caixa|crate/i.test(t)) return `${n} Caixas de madeira/ Wooden crates`;
  return null;
}

/** "100 paletes de madeira/ wooden pallets" a partir dos itens da nota. */
function volumesDaNota(nf: NotaFiscal): string {
  return nf.itens
    .map((i) => {
      const q = i.quantidade.toLocaleString("pt-BR");
      if (/palet|pallet/i.test(i.descricao)) return `${q} paletes de madeira/ wooden pallets`;
      if (/suporte|skid/i.test(i.descricao)) return `${q} suportes de madeira/ wooden skids`;
      if (/caixa|crate|engradado/i.test(i.descricao)) return `${q} caixas de madeira/ wooden crates`;
      return `${q} ${i.descricao}`;
    })
    .join("\n");
}

/**
 * Clientes que sempre vão como importador de um mesmo exportador: o pedido diz só "Para Instituto Botânico
 * La Selva", e a declaração da MD Paletes sai com a Barão de exportador e o Instituto de importador.
 */
const PARES_CLIENTE: { empresa: string; cliente: RegExp; exportador: string }[] = [
  { empresa: "04456108000144", cliente: /instituto\s+bot[âa]nico/i, exportador: "Barão - Indústria e Comércio de Erva Mate e Chás S.A." },
];

/** "90 x 252" / "90 x 508 Rio Claro" no campo "Ciclos": a quantidade da remessa nesse ciclo. */
export function quantidadeDigitada(c: string): { quantidade: string; ciclo: string } | null {
  const m = c.trim().match(/^(\d[\d.]*)\s*[x×]\s*(\d.*)$/i);
  return m ? { quantidade: m[1], ciclo: m[2].trim() } : null;
}

/** De onde vêm as linhas do tratamento além dos mestres: o relatório do MAPA e os ciclos digitados. */
export interface OpcoesDeclaracao {
  relatorio?: LinhaRelatorio[] | null;
  /** Ciclos/lotes digitados (quando a nota não traz): valem no lugar dos da nota. */
  ciclos?: string[];
  /** Linha do relatório escolhida na tela para cada ciclo (o ciclo se repete entre as unidades): ciclo -> nº do certificado. */
  escolhas?: Record<string, string>;
  /** NF-e digitada ao lado dos ciclos (o documento não traz, ou traz outra): vale no lugar da lida. */
  nfe?: string;
  /** DR em Excel da empresa (Pinustan): o tratamento sai das abas CONSOLIDADOS HT / DADOS HT. */
  dr?: DrHt | null;
  /** Campos que o Word da empresa tem: o que o documento base não trouxe vai "Nihil". */
  campos?: Set<string> | null;
}

/**
 * Monta a declaração de uma remessa: nota fiscal (ou BL/booking/packing list) + o tratamento de cada
 * ciclo escrito nela, tirado do certificado mestre (se veio) ou do relatório do MAPA da empresa.
 */
export function montarDeclaracaoPadrao(
  nf: NotaFiscal | null,
  bls: DadosBL[],
  mestres: MestreLido[],
  empresa: Madeireira | null,
  hoje: string,
  op: OpcoesDeclaracao = {}
): DeclaracaoMontada {
  const avisos: string[] = [];
  const bl = bls[0] ?? null;
  const rel = op.relatorio ?? null;
  // Quantidade de cada ciclo na remessa: a do pedido, ou digitada no campo "Ciclos" ("90 x 252").
  const qtd = new Map<string, string>();
  for (const b of bls) for (const [c, v] of Object.entries(b.quantidades ?? {})) qtd.set(semZeros(c), v);
  const unidade = [...qtd.values()][0]?.replace(/^[\d.]+\s*/, "") || "paletes";
  const digitados = (op.ciclos ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const q = quantidadeDigitada(c);
      if (q) qtd.set(semZeros(q.ciclo.split(/\s+/)[0]), `${q.quantidade} ${unidade}`);
      return q?.ciclo ?? c;
    });
  const ciclosDoc = digitados.length ? [...new Set(digitados)] : [...new Set([...(nf?.ciclos ?? []), ...bls.flatMap((b) => b.ciclos)])];

  // A nota é da própria empresa (venda do palete)? Então o exportador é quem comprou. Print de um pedaço
  // da nota sem o emitente (só o quadro do destinatário, TLP): também é o destinatário.
  const semEmitente = !!nf && !nf.emitente?.razao && !nf.emitente?.cnpj && !!nf.destinatario.razao;
  const notaPropria =
    semEmitente ||
    (!!nf &&
      !!empresa &&
      ((!!nf.emitente?.cnpj && soDigitos(nf.emitente.cnpj) === soDigitos(empresa.cnpj)) ||
        (!!nf.emitente?.razao && primeira(nf.emitente.razao) === primeira(empresa.razaoSocial))));
  const exportadorDoc = (notaPropria ? titulo(nf?.destinatario.razao) : titulo(nf?.emitente?.razao)) || titulo(bl?.exportador);
  const cnpjTomador = (notaPropria ? nf?.destinatario.cnpj : nf?.emitente?.cnpj) ?? null;

  // Cada ciclo: o mestre dele (se veio) ou a linha do relatório (a do tomador da remessa, se o ciclo se repete).
  const numDo = (c: string) => semZeros(c.trim().split(/\s+/)[0]);
  const doMestre = (c: string) => mestres.find((m) => semZeros(m.mestre.ciclo) === numDo(c) || semZeros(m.mestre.lote) === numDo(c));
  const usados: MestreLido[] = [];
  const doRelatorio: LinhaRelatorio[] = [];
  const cicloDe = new Map<MestreLido | LinhaRelatorio, string>();
  // DR em Excel (Pinustan): o tratamento vem dela — a aba CONSOLIDADOS HT, ou o lote digitado na DADOS HT.
  const dosDr: LinhaTratamento[] = [];
  // Sem lote digitado, valem sempre as linhas da CONSOLIDADOS HT (mesmo que a nota traga ciclo).
  const usarConsolidado = !!op.dr?.consolidado.length && !digitados.length;
  if (usarConsolidado) dosDr.push(...op.dr!.consolidado);
  if (ciclosDoc.length && !usarConsolidado) {
    for (const c of ciclosDoc) {
      const naDr = op.dr ? linhaDaDr(op.dr, c.trim().split(/\s+/)[0]) : null;
      if (naDr) {
        const q = qtd.get(numDo(c));
        dosDr.push(q ? { ...naDr, quantidade: q } : naDr);
        continue;
      }
      const m = doMestre(c);
      if (m) {
        usados.push(m);
        cicloDe.set(m, numDo(c));
        continue;
      }
      const cands = rel ? linhasDoCiclo(rel, c) : [];
      const escolhida = op.escolhas?.[c] ? cands.find((x) => x.certificado === op.escolhas![c]) : undefined;
      const l = escolhida ?? (rel ? escolherLinha(cands, { cnpj: cnpjTomador, nome: exportadorDoc }) : null);
      // Mais de uma estufa (a unidade de tratamento é um número): o ciclo vai com a estufa, "1-326".
      const estufas = [...new Set(cands.map((x) => (x.unidade ?? "").trim()))];
      if (l && cands.length > 1 && !escolhida && !estufaCiclo(c) && estufas.length > 1 && estufas.every((u) => /^\d{1,3}$/.test(u))) {
        avisos.push(`Ciclo ${numDo(c)}: está em ${estufas.length} estufas (${estufas.join(", ")}) — digite estufa-ciclo (ex.: “${l.unidade}-${numDo(c)}”) ou escolha na lista.`);
      } else if (l && cands.length > 1 && !escolhida && !/\s/.test(c.trim())) {
        avisos.push(`Ciclo ${numDo(c)}: há ${cands.length} tratamentos com esse nº no relatório (unidades diferentes) — confira o escolhido ou digite ciclo + cliente (ex.: “${numDo(c)} ${(l.tomador.split(/\s+/)[0] ?? "").toLowerCase()}”).`);
      }
      if (l) {
        doRelatorio.push(l);
        cicloDe.set(l, numDo(c));
      } else avisos.push(op.dr ? `Lote ${c}: não achei na DR (abas CONSOLIDADOS HT e DADOS HT).` : rel || mestres.length ? `Ciclo ${c}: não achei no relatório nem nos certificados mestres.` : `Ciclo ${c}: solte o relatório do MAPA da empresa (ou o certificado mestre).`);
    }
  } else if (!dosDr.length) {
    usados.push(...mestres);
    if (mestres.length) avisos.push(nf ? "A nota não traz o nº do ciclo: entraram os certificados mestres soltos junto — confira se são os desta remessa." : "O BL/booking não traz o nº do ciclo: confira o certificado mestre.");
    else avisos.push("A nota/BL não traz o nº do ciclo: digite os ciclos (ou lotes) no campo “Ciclos” para puxar o tratamento do relatório.");
  }

  const base = dadosIniciais([], empresa, hoje);
  const m0 = usados[0];
  const exportadorLido = exportadorDoc || titulo(m0 ? tomadorDoMestre(m0.texto) : null) || titulo(doRelatorio[0]?.tomador);
  // Cliente que pede é o importador de um exportador fixo (MD: Instituto Botânico -> Barão).
  const par = PARES_CLIENTE.find((p) => !!empresa && soDigitos(empresa.cnpj) === p.empresa && [exportadorLido, bl?.importador].some((n) => !!n && p.cliente.test(n)));
  const exportador = par ? par.exportador : exportadorLido;
  const importadorPar = par ? (par.cliente.test(exportadorLido) ? exportadorLido : bl?.importador ?? "") : "";
  const destinatario = (notaPropria ? "" : titulo(nf?.destinatario.razao)) || bl?.destinatario || "";
  // Quantidade do ciclo ("200 paletes") vai na linha do certificado mestre (Paletes Maringá). Duração:
  // a 56 °C as declarações levam 32 minutos (a curva às vezes fecha 31); mais longas ficam como estão.
  // Com a quantidade de cada ciclo (pedido/digitada), ela vale no lugar da do ciclo inteiro.
  const daRemessa = (x: MestreLido | LinhaRelatorio) => qtd.get(cicloDe.get(x) ?? "");
  const linhas = [
    ...usados.map((m) => ({ ...linhaDoMestre(m.mestre), quantidade: daRemessa(m) ?? (m.mestre.quantidade || "") })),
    ...doRelatorio.map((l) => ({
      ...linhaDoRelatorio(l),
      // Digitado estufa-ciclo ("1-326"): a declaração mostra assim, como a Madeval escreve.
      ...(estufaCiclo(cicloDe.get(l) ?? "") ? { ciclo: cicloDe.get(l)! } : {}),
      ...(daRemessa(l) ? { quantidade: daRemessa(l) } : {}),
    })),
    // Da DR: ciclo (UR…), lote, início/final com hora; a coluna do certificado às vezes repete o lote.
    ...dosDr.map((l) => ({ ...l, certificado: /^\d{1,4}\/\d{4}$/.test(l.certificado) ? l.certificado : "" })),
  ].map((l) => {
    const min = parseInt(l.duracao, 10);
    const t = parseFloat(l.temperatura.replace(",", "."));
    return { ...l, duracao: t <= 56 && min > 0 && min < 32 ? "32 min" : l.duracao };
  });
  const certs = [...new Set(linhas.map((l) => l.certificado).filter(Boolean))];
  if (!exportador) avisos.push("Não achei o exportador (emitente da nota / shipper do BL): preencha.");

  // Local do tratamento: o do mestre; só com o relatório (que traz só a cidade), o da empresa — ou, na
  // prestadora (Mann móvel), o do cliente cadastrado em Cadastro de terceiros.
  const prestadora = !!empresa && !!regraDe(empresa).prestadora;
  const tomadores = (empresa as { relatorio?: { tomadores?: Record<string, { endereco?: string }> } } | null)?.relatorio?.tomadores ?? {};
  const locais = [
    ...usados.map((m) => m.mestre.enderecoTrat),
    ...doRelatorio.map((l) => (prestadora ? tomadores[l.tomadorCnpj]?.endereco || l.local : empresa?.endereco || l.local)),
    ...(dosDr.length ? [empresa?.endereco] : []),
  ].filter((x): x is string => !!x);
  if (doRelatorio.length && prestadora && doRelatorio.some((l) => !tomadores[l.tomadorCnpj]?.endereco)) {
    avisos.push("Local do tratamento: o relatório só traz a cidade e o cliente não está no Cadastro de terceiros — confira o endereço.");
  }

  const dados: DadosDeclaracao = {
    ...base,
    exportador,
    enderecoExportador: "",
    destinatario,
    nfe: op.nfe?.trim() || nf?.numero || bl?.nfe || "",
    navio: bl?.navio ?? "",
    bl: bl?.bl ?? "",
    booking: bl?.booking ?? "",
    container: bl?.container ?? "",
    destino: bl?.destino ?? "",
    // Da tabela vem em maiúsculas; do packing list já vem com as siglas certas ("Grivalmar USA LLC").
    importador: importadorPar || (bl?.importador && bl.importador !== bl.importador.toUpperCase() ? bl.importador : titulo(bl?.importador)) || base.importador,
    fatura: bl?.invoice ?? base.fatura,
    pesoBruto: bl?.pesoBruto ? `${bl.pesoBruto} Kgs` : base.pesoBruto,
    pesoLiquido: bl?.pesoLiquido ? `${bl.pesoLiquido} Kgs` : base.pesoLiquido,
    volumes: volumesDaTabela(bl) ?? (nf ? volumesDaNota(nf) : ""),
    produto: "",
    origem: "",
    comunicado: "",
    localTratamento: snMinusculo([...new Set(locais)].join("; ")).replace(/\s*-\s*[A-Z]{2}\s*$/, ""),
    sujeito: /skid|suporte/i.test(bl?.tipo ?? "") ? "suportes" : /palet|pallet/i.test(bl?.tipo ?? "") ? "paletes" : nf?.itens.every((i) => /palet|pallet/i.test(i.descricao)) ? "paletes" : nf?.itens.every((i) => /suporte|skid/i.test(i.descricao)) ? "suportes" : "material",
    linhas,
    qtdPorCiclo: linhas.length > 1 && linhas.some((l) => l.quantidade) && [...cicloDe.values()].some((c) => qtd.has(c)),
    // Mann Unidade Volante emite em Curitiba; as outras, na cidade delas (cadastro).
    localEmissao: empresa && soDigitos(empresa.cnpj) === CNPJ_MANN_VOLANTE ? "Curitiba - PR" : base.localEmissao,
  };
  // Sem nota/BL com a quantidade: a soma das quantidades de cada ciclo ("90 x 252, 200 x 226" -> 290 paletes).
  if (!dados.volumes.trim() && dados.qtdPorCiclo) {
    const total = linhas.reduce((s, l) => s + (parseInt((l.quantidade ?? "").replace(/\./g, ""), 10) || 0), 0);
    if (total) dados.volumes = volumesDaTabela({ pacotes: String(total), tipo: unidade } as DadosBL) ?? `${total} ${unidade}`;
  }
  if (!dados.volumes.trim()) avisos.push("Não achei a quantidade de material na nota/BL: preencha em “Editar campos” (Cubagem/Volume).");
  if (!certs.length && mestres.length && ciclosDoc.length && !doRelatorio.length) avisos.push("Os certificados mestres soltos não são do ciclo da nota: confira.");
  // Nome no padrão das pastas: Mann "Declaração HT - Renascer NFe 7376 - Novozymes" / "Declaração HT - Marine
  // ONEYSAOG54885400"; as outras "DECL. KTR NFe 11336".
  // Nome curto como nas pastas: "Madeireira Rio Claro Ltda" -> "Rio Claro", "Vbs Madeiras Ltda" -> "VBS",
  // "Affonso Ditzel Cia Ltda" -> "Affonso Ditzel", "Renascer Pallet e Embalagem…" -> "Renascer".
  const GENERICO = /^(madeireira|madeiras?|ind(?:ustria|\.)?|com(?:ercio|\.)?|serraria|cia|ltda|ltd|s\/?a\.?|s\.a\.|eireli|me|epp|e|de|do|da|&|pallets?|paletes?|embalage\w*|artefatos|exp(?:ortacao|\.)?)$/i;
  const curto = (s: string) => {
    const ps = s.split(/\s+/).filter(Boolean);
    while (ps.length > 1 && /^(madeireira|ind(?:ustria|\.)?|serraria)$/i.test(ps[0])) ps.shift();
    const fim = ps.findIndex((p, i) => i > 0 && GENERICO.test(p));
    const nome = (fim < 0 ? ps : ps.slice(0, fim)).slice(0, 3);
    // Sigla sozinha ("Vbs" -> "VBS"); em nome de duas palavras fica como está ("Rio Claro").
    return nome.length === 1 && nome[0].length <= 3 && /^[a-z]+$/i.test(nome[0]) ? nome[0].toUpperCase() : nome.join(" ");
  };
  const mann = !!empresa && soDigitos(empresa.cnpj) === CNPJ_MANN_VOLANTE;
  // Referência: a nota; senão a fatura/invoice, o booking, o B/L; pedido sem documento: empresa do ciclo + ciclo ("Madex 964").
  const cicloRef = doRelatorio[0]?.ciclo ?? usados[0]?.mestre.ciclo ?? dosDr[0]?.lote ?? "";
  const numNf = op.nfe?.trim() || nf?.numero || bl?.nfe;
  const semDoc = !numNf && !bl?.invoice && !bl?.booking && !bl?.bl;
  const nome = semDoc && cicloRef && doRelatorio[0]?.tomador ? curto(titulo(doRelatorio[0].tomador)) : curto(exportador);
  const ref = numNf
    ? `NFe ${numNf}${mann && destinatario ? ` - ${curto(destinatario)}` : ""}`
    : bl?.invoice || (bl?.booking ? (mann ? `- ${bl.booking}` : bl.booking) : "") || bl?.bl || (cicloRef ? semZeros(cicloRef) : certs[0]) || "";
  const arquivo = `${mann ? "Declaração HT -" : "DECL."} ${nome || "Cliente"} ${ref}`.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() + ".docx";
  return { dados: completarComNihil(dados, op.campos as Parameters<typeof completarComNihil>[1]), avisos, arquivo };
}

/** Nome antigo (só a Mann Unidade Volante usava). */
export const montarDeclaracaoMann = montarDeclaracaoPadrao;

/**
 * Documento "outro" (BL, booking, packing list, pedido do cliente) em uma ou mais remessas: pedido com
 * vários clientes do mesmo ciclo ("CICLO 964 para: NORTOX S/A - 30 PALETES / CAFÉ TRÊS CORAÇÕES - 250
 * PALETES") vira uma declaração por cliente.
 */
export function blsDoTexto(texto: string): DadosBL[] {
  const base = lerBL(texto);
  // Pedido por e-mail com a quantidade de cada ciclo ("NFE 7399 / 90 - Pallet Ciclo Mann 0252 / 200 - … 0226"):
  // uma declaração com os ciclos todos.
  const ped = lerPedido(texto);
  if (ped) {
    const q = ped.itens.map((i) => ({ ...i, n: parseInt(i.quantidade.replace(/\./g, ""), 10) }));
    const mesmoTipo = q.length > 0 && q.every((i) => i.item === q[0].item);
    Object.assign(base, {
      exportador: base.exportador ?? ped.cliente,
      invoice: base.invoice ?? ped.fatura,
      nfe: ped.nfe,
      ciclos: [...new Set([...base.ciclos, ...q.map((i) => i.ciclo)])],
      quantidades: Object.fromEntries(q.map((i) => [i.ciclo, `${i.quantidade} ${i.n === 1 ? i.item.replace(/s$/, "") : i.item}`])),
      ...(mesmoTipo && !base.pacotes ? { pacotes: String(q.reduce((s, i) => s + (i.n || 0), 0)), tipo: q[0].item } : {}),
    });
  }
  const clientes = clientesDoPedido(texto);
  if (!clientes.length) return [base];
  return clientes.map((c) => ({ ...base, exportador: c.exportador, pacotes: c.quantidade, tipo: c.item }));
}
