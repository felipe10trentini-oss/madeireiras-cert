// Recibo Eletrônico de Protocolo do SEI (peticionamento): a data que vai no relatório do MAPA
// ("Data do Comunicado/Programação") é a do recibo da programação do mês ou do comunicado.
//   Recibo Eletrônico de Protocolo - 56748486 ... Data e Horário: 05/10/2026 13:15:43
//   Número do Processo: 21034.011284/2024-28 ... Protocolos dos Documentos (Número SEI):
//   - Comunicado 104/2026 56748484                  (pode ter vários: "- Comunicado 078/2026 … - Comunicado 079/2026 …")
//   - Programação SALAMONI - OUTUBRO 2026 56257194  / "Programação MART (OUT NOV DEZ) 2026" (trimestral)
// O recibo do certificado (Documento Principal: Certificado TFQ…) também cita o comunicado: não conta.

export interface Recibo {
  data: string; // "05/10/2026"
  hora: string; // "13:15"
  processo: string | null;
  /** Comunicados protocolados: "104/2026", "065/2026-A". */
  comunicados: string[];
  /** Descrição da programação protocolada ("SALAMONI - OUTUBRO 2026"). */
  programacao: string | null;
  /** Recibo de certificado (não é o do comunicado nem o da programação). */
  certificado: boolean;
}

export function lerRecibo(texto: string): Recibo | null {
  const t = texto.replace(/\s+/g, " ");
  if (!/Recibo Eletr[ôo]nico de Protocolo/i.test(t)) return null;
  const m = t.match(/Data e Hor[áa]rio:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}):(\d{2})/i);
  if (!m) return null;
  const docs = t.slice(t.search(/Protocolos dos Documentos/i) + 1 || 0).replace(/\s*O Usu[áa]rio Externo acima.*$/i, "");
  const comunicados = [...docs.matchAll(/-\s*Comunicado\s+(\d{1,4})\s*\/\s*(\d{4})(?:\s*-\s*([A-Z])\b)?/gi)].map(
    (c) => `${c[1].padStart(3, "0")}/${c[2]}${c[3] ? `-${c[3].toUpperCase()}` : ""}`
  );
  return {
    data: m[1],
    hora: `${m[2]}:${m[3]}`,
    processo: t.match(/N[úu]mero do Processo:\s*(\d{5}\.\d{6}\/\d{4}-\d{2})/i)?.[1] ?? null,
    comunicados,
    programacao: docs.match(/-\s*Programa[çc][ãa]o\s+(.+?)\s+\d{6,}/i)?.[1]?.trim() ?? null,
    certificado: /Documento Principal|Certificado TFQ/i.test(docs),
  };
}

/** "104/2026", "104-26", "COMUNICADO 104-2026-A" -> "104/2026" / "104/2026-A" (ano com 4 dígitos). */
export function normalizarNumeroComunicado(numero: string | null | undefined): string | null {
  const m = (numero ?? "").match(/(\d{1,4})\s*[/-]\s*(\d{4}|\d{2})(?!\d)(?:\s*-?\s*([A-Z])\b)?/i);
  if (!m) return null;
  const ano = m[2].length === 2 ? `20${m[2]}` : m[2];
  return `${m[1].padStart(3, "0")}/${ano}${m[3] ? `-${m[3].toUpperCase()}` : ""}`;
}

const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const ABREV = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

/** O recibo é o da programação do mês (ou do trimestre) do tratamento? `data` = "21/09/2026". */
export function reciboEhDaProgramacao(r: Recibo, data: string, trimestral = false): boolean {
  if (!r.programacao || r.certificado) return false;
  const [, mm, aaaa] = data.split("/");
  const mes = parseInt(mm, 10) - 1;
  const t = semAcento(r.programacao);
  if (!new RegExp(`\\b${aaaa}\\b`).test(t)) return false;
  const meses = trimestral ? [0, 1, 2].map((i) => Math.floor(mes / 3) * 3 + i) : [mes];
  const cita = (i: number) => new RegExp(`\\b(?:${MESES[i]}|${ABREV[i]})\\b`).test(t);
  // Trimestral: "(OUT NOV DEZ)" ou "4º trimestre"; mensal: "OUTUBRO 2026" ou "10/2026".
  if (trimestral && new RegExp(`\\b${Math.floor(mes / 3) + 1}\\s*[ºO°]?\\s*TRIMESTRE`).test(t)) return true;
  return meses.some(cita) || new RegExp(`\\b0?${mes + 1}\\s*/\\s*${aaaa}\\b`).test(t);
}

/** O recibo é o do comunicado `numero` ("104/2026")? */
export function reciboEhDoComunicado(r: Recibo, numero: string): boolean {
  const n = normalizarNumeroComunicado(numero);
  return !!n && !r.certificado && r.comunicados.includes(n);
}
