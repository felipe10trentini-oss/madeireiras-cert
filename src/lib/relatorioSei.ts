import type { Madeireira } from "@/lib/madeireiras";

/** Número "SEI - Relatórios" da aba Peticionamento SEI do Controle de Curvas (outro Supabase). */
const CURVAS = "https://controle-curvas.vercel.app/api/relatorios";

interface LinhaPet {
  empresa: string;
  pasta: string;
  relatorio: string;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const VAZIAS = new Set(["ltda", "me", "epp", "eireli", "sa", "s", "a", "e", "de", "da", "do", "das", "dos", "cia", "comercio", "industria"]);
const palavras = (s: string) => norm(s).split(" ").filter((p) => p && !VAZIAS.has(p));

/**
 * Liga a empresa à linha do Peticionamento: nome igual ao apelido/razão social; senão a linha cujas
 * palavras estão todas no apelido + razão social (a mais específica). Devolve também o nome lá, para conferir.
 */
export function relatorioDaEmpresa(e: Madeireira, linhas: LinhaPet[]): { numero: string; empresa: string } | null {
  const nomes = [e.apelido, e.razaoSocial].map(norm);
  const nossas = new Set([...palavras(e.apelido), ...palavras(e.razaoSocial)]);
  const nomeDe = (l: LinhaPet) => l.pasta || l.empresa;
  const igual = linhas.find((l) => [l.pasta, l.empresa].some((n) => n && nomes.includes(norm(n))));
  if (igual) return { numero: igual.relatorio, empresa: nomeDe(igual) };
  const cands = linhas
    .map((l) => ({ l, ps: palavras(nomeDe(l)) }))
    .filter(({ ps }) => ps.length > 0 && ps.every((p) => nossas.has(p)))
    .sort((a, b) => b.ps.length - a.ps.length);
  // Duas linhas igualmente específicas (ex.: duas unidades da mesma empresa): não chuta.
  if (cands.length) {
    if (cands[1] && cands[1].ps.length === cands[0].ps.length && cands[1].l.relatorio !== cands[0].l.relatorio) return null;
    return { numero: cands[0].l.relatorio, empresa: nomeDe(cands[0].l) };
  }
  // Ao contrário: o apelido daqui dentro do nome de lá ("Exata" → "Exata SC", "Conrado Madeiras" → "Conrado Mad"),
  // aceitando abreviação no começo da palavra. Só vale se for uma linha só (ou todas com o mesmo número).
  const casa = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
  const ap = palavras(e.apelido);
  const contem = ap.length
    ? linhas.filter((l) => {
        const ps = palavras(nomeDe(l));
        return ap.every((a) => ps.some((p) => casa(a, p)));
      })
    : [];
  if (!contem.length || contem.some((l) => l.relatorio !== contem[0].relatorio)) return null;
  return { numero: contem[0].relatorio, empresa: nomeDe(contem[0]) };
}

export async function buscarRelatorioSei(e: Madeireira, authorization: string): Promise<{ numero: string; empresa: string } | null> {
  const r = await fetch(CURVAS, { headers: { Authorization: authorization }, cache: "no-store" });
  if (!r.ok) throw new Error("Não foi possível ler o nº do relatório no Controle de Curvas.");
  const d = (await r.json()) as { relatorios?: LinhaPet[] };
  return relatorioDaEmpresa(e, d.relatorios ?? []);
}
