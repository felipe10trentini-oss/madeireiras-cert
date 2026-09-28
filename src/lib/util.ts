// Utilitários de texto, datas e horários usados pelos leitores de curva e pelo certificado.

export const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "ARTEMOBILLI", "Artemobili" -> só letras e dígitos, maiúsculas, sem acento. */
export const chaveNome = (s: string | null | undefined) =>
  semAcento(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Registro no MAPA em forma comparável: "BR–PR0942", "BR-SC 0878", "BRPR-0610" -> "PR0942".
 * Quando a curva traz só o número ("0933") a UF pode ser passada à parte.
 */
export function chaveRegMapa(reg: string | null | undefined, uf?: string | null): string {
  const s = semAcento(reg ?? "").toUpperCase();
  const m = s.match(/BR\W*([A-Z]{2})\W*(\d{3,4})/) ?? s.match(/\b([A-Z]{2})\W*(\d{3,4})/);
  if (m) return `${m[1]}${m[2].padStart(4, "0")}`;
  const n = s.match(/(\d{3,4})/);
  return n && uf ? `${uf.toUpperCase()}${n[1].padStart(4, "0")}` : "";
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** Número em pt-BR: "56,0" / "56.0" -> 56. */
export function numeroBR(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** 209.088 -> "209,088" (3 casas, vírgula). */
export const m3BR = (n: number) => n.toFixed(3).replace(".", ",");

/** Temperatura sem casas desnecessárias: 56 -> "56", 56.5 -> "56,5". */
export const tempBR = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace(".", ","));

export interface DataHora {
  data: string; // dd/mm/aaaa
  hora: string; // HH:MM
}

function paraDate(dh: DataHora): Date {
  const [d, m, a] = dh.data.split("/").map(Number);
  const [h, min] = dh.hora.split(":").map(Number);
  return new Date(Date.UTC(a, m - 1, d, h, min));
}

function deDate(dt: Date): DataHora {
  return {
    data: `${pad2(dt.getUTCDate())}/${pad2(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`,
    hora: `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`,
  };
}

export function somarMinutos(dh: DataHora, minutos: number): DataHora {
  return deDate(new Date(paraDate(dh).getTime() + minutos * 60_000));
}

export function minutosEntre(a: DataHora, b: DataHora): number {
  return Math.round((paraDate(b).getTime() - paraDate(a).getTime()) / 60_000);
}

/** "08:35" -> "08h35m" (formato do certificado). */
export const horaFmt = (hhmm: string) =>
  hhmm.replace(/^(\d{1,2}):(\d{2}).*$/, (_, h: string, m: string) => `${h.padStart(2, "0")}h${m}m`);

/** 4088 min -> "68h08m". */
export const duracaoHM = (min: number) => `${pad2(Math.floor(min / 60))}h${pad2(min % 60)}m`;

export function hojeBR(): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** Formata CNPJ só com dígitos no padrão 00.000.000/0000-00. */
export function formatarCnpj(cnpj: string): string {
  const d = soDigitos(cnpj);
  if (d.length !== 14) return cnpj;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}
