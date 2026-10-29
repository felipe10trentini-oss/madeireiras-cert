// Último comunicado emitido, lido da pasta da empresa no computador (a "Madeireiras 2" do OneDrive): o
// navegador (Chrome/Edge) lê os nomes dos PDFs "COMUNICADO 363-2026- MADEPALLETE….pdf" e o número do Excel
// "COMUNICADO 001-2026….xlsx" da pasta da empresa. Assim o número segue certo mesmo quando alguém emitiu
// pelo Excel ou no outro computador. A pasta escolhida fica lembrada neste navegador (IndexedDB); nada sai
// do computador. Roda no navegador.
import { lerModeloComunicado } from "./comunicadoModelo";
import type { Madeireira } from "./madeireiras";
import { relatorioDaEmpresa } from "./relatorioSei";

// Tipos mínimos da File System Access API (não estão em todos os "lib" do TypeScript).
interface Entrada {
  kind: "file" | "directory";
  name: string;
}
export interface Pasta extends Entrada {
  kind: "directory";
  values(): AsyncIterable<Entrada>;
  queryPermission?(o: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" }): Promise<PermissionState>;
}
interface Arquivo extends Entrada {
  kind: "file";
  getFile(): Promise<File>;
}

export const pastaSuportada = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

const BANCO = "comunicados";
function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("pasta");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}

/** Pasta lembrada neste navegador (ou null). */
export async function pastaLembrada(): Promise<Pasta | null> {
  try {
    const db = await abrirBanco();
    return await new Promise((ok) => {
      const r = db.transaction("pasta").objectStore("pasta").get("raiz");
      r.onsuccess = () => ok((r.result as Pasta) ?? null);
      r.onerror = () => ok(null);
    });
  } catch {
    return null;
  }
}

/** Pede ao usuário a pasta "Madeireiras 2" e lembra dela. */
export async function escolherPasta(): Promise<Pasta | null> {
  const w = window as unknown as { showDirectoryPicker(o: object): Promise<Pasta> };
  const p = await w.showDirectoryPicker({ id: "madeireiras", mode: "read" });
  try {
    const db = await abrirBanco();
    db.transaction("pasta", "readwrite").objectStore("pasta").put(p, "raiz");
  } catch {
    // sem IndexedDB: vale só nesta visita
  }
  return p;
}

/** "granted" quando já pode ler; "prompt" pede um clique (o navegador exige) para liberar. */
export async function permissao(p: Pasta, pedir = false): Promise<PermissionState> {
  try {
    if (pedir && p.requestPermission) return await p.requestPermission({ mode: "read" });
    return (await p.queryPermission?.({ mode: "read" })) ?? "granted";
  } catch {
    return "denied";
  }
}

/** "363/2026" -> [2026, 363] para comparar. */
const chaveNumero = (n: string | null | undefined): [number, number] | null => {
  const m = (n ?? "").match(/(\d{1,5})\s*[/-]\s*(\d{2,4})/);
  if (!m) return null;
  return [m[2].length === 2 ? 2000 + +m[2] : +m[2], +m[1]];
};

/** O maior de dois números de comunicado ("363/2026" > "362/2026"; ano novo ganha). */
export function maiorNumero(a: string | null | undefined, b: string | null | undefined): string | null {
  const ka = chaveNumero(a);
  const kb = chaveNumero(b);
  if (!ka) return kb ? b! : null;
  if (!kb) return a!;
  return kb[0] > ka[0] || (kb[0] === ka[0] && kb[1] > ka[1]) ? b! : a!;
}

export interface UltimoDaPasta {
  pasta: string;
  numero: string | null;
  arquivo: string | null;
}

/**
 * Acha a pasta da empresa (pelo nome, como no Controle de Curvas) e o maior número de comunicado nela e nas
 * subpastas (até 2 níveis: "Comunicados", "Caminhao 0649"). PDFs pelo nome; o Excel pelo número de dentro.
 */
export async function ultimoDaPasta(raiz: Pasta, empresa: Madeireira): Promise<UltimoDaPasta | null> {
  const subpastas: Pasta[] = [];
  for await (const e of raiz.values()) if (e.kind === "directory") subpastas.push(e as Pasta);
  const achada = relatorioDaEmpresa(
    empresa,
    subpastas.map((p) => ({ empresa: p.name, pasta: p.name, relatorio: p.name }))
  );
  const pasta = achada && subpastas.find((p) => p.name === achada.numero);
  if (!pasta) return null;
  let melhor: string | null = null;
  let arquivo: string | null = null;
  const anoAtual = new Date().getFullYear();
  const olhar = async (dir: Pasta, nivel: number) => {
    for await (const e of dir.values()) {
      if (e.kind === "directory") {
        if (nivel < 2) await olhar(e as Pasta, nivel + 1);
        continue;
      }
      if (/^~\$/.test(e.name) || !/^COMUNICADO\b/i.test(e.name)) continue;
      let numero: string | null = null;
      if (/\.pdf$/i.test(e.name)) {
        const m = e.name.match(/^COMUNICADO\s*(?:N[º°o]\s*)?(\d{1,5})\s*[-_]\s*(\d{4}|\d{2})(?!\d)/i);
        if (m) numero = `${m[1]}/${m[2].length === 2 ? `20${m[2]}` : m[2]}`;
      } else if (/\.xlsx$/i.test(e.name)) {
        // O Excel modelo fica com o último emitido dentro (o nome é sempre "001").
        try {
          const f = await (e as Arquivo).getFile();
          numero = (await lerModeloComunicado(await f.arrayBuffer())).campos.numero?.valor ?? null;
        } catch {
          numero = null;
        }
      }
      // Só o ano corrente (pasta com PDFs antigos de outros anos não atrapalha).
      if (!numero || chaveNumero(numero)?.[0] !== anoAtual) continue;
      if (maiorNumero(melhor, numero) === numero && numero !== melhor) {
        melhor = numero;
        arquivo = e.name;
      }
    }
  };
  await olhar(pasta, 1);
  return { pasta: pasta.name, numero: melhor, arquivo };
}
