"use client";

// Busca do Recibo Eletrônico de Protocolo na pasta "Madeireiras 2" do OneDrive, direto do
// navegador (Chrome/Edge: File System Access API). O colaborador autoriza a pasta uma vez; o
// acesso fica guardado no navegador (IndexedDB) e o site procura sozinho, na pasta da empresa,
// o recibo da programação do mês ou do comunicado. Nada é enviado além do PDF do recibo achado.
import type { Madeireira } from "./madeireiras";
import { reciboEhDaProgramacao, reciboEhDoComunicado, type Recibo } from "./recibo";
import { cabecalhoSenha } from "./senhaEquipe";
import { chaveNome, soDigitos } from "./util";

/* eslint-disable @typescript-eslint/no-explicit-any -- API do navegador ainda fora do lib.dom do TypeScript */
type Pasta = FileSystemDirectoryHandle;

export const suportaPastas = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

// ---------- pasta guardada (IndexedDB) ----------

function banco(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const r = indexedDB.open("madeireiras-cert", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pastas");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}

async function guardar(chave: string, valor: unknown): Promise<void> {
  const db = await banco();
  await new Promise<void>((ok, erro) => {
    const tx = db.transaction("pastas", "readwrite");
    tx.objectStore("pastas").put(valor, chave);
    tx.oncomplete = () => ok();
    tx.onerror = () => erro(tx.error);
  });
}

async function ler<T>(chave: string): Promise<T | null> {
  const db = await banco();
  return new Promise((ok) => {
    const r = db.transaction("pastas").objectStore("pastas").get(chave);
    r.onsuccess = () => ok((r.result as T) ?? null);
    r.onerror = () => ok(null);
  });
}

export async function pastaGuardada(): Promise<Pasta | null> {
  try {
    return await ler<Pasta>("madeireiras2");
  } catch {
    return null;
  }
}

/** Abre o seletor de pasta (precisa de um clique do usuário) e guarda a escolhida. */
export async function escolherPasta(): Promise<Pasta> {
  const p: Pasta = await (window as any).showDirectoryPicker({ id: "madeireiras2", mode: "read" });
  await guardar("madeireiras2", p);
  return p;
}

/** "granted" | "prompt" | "denied". Com `pedir`, mostra o pedido do navegador (exige clique). */
export async function permissao(p: Pasta, pedir = false): Promise<string> {
  const h = p as any;
  const atual: string = await h.queryPermission({ mode: "read" });
  if (atual === "granted" || !pedir) return atual;
  return h.requestPermission({ mode: "read" });
}

// ---------- pasta da empresa ----------

const GENERICAS = new Set(["MADEIRAS", "MADEIRA", "MAD", "LTDA", "IND", "COM", "EMBALAGENS", "INDUSTRIA", "COMERCIO", "EIRELI", "ME", "SA", "DE", "DA", "DO", "E"]);
const palavras = (s: string | null | undefined) =>
  (s ?? "")
    .split(/[\s\-–_().,/]+/)
    .map(chaveNome)
    .filter((p) => p.length >= 2 && !GENERICAS.has(p));

async function subpastas(p: Pasta): Promise<Pasta[]> {
  const r: Pasta[] = [];
  for await (const h of (p as any).values()) if (h.kind === "directory") r.push(h);
  return r;
}

const CHAVE_LOCAL = "pasta-empresa";
const pastasEscolhidas = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_LOCAL) ?? "{}");
  } catch {
    return {};
  }
};

/** Guarda a pasta escolhida à mão para a empresa (neste navegador). */
export function lembrarPastaDaEmpresa(cnpj: string, nome: string): void {
  try {
    localStorage.setItem(CHAVE_LOCAL, JSON.stringify({ ...pastasEscolhidas(), [soDigitos(cnpj)]: nome }));
  } catch {
    // sem localStorage: escolhe de novo da próxima vez
  }
}

/** Nomes das pastas das empresas (para escolher à mão). */
export async function nomesDasPastas(raiz: Pasta): Promise<string[]> {
  return (await subpastas(raiz)).map((p) => p.name).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Pasta da empresa: a escolhida antes, ou a de nome mais parecido com o apelido ("Mart Madeiras" ~ "MART"). */
export async function pastaDaEmpresa(raiz: Pasta, empresa: Pick<Madeireira, "apelido" | "razaoSocial" | "cnpj">): Promise<Pasta | null> {
  const todas = await subpastas(raiz);
  const escolhida = pastasEscolhidas()[soDigitos(empresa.cnpj)];
  if (escolhida) {
    const p = todas.find((x) => x.name === escolhida);
    if (p) return p;
  }
  const ap = palavras(empresa.apelido);
  const rz = palavras(empresa.razaoSocial);
  let melhor: { p: Pasta; s: number } | null = null;
  for (const p of todas) {
    const n = palavras(p.name);
    if (!n.length) continue;
    const casa = (w: string) => n.some((x) => x === w || (w.length >= 4 && x.length >= 4 && (x.startsWith(w) || w.startsWith(x))));
    const sAp = ap.filter(casa).length;
    if (!sAp) continue;
    // Todas as palavras do apelido batendo pesa mais; palavras sobrando na pasta pesam contra
    // ("Inexport" x "Inexport - Capivari").
    const s = sAp * 10 + (sAp === ap.length ? 5 : 0) + rz.filter(casa).length - n.filter((x) => !ap.includes(x)).length * 0.5;
    if (!melhor || s > melhor.s) melhor = { p, s };
  }
  return melhor?.p ?? null;
}

// ---------- busca do recibo ----------

const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
// Pastas que não têm recibo de comunicado/programação (ou têm milhares de outros recibos).
const PULAR = /curva|calibra|backup|imagens?$|attach|modelo|antig|notas?\s*fisc|^nf|desmembr|desdobr|consolid|relat[oó]rio|planilha/i;

/** "15/10/2026" -> mês 9 (0–11) e ano. */
const mesAno = (data: string) => {
  const [, mm, aaaa] = data.split("/");
  return { mes: parseInt(mm, 10) - 1, ano: aaaa };
};

/** Pasta de ano ("2025") ou de mês ("10. Outubro"): só entra se for perto da data do tratamento. */
function pastaDoPeriodo(nome: string, data: string): boolean {
  const { mes, ano } = mesAno(data);
  if (/^\s*(19|20)\d{2}\s*$/.test(nome)) return nome.trim() === ano;
  const n = chaveNome(nome);
  const i = MESES.findIndex((m) => n.includes(m));
  if (i < 0) return true;
  return Math.abs(i - mes) <= 1 || Math.abs(i - mes) === 11;
}

interface Candidato {
  arq: FileSystemFileHandle;
  caminho: string;
}

async function recibosNaPasta(p: Pasta, data: string, profundidade: number, entrar: (nome: string, nivel: number) => boolean): Promise<Candidato[]> {
  const achados: Candidato[] = [];
  let visitadas = 0;
  const andar = async (dir: Pasta, caminho: string, nivel: number) => {
    if (++visitadas > 400) return;
    for await (const h of (dir as any).values()) {
      if (h.kind === "file") {
        if (/recibo/i.test(h.name) && /\.pdf$/i.test(h.name)) achados.push({ arq: h, caminho: `${caminho}${h.name}` });
      } else if (nivel < profundidade && !PULAR.test(h.name) && pastaDoPeriodo(h.name, data) && entrar(h.name, nivel + 1)) {
        await andar(h, `${caminho}${h.name}/`, nivel + 1);
      }
    }
  };
  await andar(p, "", 0);
  return achados;
}

async function lerReciboNoServidor(senha: string, arquivo: File): Promise<Recibo | null> {
  const form = new FormData();
  form.append("arquivo", arquivo);
  const res = await fetch("/api/recibo", { method: "POST", headers: cabecalhoSenha(senha), body: form });
  if (!res.ok) return null;
  return (await res.json()).recibo ?? null;
}

export interface ReciboAchado {
  recibo: Recibo;
  caminho: string;
}

/**
 * Procura o recibo na pasta da empresa. Comunicado: pelo número ("104/2026"); programação: pelo
 * mês (ou trimestre) da data de início do tratamento. Lê no máximo 12 recibos, os mais prováveis
 * primeiro (nome com o número/mês, data do arquivo perto da do tratamento).
 */
export async function buscarRecibo(args: {
  senha: string;
  pasta: Pasta;
  tipo: "comunicado" | "programacao";
  data: string; // início do tratamento, dd/mm/aaaa
  numeroComunicado?: string | null;
  trimestral?: boolean;
  onProgresso?: (msg: string) => void;
}): Promise<ReciboAchado | null> {
  const { senha, pasta, tipo, data, numeroComunicado, trimestral } = args;
  const { mes } = mesAno(data);
  const candidatos =
    tipo === "programacao"
      ? await recibosNaPasta(pasta, data, 3, (nome, nivel) => nivel > 1 || /program/i.test(nome))
      : await recibosNaPasta(pasta, data, 4, () => true);
  args.onProgresso?.(`${candidatos.length} recibo(s) na pasta “${pasta.name}”…`);

  const [d, m, a] = data.split("/").map(Number);
  const alvo = Date.UTC(a, m - 1, d);
  const num = numeroComunicado?.match(/\d+/)?.[0];
  // 1º pelo nome (número do comunicado / mês da programação), depois pela data do arquivo — só
  // dos 80 primeiros, para não abrir milhares de arquivos do OneDrive.
  const peloNome = (c: Candidato) => {
    let s = 0;
    if (tipo === "comunicado" && num && new RegExp(`(^|\\D)0*${parseInt(num, 10)}(\\D|$)`).test(c.arq.name)) s += 100;
    if (tipo === "comunicado" && /comunica/i.test(c.caminho)) s += 20;
    if (tipo === "programacao" && chaveNome(c.caminho).includes(MESES[mes])) s += 100;
    return s;
  };
  const pelaData = async (c: Candidato) => {
    const f = await c.arq.getFile();
    return { c, f, s: peloNome(c) - Math.min(Math.abs(f.lastModified - alvo) / 86400_000, 365) };
  };
  const primeiros = [...candidatos].sort((x, y) => peloNome(y) - peloNome(x)).slice(0, 80);
  const pontuados = (await Promise.all(primeiros.map(pelaData))).sort((x, y) => y.s - x.s);
  for (const { c, f } of pontuados.slice(0, 12)) {
    args.onProgresso?.(`Lendo ${c.caminho}…`);
    const r = await lerReciboNoServidor(senha, f).catch(() => null);
    if (!r) continue;
    const ok = tipo === "comunicado" ? !!numeroComunicado && reciboEhDoComunicado(r, numeroComunicado) : reciboEhDaProgramacao(r, data, trimestral);
    if (ok) return { recibo: r, caminho: `${pasta.name}/${c.caminho}` };
  }
  return null;
}
