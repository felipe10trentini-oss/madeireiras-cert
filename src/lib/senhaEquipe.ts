"use client";

import { useCallback, useSyncExternalStore } from "react";

// Sessão do operador logado (token assinado pelo servidor + nome e perfil), guardada no
// navegador até expirar (12 h). O "senha" que os componentes recebem é o token.
const CHAVE = "sessao-operador";

export interface SessaoCliente {
  login: string;
  nome: string;
  perfil: "operador" | "engenheiro" | "master";
  acessos?: { controladoria: boolean; madeireiras: boolean };
  exp: number;
}

interface Guardada {
  token: string;
  sessao: SessaoCliente;
}

// Navegador sem localStorage: a sessão vale só nesta página (fica em memória).
let semStorage = false;
let memoria: Guardada | null = null;

// Último valor lido: o snapshot do useSyncExternalStore precisa ser o mesmo objeto enquanto
// o localStorage não muda (e a sessão não expira).
let ultimoCru: string | null | undefined;
let ultimo: Guardada | null = null;

function ler(): Guardada | null {
  if (semStorage) return memoria;
  let cru: string | null;
  try {
    cru = localStorage.getItem(CHAVE);
  } catch {
    return memoria;
  }
  if (cru === ultimoCru && (!ultimo || ultimo.sessao.exp > Date.now())) return ultimo;
  ultimoCru = cru;
  try {
    const g = JSON.parse(cru ?? "null") as Guardada | null;
    ultimo = g && g.sessao?.exp > Date.now() ? g : null;
  } catch {
    ultimo = null;
  }
  return ultimo;
}

/** Login/saída em outra aba (storage) ou em outro componente desta página (sessao-operador). */
function assinar(aoMudar: () => void): () => void {
  window.addEventListener("storage", aoMudar);
  window.addEventListener("sessao-operador", aoMudar);
  return () => {
    window.removeEventListener("storage", aoMudar);
    window.removeEventListener("sessao-operador", aoMudar);
  };
}

const semAssinatura = () => () => {};

export function useSenhaEquipe() {
  // No servidor e na hidratação: sem sessão e "pronto" falso; depois, o valor do navegador.
  const atual = useSyncExternalStore(assinar, ler, () => null);
  const pronto = useSyncExternalStore(semAssinatura, () => true, () => false);

  const definir = useCallback((g: Guardada | null) => {
    try {
      if (g) localStorage.setItem(CHAVE, JSON.stringify(g));
      else localStorage.removeItem(CHAVE);
    } catch {
      // navegador sem localStorage: a sessão vale só nesta página
      semStorage = true;
      memoria = g;
    }
    window.dispatchEvent(new Event("sessao-operador"));
  }, []);

  return { senha: atual?.token ?? null, sessao: atual?.sessao ?? null, pronto, definir };
}

export function cabecalhoSenha(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
