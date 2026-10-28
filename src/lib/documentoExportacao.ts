// BL, sea waybill, booking e packing list de exportação: cada armador tem um layout (rótulos numerados,
// valores longe dos rótulos, sem rótulo nenhum). A leitura não depende do layout:
//   - exportador: a empresa brasileira, logo acima (ou ao lado) do CNPJ;
//   - destinatário: depois do rótulo CONSIGNEE, ou a primeira empresa (linha em maiúsculas) depois do
//     endereço do exportador;
//   - navio, destino, invoice, booking e nº do BL pelos rótulos e pelos formatos conhecidos.

export interface DocumentoExportacaoLido {
  exportador: string | null;
  destinatario: string | null;
  navio: string | null;
  destino: string | null;
  invoice: string | null;
  booking: string | null;
  bl: string | null;
  /** Packing list: "BUYER / IMPORTER" e "Total Pallets 52". */
  importador?: string | null;
  pacotes?: string | null;
  tipo?: string | null;
}

const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const EMPRESA = /\b(LTDA|LTD|S\.?\/?A\.?|EIRELI|ME|EPP|SPA|SARL|SAS|S\.?R\.?L\.?|LLC|INC|GMBH|B\.?V\.?|CORP|CO\.?)\b/i;
// Linha de endereço/contato (não é nome de empresa).
const ENDERECO = /\d|@|\b(RUA|AV\.?|AVENIDA|RODOVIA|ESTRADA|CEP|FONE|PHONE|TEL|FAX|CONTACT|CONTATO|CNPJ|CUIT|EORI|BRASIL|BRAZIL|CX POSTAL|BAIRRO|STREET|BOULEVARD|BLVD|STRADA|ROAD|ZONE|Z\.I\.)\b/i;
const PORTOS_BR = /\b(PARANAGU[AÁ]|ITAJA[IÍ]|NAVEGANTES|SANTOS|ITAPO[AÁ]|RIO GRANDE|S[AÃ]O FRANCISCO|PECEM|SUAPE|SALVADOR|VIT[OÓ]RIA|IMBITUBA|MANAUS)\b/i;
const titulo = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(/.-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(Ltda|Llc|Spa|Ltd|Inc|Usa)\b/gi, (m) => (m.length <= 3 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()))
    .replace(/\bS\/a\b/gi, "S/A")
    .replace(/\bS\.a\./gi, "S.A.")
    .replace(/(?<=\s)(De|Da|Do|Das|Dos|E)(?=\s)/g, (m) => m.toLowerCase())
    .replace(/\(([a-z]{5})\)/gi, (_, c: string) => `(${c.toUpperCase()})`);

const ehRotulo = (l: string) => /\(\d{1,2}\)|COMPLETE NAME|REFERENCES|NOTIFY|PLACE OF|PORT OF|VESSEL|DOCUMENT NO|SHIPPER|CONSIGNEE|EXPORTER|RIDER PAGES|ENDORSEMENT/i.test(l);
// Rascunho do BL (draft da MSC): nº do BL e navio ainda em "XXXXXXXXXXXXXXXX".
const ehRascunho = (v: string | null | undefined) => !!v && /^X{4,}$/i.test(v.replace(/[\s./-]/g, ""));

/** Empresa a partir da linha i: junta a linha seguinte curta ("LLC") ao nome. */
function empresaEm(ls: string[], i: number): string {
  let nome = ls[i].split("\t").pop()!.trim();
  if (ls[i + 1] && /^[A-Z.&]{2,6}$/.test(ls[i + 1].trim())) nome = `${nome} ${ls[i + 1].trim()}`;
  return nome.replace(/[*,;]+$/, "").trim();
}

export function lerDocumentoExportacao(texto: string): DocumentoExportacaoLido {
  const ls = texto.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const plano = ls.join(" ");
  const proxValor = (i: number) => ls.slice(i + 1).find((l) => !ehRotulo(l) && l.length > 1) ?? null;
  // Rótulo com o valor na mesma linha ("Port of Discharge: GUAYAQUIL / ECUADOR"); "—" é vazio.
  const naLinha = (rotulo: RegExp) =>
    ls
      .map((l) => l.match(new RegExp(`^(?:${rotulo.source})\\s*:\\s*(.+)$`, "i"))?.[1].trim())
      .find((v) => v && !/^[—–-]+$/.test(v) && !/^\(/.test(v) && !ehRotulo(v) && !ehRascunho(v)) ?? null;
  // Rótulo sozinho na linha ("CONSIGNEE", "BUYER / IMPORTER") com a empresa na linha de baixo.
  const debaixo = (rotulo: RegExp) => {
    const i = ls.findIndex((l) => new RegExp(`^(?:${rotulo.source})\\s*:?$`, "i").test(l));
    const v = i >= 0 ? ls[i + 1] : null;
    return v && !ENDERECO.test(v) && !ehRotulo(v) ? empresaEm(ls, i + 1) : null;
  };

  // Exportador: o nome de empresa logo acima do (1º) CNPJ, ou na mesma linha depois de um tab.
  let exportador: string | null = null;
  let fimExportador = -1;
  const iCnpj = ls.findIndex((l) => CNPJ.test(l));
  if (iCnpj >= 0) {
    for (let k = iCnpj; k >= Math.max(0, iCnpj - 6); k--) {
      const cand = ls[k].split("\t").pop()!.replace(CNPJ, "").replace(/CNPJ:?/i, "").trim();
      if (cand && EMPRESA.test(cand) && !/\d{3}/.test(cand)) {
        exportador = cand.replace(/[*,;.]+$/, "").trim();
        break;
      }
    }
    fimExportador = iCnpj;
  }
  // Rótulo "SHIPPER" com o nome na linha de baixo.
  if (!exportador) {
    const i = ls.findIndex((l) => /^SHIPPER\b|SHIPPER\s*\/\s*EXPORTER/i.test(l));
    if (i >= 0) exportador = proxValor(i);
  }

  // Destinatário: a 1ª empresa depois do endereço do exportador; sem CNPJ, o que vem depois do rótulo CONSIGNEE.
  let destinatario: string | null = debaixo(/CONSIGNEE/);
  if (!destinatario && fimExportador >= 0) {
    for (let k = fimExportador + 1; k < Math.min(ls.length, fimExportador + 14); k++) {
      const l = ls[k].split("\t")[0].trim();
      if (ENDERECO.test(l) || ehRotulo(l) || l !== l.toUpperCase() || l.length < 6 || /^(SOLD TO|BUYER|DATA|DATE)$/i.test(l)) continue;
      if (/^[A-Z][A-Z0-9 .&'/-]+$/.test(l) && l !== (exportador ?? "").toUpperCase()) {
        destinatario = empresaEm(ls, k);
        break;
      }
    }
  }
  const iCons = ls.findIndex((l) => /\bCONSIGNEE\b/i.test(l));
  if (!destinatario && iCons >= 0) {
    const v = proxValor(iCons);
    if (v && !ENDERECO.test(v) && v === v.toUpperCase() && EMPRESA.test(v)) destinatario = empresaEm(ls, ls.indexOf(v, iCons));
  }

  // BL da RST International Logistics: as caixas saem fora de ordem no texto, mas sempre no mesmo lugar —
  // 1ª linha o booking, 2ª o nº do B/L, a linha "NAVIO | VIAGEM" ("BREMERHAVEN EXPRESS | NA643R") e, logo
  // abaixo do rótulo "VESSEL AND VOYAGE", o porto de descarga ("Bremerhaven / Alemanha").
  const rst = /RST INTERNATIONAL LOGISTICS/i.test(plano);
  const iVv = rst ? ls.findIndex((l) => /^VESSEL AND VOYAGE$/i.test(l.trim())) : -1;
  const rstDados = rst
    ? {
        booking: /^(?:\d{8,10}|(?:EBKG|SAOG|BKG)\d{8,10})$/.test(ls[0] ?? "") ? ls[0] : null,
        bl: /^[A-Z]{2,5}\d{2}[A-Z0-9]{3,12}$/.test(ls[1] ?? "") ? ls[1] : null,
        navio: ls.find((l) => /^[A-Z][A-Z0-9 .'-]{2,40}\s\|\s*[A-Z0-9]{3,8}$/.test(l)) ?? null,
        destino: iVv >= 0 && ls[iVv + 1] && !ehRotulo(ls[iVv + 1]) ? ls[iVv + 1] : null,
      }
    : null;

  // Navio: "Vessel MSC AMALFI Voyage 26N", rótulo VESSEL, ou linha de armador com viagem ("NYK DIANA V.025N").
  let navio: string | null =
    rstDados?.navio ??
    naLinha(/Vessel\s*(?:\/|&|and)\s*Voyage(?:\s*No\.?)?/) ??
    [...plano.matchAll(/\bVessel\s+(.+?)\s+Voyage\s+(\S+)/gi)]
      // "VESSEL AND VOYAGE PAPEETE…" é o rótulo seguido de outra caixa, não o navio.
      .filter((m) => !/^(and|&)$/i.test(m[1].trim()))
      .map((m) => `${m[1]} ${m[2]}`)
      .find((v) => !/[(&]|\bNO\.?$|\bNR\b|FLAG/i.test(v)) ?? null;
  // "MSC INSA - NA642R" (draft da MSC) e "MSC BASEL V | UA643R" (RST): navio - viagem.
  const ARMADOR = /^(MSC|NYK|MAERSK|CMA CGM|CMA|HAPAG|HAMBURG|ONE|EVER|COSCO|ZIM|HMM|YM|YANG MING|LOG-IN|ALIAN[CÇ]A|SEALAND|OOCL|PIL|WAN HAI)\s+[A-Z].*?(?:\bV\.?\s*\/?\s*[A-Z0-9]{2,6}|\s\/\s*[A-Z0-9]{3,6}|\s\|\s*[A-Z0-9]{3,8}|\s\d{2,3}[A-Z]|\s-\s[A-Z]{1,3}\d{2,4}[A-Z]?)\s*$/i;
  if (!navio) navio = ls.find((l) => ARMADOR.test(l) && l.length < 40) ?? null;
  // "NYK RUMINA / 078N ITAJAI, BRAZIL": o navio no começo da linha, até a viagem.
  if (!navio) {
    const m = ls
      .map((l) => l.match(/^((?:MSC|NYK|MAERSK|CMA CGM|HAPAG|ONE|EVER|COSCO|ZIM|HMM|YM|LOG-IN|SEALAND|OOCL)\s+[A-Z ]+?(?:\s*\/\s*|\s+V\.?\s*)[A-Z0-9]{2,6})\b/))
      .find(Boolean);
    if (m) navio = m[1];
  }
  if (!navio) {
    const i = ls.findIndex((l) => /^VESSEL\b|^Vessel & Voyage/i.test(l));
    const v = i >= 0 ? proxValor(i) : null;
    if (v && v.length < 40 && !ehRascunho(v)) navio = v;
  }

  // Destino: Place of delivery / Port of discharge; porto com código ("MOBILE (USMOB)"); o porto
  // estrangeiro que mais se repete; no packing list, o país do destinatário.
  let destino: string | null =
    rstDados?.destino ??
    naLinha(/Port of Discharge|Place of Delivery/) ??
    plano.match(/\bPort of Discharge\s+([A-Z][A-Z ,.]+?)(?:\s{2,}|\s+(?:Place|Marks|$))/)?.[1]?.trim() ?? null;
  const comCodigo = ls.filter((l) => /\(([A-Z]{5})\)\s*$/.test(l) && !/^(ITAJA|PARANAGU|SANTOS|NAVEGANTES|ITAPO|RIO GRANDE|S[AÃ]O FRANCISCO)/i.test(l));
  if (comCodigo.length) destino = comCodigo[comCodigo.length - 1];
  if (!destino) {
    // "PORT OF DISCHARGE AGENT:" é o agente (endereço), não o porto; valor que é porto brasileiro
    // (o draft da MSC embaralha as caixas: "Navegantes / SC") também não.
    // O valor na linha logo abaixo do rótulo: mais longe já é outra caixa (BL da RST: o agente).
    const v = ls
      .map((l, i) => {
        if (!/PORT OF DISCHARGE|PLACE OF DELIVERY/i.test(l) || l.length > 70 || /\bAGENT\b/i.test(l)) return null;
        const p = proxValor(i);
        return p && ls.indexOf(p, i + 1) - i <= 1 ? p : null;
      })
      .find((x) => x && x.length <= 60 && !PORTOS_BR.test(x));
    // "ROTTERDAM, NETHERLANDS LE HAVRE, FRANCE": o último (lugar de entrega).
    if (v) {
      const ult = v.match(/([A-Z][A-Z .]+,\s*[A-Z]+)\s*$/)?.[1] ?? v;
      destino = ult.replace(/^(?:NETHERLANDS|BELGIUM|GERMANY|FRANCE|ITALY|SPAIN|PORTUGAL|UNITED KINGDOM|USA|CHINA|BRAZIL)\s+/i, "");
    }
  }
  // Para contar repetições, só a 1ª página (BL com as páginas iguais repete tudo, até o nome do agente).
  const fimPag1 = ls.findIndex((l) => /^--\s*1 of \d+\s*--$/.test(l));
  const pag1 = fimPag1 > 0 ? ls.slice(0, fimPag1) : ls;
  if (!destino) {
    const cont = new Map<string, number>();
    for (const l of pag1) if (/^[A-Z][A-Z ]{3,20}$/.test(l) && !PORTOS_BR.test(l) && !EMPRESA.test(l) && !ehRascunho(l)) cont.set(l, (cont.get(l) ?? 0) + 1);
    const rep = [...cont.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1])[0];
    if (rep) destino = rep[0];
  }
  if (!destino && destinatario) {
    const i = ls.findIndex((l) => l.toUpperCase().includes(destinatario!.toUpperCase().slice(0, 12)));
    const pais = ls
      .slice(i + 1, i + 5)
      .map((l) => l.split("\t")[0].trim().match(/[-–,]\s*([A-Z]{4,})\s*$/)?.[1])
      .find((p) => p && !/^(BRASIL|BRAZIL)$/i.test(p));
    if (pais) destino = pais;
  }
  // A cidade que se repete (endereço do agente no destino e caixa do porto): "Montoir-de-Bretagne, 44550"
  // e "Montoir-De-Bretagne".
  if (!destino) {
    const cont = new Map<string, { n: number; v: string }>();
    for (const l of pag1) {
      const c = l.split(",")[0].trim();
      if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{3,30}$/.test(c) || ENDERECO.test(c) || PORTOS_BR.test(c) || EMPRESA.test(c) || ehRotulo(c) || ehRascunho(c)) continue;
      const k = c.toLowerCase();
      cont.set(k, { n: (cont.get(k)?.n ?? 0) + 1, v: cont.get(k)?.v ?? c });
    }
    const rep = [...cont.values()].filter((x) => x.n >= 2).sort((a, b) => b.n - a.n)[0];
    if (rep) destino = rep.v;
  }

  // Invoice/fatura: "INVOICE:CMB/RC/007/2026", "INVOICE: 4513/2026", "MN/RC/042/2026".
  const invoice =
    plano.match(/\bINVOICE\s*(?:N[º°o.]*|#)?\s*:?\s*([A-Z0-9]{1,6}(?:\/[A-Z0-9]{1,6}){1,3})\b/i)?.[1] ??
    plano.match(/\b([A-Z]{1,5}\/[A-Z]{1,5}\/\d{2,4}\/\d{4})\b/)?.[1] ??
    // Packing list/commercial invoice com o nº no cabeçalho: "N.º: AQ1492026" (é o da invoice).
    (/PACKING LIST|COMMERCIAL INVOICE/i.test(plano) ? plano.match(/\bN[º°o.]*\s*:\s*([A-Z]{1,5}\d{5,12})\b/)?.[1] : null) ??
    null;
  // "Total Pallets 52".
  const total = plano.match(/\bTotal\s+(Pallets?|Paletes?|Skids?|Crates?)\s*:?\s*(\d[\d.]*)/i);
  // Booking: rótulo, ou os formatos dos armadores (EBKG/SAOG + 8 dígitos); contêiner (4 letras + 7 dígitos) não.
  const booking =
    rstDados?.booking ??
    plano.match(/\bBooking\s*(?:N[º°o.]*|#|No\.?)?\s*:?\s*([A-Z0-9]{8,14})\b/i)?.[1] ??
    plano.match(/\b((?:EBKG|SAOG|BKG)\d{8,10})\b/)?.[1] ??
    null;
  const blRotulo = plano.match(/\b(?:B\/L\s*No\.?|BILL OF LADING\s*NO\.?|Sea Waybill No\.?)\s*:?\s*([A-Z0-9]{8,18})\b/i)?.[1];
  const bl =
    rstDados?.bl ??
    (ehRascunho(blRotulo) ? null : blRotulo) ??
    plano.match(/\b(BRZSE\d{8}|ONEY[A-Z]{4}\d{8}|MEDU[A-Z0-9]{8}|HLCU[A-Z0-9]{10,14})\b/)?.[1] ??
    // "B/L NUMBER" sem valor ao lado (BL da RST: o nº vem no alto da página, logo abaixo do booking,
    // "RS26C03689"): o código de letras e números das primeiras linhas que não é booking nem contêiner.
    (/\bB\/L\s*NUMBER\b/i.test(plano)
      ? ls
          .slice(0, 6)
          .find((l) => /^[A-Z]{2,5}\d{2}[A-Z0-9]{3,12}$/.test(l) && /\d{4}/.test(l) && l !== booking && !/^[A-Z]{4}\d{7}$/.test(l) && !/^(EBKG|SAOG|BKG)\d/.test(l))
      : undefined) ??
    null;

  return {
    exportador: exportador ? titulo(exportador) : null,
    destinatario: destinatario ? titulo(destinatario) : null,
    navio: navio ? navio.toUpperCase().replace(/\s+/g, " ") : null,
    destino: destino ? titulo(destino.replace(/\s+/g, " ")) : null,
    invoice,
    booking: booking && booking !== bl ? booking : booking,
    bl,
    importador: (() => {
      const v = debaixo(/BUYER\s*\/\s*IMPORTER|IMPORTER|BUYER/);
      return v ? titulo(v) : null;
    })(),
    pacotes: total?.[2] ?? null,
    tipo: total?.[1] ?? null,
  };
}

/**
 * Pedido com vários clientes do mesmo ciclo ("preciso da declaração CICLO 964 para: NORTOX S/A - 30 PALETES /
 * CAFÉ TRÊS CORAÇÕES - 250 PALETES"): uma declaração por cliente.
 */
export function clientesDoPedido(texto: string): { exportador: string; quantidade: string; item: string }[] {
  const out: { exportador: string; quantidade: string; item: string }[] = [];
  for (const l of texto.split("\n")) {
    const m = l.trim().match(/^(.{3,80}?)\s*[-–:]\s*(\d[\d.]*)\s*(paletes?|pallets?|kits?|caixas?|skids?|suportes?|engradados?|tampas?)\b\.?/i);
    if (m && !/^\d/.test(m[1])) out.push({ exportador: titulo(m[1].replace(/[*.]+$/, "").trim()), quantidade: m[2], item: m[3].toLowerCase() });
  }
  return out;
}

export interface PedidoLido {
  /** Quem pediu ("Para Instituto Botânico La Selva", ou o nome antes da NF-e no e-mail). */
  cliente: string | null;
  nfe: string | null;
  fatura: string | null;
  /** Quantidade de cada ciclo/lote ("90 - Pallet 1000x1200 Ciclo Mann 0252", "14 paletes LOTE 499"). */
  itens: { ciclo: string; quantidade: string; item: string }[];
}

const ITEM = /paletes?|pallets?|skids?|suportes?|caixas?|crates?|engradados?|kits?|tampas?/i;
/** "Pallet 1000x1200" -> "paletes"; "skid" -> "suportes" (como na declaração). */
function tipoDoItem(s: string): string {
  const w = s.match(ITEM)?.[0].toLowerCase() ?? "";
  if (/^pa[l]+et/.test(w)) return "paletes";
  if (/skid|suporte/.test(w)) return "suportes";
  if (/caixa|crate/.test(w)) return "caixas";
  if (/engradado/.test(w)) return "engradados";
  if (/kit/.test(w)) return "kits";
  if (/tampa/.test(w)) return "tampas";
  return "unidades";
}

const SAUDACAO = /^(boa|bom|ol[áa]|oi|prezad|solicito|preciso|segue|seguem|att|atenciosamente|obrigad|grat|favor|por favor|declara)/i;

/**
 * Pedido de declaração por e-mail (print ou texto): cliente, NF-e ("NFE 7399"), fatura ("FAT 161") e a
 * quantidade de cada ciclo — uma declaração com vários ciclos. Só vale para texto curto sem CNPJ (o
 * BL/booking tem a leitura dele).
 */
export function lerPedido(texto: string): PedidoLido | null {
  if (texto.length > 2500 || CNPJ.test(texto)) return null;
  const ls = texto.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const nfe = texto.match(/\bNF-?e?\s*(?:N[º°o.]*)?\s*:?\s*(\d{3,9})\b/i)?.[1] ?? null;
  const fatura = texto.match(/\bFAT(?:URA)?\.?\s*(?:N[º°o.]*)?\s*:?\s*(\d[\d/-]*\d|\d)\b/i)?.[1] ?? null;
  const itens: PedidoLido["itens"] = [];
  const iDados: number[] = [];
  ls.forEach((l, i) => {
    // "90 - Pallet 1000x1200 Ciclo Mann 0252" / "14 paletes LOTE 499" / "Ciclo 252 - 90 paletes".
    const a = l.match(/^(\d[\d.]*)\s*(?:[-–—x:]\s*)?(.*?)\b(?:CICLO|LOTE)S?\s*(?:MANN)?\s*[:#nNº°.]*\s*(\d{1,5})\b/i);
    const b = !a && l.match(/\b(?:CICLO|LOTE)S?\s*(?:MANN)?\s*[:#nNº°.]*\s*(\d{1,5})\s*[-–—:(]\s*(\d[\d.]*)\s*(.*)$/i);
    if (a) itens.push({ ciclo: String(parseInt(a[3], 10)), quantidade: a[1], item: tipoDoItem(a[2]) });
    else if (b) itens.push({ ciclo: String(parseInt(b[1], 10)), quantidade: b[2], item: tipoDoItem(b[3]) });
    if (a || b || /\bNF-?e?\b|\bFAT(?:URA)?\b|\bCICLO|\bLOTE/i.test(l)) iDados.push(i);
  });
  if (!itens.length && !nfe && !fatura) return null;
  // Cliente: "Para X"; senão a 1ª linha antes dos dados que não é saudação ("Companhia providencia ind. com").
  let cliente = ls.map((l) => l.match(/^para:?\s+([^\d].{2,80})$/i)?.[1]).find(Boolean) ?? null;
  if (!cliente && iDados.length) {
    cliente =
      ls
        .slice(0, iDados[0])
        .find((l) => !SAUDACAO.test(l) && !/\d/.test(l) && l.split(/\s+/).length >= 2 && l.length <= 80 && !/[?:]$/.test(l)) ?? null;
  }
  return {
    cliente: cliente ? titulo(cliente.replace(/[.,;]+$/, "").trim()) : null,
    nfe: nfe ? String(parseInt(nfe, 10)) : null,
    fatura,
    itens,
  };
}
