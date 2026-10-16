// Aprender por exemplo: o Word modelo da empresa é uma declaração já feita; com os documentos
// daquela mesma remessa (NF-e, BL, booking, invoice…) o site acha de onde veio cada dado e guarda
// a regra ("Navio = o que vem depois de 'Vessel' no BL"). Nas próximas remessas aplica a regra.
import type { NotaFiscal } from "./notaFiscal";
import type { CampoModelo } from "./preencherModelo";

export type TipoFonte = "nfe" | "bl" | "booking" | "invoice" | "packing" | "outro";

export interface Fonte {
  nome: string;
  tipo: TipoFonte;
  texto: string;
  nf?: NotaFiscal | null;
}

/** Regra de um campo: o texto do modelo com {chave} no lugar de cada dado que veio de um documento. */
export type Regras = Partial<Record<CampoModelo, string>>;

export function tipoDaFonte(texto: string, nf?: NotaFiscal | null): TipoFonte {
  if (nf?.numero || /DANFE|Documento Auxiliar da Nota Fiscal/i.test(texto)) return "nfe";
  if (/bill\s+of\s+lading|conhecimento\s+de\s+embarque|\bB\/L\s*(?:No|N[ºo°]|number)/i.test(texto)) return "bl";
  if (/booking\s+(?:confirmation|no|number|n[ºo°])|confirma[çc][ãa]o\s+de\s+(?:reserva|booking)/i.test(texto)) return "booking";
  if (/packing\s+list|romaneio/i.test(texto)) return "packing";
  if (/commercial\s+invoice|proforma|fatura\s+comercial|\binvoice\b/i.test(texto)) return "invoice";
  return "outro";
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Forma de comparação: maiúsculas, sem acento, só letras e números. */
const norm = (s: string) => sem(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
const rotuloNorm = (s: string) => sem(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(-4).join(" ");

/** Dados de cada documento, com uma chave estável ("nfe.razao", "bl:vessel"). */
export function dadosDasFontes(fontes: Fonte[]): Map<string, string> {
  const out = new Map<string, string>();
  const por = (k: string, v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
    if (s && !out.has(k)) out.set(k, s);
  };
  for (const f of fontes) {
    if (f.nf) {
      const d = f.nf.destinatario;
      por("nfe.numero", f.nf.numero);
      por("nfe.emissao", f.nf.emissao);
      por("nfe.razao", d.razao);
      por("nfe.cnpj", d.cnpj);
      por("nfe.endereco", d.endereco);
      por("nfe.bairro", d.bairro);
      por("nfe.cep", d.cep);
      por("nfe.municipio", d.municipio);
      por("nfe.uf", d.uf);
      const total = f.nf.itens.reduce((a, i) => a + i.quantidade, 0);
      if (total) por("nfe.quantidade", total.toLocaleString("pt-BR"));
      f.nf.itens.forEach((it, i) => {
        por(`nfe.item${i + 1}`, it.descricao);
        por(`nfe.qtd${i + 1}`, it.quantidade.toLocaleString("pt-BR"));
      });
      const plano = f.texto.replace(/[ \t]+/g, " ");
      por("nfe.pesoBruto", plano.match(/PESO BRUTO\s*\n?\s*([\d.]+,\d+)/i)?.[1]);
      por("nfe.pesoLiquido", plano.match(/PESO L[ÍI]QUIDO\s*\n?\s*([\d.]+,\d+)/i)?.[1]);
    }
    // Rótulo: valor (na mesma linha) e RÓTULO ↵ valor (linha de baixo, como no DANFE).
    const linhas = f.texto.split(/\n/).map((l) => l.replace(/[ \t]+/g, " ").trim());
    linhas.forEach((l, i) => {
      for (const m of l.matchAll(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 ./#º°-]{1,40}?)\s*[:#]\s*([^:]{2,120}?)(?=\s{2,}|\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ./]{1,30}:|$)/g)) {
        por(`${f.tipo}:${rotuloNorm(m[1])}`, m[2]);
      }
      const prox = linhas[i + 1];
      if (prox && /^[A-ZÀ-Ý0-9 ./º°()-]{3,40}$/.test(l) && !/:/.test(l) && prox.length >= 2 && prox.length <= 120) por(`${f.tipo}:${rotuloNorm(l)}`, prox);
    });
  }
  return out;
}

/** Texto normalizado com o mapa de volta para o original (posição a posição). */
function mapa(s: string): { n: string; idx: number[] } {
  let n = "";
  const idx: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = norm(s[i]);
    for (const ch of c) {
      n += ch;
      idx.push(i);
    }
  }
  return { n, idx };
}

/** Pedaço de um dado: sem as `a` primeiras e as `b` últimas palavras ("PALLET MADEIRA 1200X…" -> "1200X…"). */
function pedaco(v: string, a: number, b: number): string {
  const ps = v.split(/\s+/);
  return ps.slice(a, ps.length - b).join(" ");
}

/** Chave com o recorte: "nfe.item1#2,0" = item 1 sem as 2 primeiras palavras. */
function valorDaChave(dados: Map<string, string>, chave: string): string | undefined {
  const m = chave.match(/^(.+)#(\d+),(\d+)$/);
  if (!m) return dados.get(chave);
  const v = dados.get(m[1]);
  return v == null ? undefined : pedaco(v, +m[2], +m[3]);
}

/**
 * Aprende as regras: para cada campo do modelo que muda a cada remessa, troca pelo {nome do dado}
 * cada trecho que aparece nos documentos daquela remessa. Campo sem trecho achado não vira regra.
 */
export function aprender(atuais: Partial<Record<CampoModelo, string>>, fontes: Fonte[], campos: Set<CampoModelo>): Regras {
  const base = dadosDasFontes(fontes);
  const dados: { k: string; v: string; n: string }[] = [];
  for (const [k, v] of base) {
    const nPal = v.split(/\s+/).length;
    // O dado inteiro e, para textos com várias palavras, pedaços dele (o modelo pode usar só parte).
    for (let a = 0; a <= Math.min(3, nPal - 1); a++)
      for (let b = 0; b <= Math.min(3, nPal - 1 - a); b++) {
        const v2 = a || b ? pedaco(v, a, b) : v;
        const n = norm(v2);
        if ((a || b) && n.length < 8) continue;
        dados.push({ k: a || b ? `${k}#${a},${b}` : k, v: v2, n });
      }
  }
  const longos = dados
    .filter((x) => x.n.length >= 4 || (/^\d+$/.test(x.n) && x.n.length >= 3))
    // O mais longo primeiro (o endereço inteiro antes de um pedaço dele); NF e dado inteiro antes.
    .sort((a, b) => b.n.length - a.n.length || (a.k.includes("#") ? 1 : 0) - (b.k.includes("#") ? 1 : 0) || (a.k.startsWith("nfe.") ? -1 : 1));
  // Curtos (UF "SC") só valem colados num dado já achado ("TOLEDO - PR").
  const curtos = dados.filter((x) => !x.k.includes("#") && x.n.length >= 2 && x.n.length < 4 && /^[A-Z]+$/.test(x.n));

  const regras: Regras = {};
  for (const [campo, valor] of Object.entries(atuais) as [CampoModelo, string][]) {
    if (!valor?.trim() || !campos.has(campo)) continue;
    const { n, idx } = mapa(valor);
    const tomados: { ini: number; fim: number; k: string }[] = [];
    const tomar = (d: { k: string; v: string; n: string }, perto: boolean) => {
      for (let p = n.indexOf(d.n), de = 0; p >= 0; p = n.indexOf(d.n, de)) {
        de = p + d.n.length;
        const ini = idx[p];
        let fim = idx[p + d.n.length - 1] + 1;
        // Pontuação final do dado ("BRF S.A." no modelo "BRF S.A ."): vai junto.
        const pont = d.v.match(/[^\p{L}\p{N}]+$/u)?.[0];
        if (pont) {
          const m = valor.slice(fim).match(/^\s*[^\p{L}\p{N}\s]+/u);
          if (m && pont.trim() && m[0].trim() === pont.trim()) fim += m[0].length;
        }
        if (tomados.some((t) => ini < t.fim && fim > t.ini)) continue;
        // Palavra inteira: número ("6302", não o "630" de "63021") e sigla curta.
        const antes = valor[ini - 1] ?? "";
        const depois = valor[fim] ?? "";
        if (/^\d+$/.test(d.n) && (/\d/.test(antes) || /\d/.test(depois))) continue;
        if (perto && (/[\p{L}\p{N}]/u.test(antes) || /[\p{L}\p{N}]/u.test(depois))) continue;
        if (perto && !tomados.some((t) => Math.abs(ini - t.fim) <= 4 || Math.abs(t.ini - fim) <= 4)) continue;
        tomados.push({ ini, fim, k: d.k });
      }
    };
    for (const d of longos) tomar(d, false);
    if (tomados.length) for (const d of curtos) tomar(d, true);
    if (!tomados.length) continue;
    tomados.sort((a, b) => a.ini - b.ini);
    let modelo = "";
    let ult = 0;
    for (const t of tomados) {
      modelo += valor.slice(ult, t.ini) + `{${t.k}}`;
      ult = t.fim;
    }
    regras[campo] = modelo + valor.slice(ult);
  }
  return regras;
}

/** Aplica as regras aos documentos de uma remessa nova. */
export function aplicar(regras: Regras, fontes: Fonte[]): { valores: Partial<Record<CampoModelo, string>>; faltando: string[] } {
  const dados = dadosDasFontes(fontes);
  const valores: Partial<Record<CampoModelo, string>> = {};
  const faltando = new Set<string>();
  for (const [campo, modelo] of Object.entries(regras) as [CampoModelo, string][]) {
    let falta = false;
    const v = modelo.replace(/\{([^}]+)\}/g, (_, k: string) => {
      const d = valorDaChave(dados, k);
      if (d == null) {
        falta = true;
        faltando.add(k.replace(/#.*$/, ""));
        return "";
      }
      return d;
    });
    valores[campo] = falta && !v.replace(/[\s–:/,.-]/g, "") ? "" : v.split("\n").map((l) => l.replace(/[ \t]{2,}/g, " ").trim()).join("\n").trim();
  }
  return { valores, faltando: [...faltando] };
}

/** "{nfe.razao} – CNPJ {nfe.cnpj}" -> "[razão social da NF-e] – CNPJ [CNPJ da NF-e]" (para mostrar). */
export function regraLegivel(modelo: string): string {
  const NOMES: Record<string, string> = {
    "nfe.numero": "nº da NF-e", "nfe.emissao": "emissão da NF-e", "nfe.razao": "razão social (NF-e)", "nfe.cnpj": "CNPJ (NF-e)",
    "nfe.endereco": "endereço (NF-e)", "nfe.bairro": "bairro (NF-e)", "nfe.cep": "CEP (NF-e)", "nfe.municipio": "município (NF-e)",
    "nfe.uf": "UF (NF-e)", "nfe.quantidade": "quantidade total (NF-e)", "nfe.pesoBruto": "peso bruto (NF-e)", "nfe.pesoLiquido": "peso líquido (NF-e)",
  };
  const TIPOS: Record<string, string> = { bl: "BL", booking: "booking", invoice: "invoice", packing: "packing list", outro: "documento" };
  return modelo.replace(/\{([^}]+)\}/g, (_, chave: string) => {
    const [k, corte] = chave.split("#");
    const parte = corte ? " (parte)" : "";
    if (NOMES[k]) return `[${NOMES[k]}${parte}]`;
    const item = k.match(/^nfe\.(item|qtd)(\d+)$/);
    if (item) return `[${item[1] === "item" ? "descrição" : "quantidade"} do item ${item[2]} (NF-e)${parte}]`;
    const g = k.match(/^(\w+):(.+)$/);
    return g ? `[“${g[2]}” no ${TIPOS[g[1]] ?? g[1]}${parte}]` : `[${k}]`;
  });
}
