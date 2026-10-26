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
}

const CNPJ = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
const EMPRESA = /\b(LTDA|LTD|S\.?\/?A\.?|EIRELI|ME|EPP|SPA|S\.?R\.?L\.?|LLC|INC|GMBH|B\.?V\.?|CORP|CO\.?)\b/i;
// Linha de endereço/contato (não é nome de empresa).
const ENDERECO = /\d|@|\b(RUA|AV\.?|AVENIDA|RODOVIA|ESTRADA|CEP|FONE|PHONE|TEL|FAX|CONTACT|CONTATO|CNPJ|CUIT|EORI|BRASIL|BRAZIL|CX POSTAL|BAIRRO|STREET|BOULEVARD|BLVD|STRADA|ROAD|ZONE|Z\.I\.)\b/i;
const PORTOS_BR = /\b(PARANAGU[AÁ]|ITAJA[IÍ]|NAVEGANTES|SANTOS|ITAPO[AÁ]|RIO GRANDE|S[AÃ]O FRANCISCO|PECEM|SUAPE|SALVADOR|VIT[OÓ]RIA|IMBITUBA|MANAUS)\b/i;
const titulo = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s(/.-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
    .replace(/\b(Ltda|Llc|Spa|Ltd|Inc)\b/gi, (m) => (m.length <= 3 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1).toLowerCase()))
    .replace(/\bS\/a\b/gi, "S/A")
    .replace(/\bS\.a\./gi, "S.A.")
    .replace(/(?<=\s)(De|Da|Do|Das|Dos|E)(?=\s)/g, (m) => m.toLowerCase())
    .replace(/\(([a-z]{5})\)/gi, (_, c: string) => `(${c.toUpperCase()})`);

const ehRotulo = (l: string) => /\(\d{1,2}\)|COMPLETE NAME|REFERENCES|NOTIFY|PLACE OF|PORT OF|VESSEL|DOCUMENT NO|SHIPPER|CONSIGNEE|EXPORTER/i.test(l);

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
  let destinatario: string | null = null;
  if (fimExportador >= 0) {
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

  // Navio: "Vessel MSC AMALFI Voyage 26N", rótulo VESSEL, ou linha de armador com viagem ("NYK DIANA V.025N").
  let navio: string | null =
    [...plano.matchAll(/\bVessel\s+(.+?)\s+Voyage\s+(\S+)/gi)].map((m) => `${m[1]} ${m[2]}`).find((v) => !/[(&]|\bNO\.?$|\bNR\b|FLAG/i.test(v)) ?? null;
  const ARMADOR = /^(MSC|NYK|MAERSK|CMA CGM|CMA|HAPAG|HAMBURG|ONE|EVER|COSCO|ZIM|HMM|YM|YANG MING|LOG-IN|ALIAN[CÇ]A|SEALAND|OOCL|PIL|WAN HAI)\s+[A-Z].*?(?:\bV\.?\s*\/?\s*[A-Z0-9]{2,6}|\s\/\s*[A-Z0-9]{3,6}|\s\d{2,3}[A-Z])\s*$/i;
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
    if (v && v.length < 40) navio = v;
  }

  // Destino: Place of delivery / Port of discharge; porto com código ("MOBILE (USMOB)"); o porto
  // estrangeiro que mais se repete; no packing list, o país do destinatário.
  let destino: string | null = plano.match(/\bPort of Discharge\s+([A-Z][A-Z ,.]+?)(?:\s{2,}|\s+(?:Place|Marks|$))/)?.[1]?.trim() ?? null;
  const comCodigo = ls.filter((l) => /\(([A-Z]{5})\)\s*$/.test(l) && !/^(ITAJA|PARANAGU|SANTOS|NAVEGANTES|ITAPO|RIO GRANDE|S[AÃ]O FRANCISCO)/i.test(l));
  if (comCodigo.length) destino = comCodigo[comCodigo.length - 1];
  if (!destino) {
    const i = ls.findIndex((l) => /PORT OF DISCHARGE|PLACE OF DELIVERY/i.test(l));
    const v = i >= 0 ? proxValor(i) : null;
    // "ROTTERDAM, NETHERLANDS LE HAVRE, FRANCE": o último (lugar de entrega).
    if (v) {
      const ult = v.match(/([A-Z][A-Z .]+,\s*[A-Z]+)\s*$/)?.[1] ?? v;
      destino = ult.replace(/^(?:NETHERLANDS|BELGIUM|GERMANY|FRANCE|ITALY|SPAIN|PORTUGAL|UNITED KINGDOM|USA|CHINA|BRAZIL)\s+/i, "");
    }
  }
  if (!destino) {
    const cont = new Map<string, number>();
    for (const l of ls) if (/^[A-Z][A-Z ]{3,20}$/.test(l) && !PORTOS_BR.test(l) && !EMPRESA.test(l)) cont.set(l, (cont.get(l) ?? 0) + 1);
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

  // Invoice/fatura: "INVOICE:CMB/RC/007/2026", "INVOICE: 4513/2026", "MN/RC/042/2026".
  const invoice =
    plano.match(/\bINVOICE\s*(?:N[º°o.]*|#)?\s*:?\s*([A-Z0-9]{1,6}(?:\/[A-Z0-9]{1,6}){1,3})\b/i)?.[1] ??
    plano.match(/\b([A-Z]{1,5}\/[A-Z]{1,5}\/\d{2,4}\/\d{4})\b/)?.[1] ??
    null;
  // Booking: rótulo, ou os formatos dos armadores (EBKG/SAOG + 8 dígitos); contêiner (4 letras + 7 dígitos) não.
  const booking =
    plano.match(/\bBooking\s*(?:N[º°o.]*|#|No\.?)?\s*:?\s*([A-Z0-9]{8,14})\b/i)?.[1] ?? plano.match(/\b((?:EBKG|SAOG|BKG)\d{8,10})\b/)?.[1] ?? null;
  const bl =
    plano.match(/\b(?:B\/L\s*No\.?|BILL OF LADING\s*NO\.?|Sea Waybill No\.?)\s*:?\s*([A-Z0-9]{8,18})\b/i)?.[1] ??
    plano.match(/\b(BRZSE\d{8}|ONEY[A-Z]{4}\d{8}|MEDU[A-Z0-9]{8}|HLCU[A-Z0-9]{10,14})\b/)?.[1] ??
    null;

  return {
    exportador: exportador ? titulo(exportador) : null,
    destinatario: destinatario ? titulo(destinatario) : null,
    navio: navio ? navio.toUpperCase().replace(/\s+/g, " ") : null,
    destino: destino ? titulo(destino.replace(/\s+/g, " ")) : null,
    invoice,
    booking: booking && booking !== bl ? booking : booking,
    bl,
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
