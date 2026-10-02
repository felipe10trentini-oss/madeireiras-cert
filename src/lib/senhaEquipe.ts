"use client";

import { useCallback, useEffect, useState } from "react";

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

function ler(): Guardada | null {
  try {
    const g = JSON.parse(localStorage.getItem(CHAVE) ?? "null") as Guardada | null;
    return g && g.sessao?.exp > Date.now() ? g : null;
  } catch {
    return null;
  }
}

export function useSenhaEquipe() {
  const [atual, setAtual] = useState<Guardada | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    setAtual(ler());
    setPronto(true);
    // Login/saída em outra aba (storage) ou em outro componente desta página (sessao-operador).
    const aoMudar = () => setAtual(ler());
    window.addEventListener("storage", aoMudar);
    window.addEventListener("sessao-operador", aoMudar);
    return () => {
      window.removeEventListener("storage", aoMudar);
      window.removeEventListener("sessao-operador", aoMudar);
    };
  }, []);

  const definir = useCallback((g: Guardada | null) => {
    setAtual(g);
    try {
      if (g) localStorage.setItem(CHAVE, JSON.stringify(g));
      else localStorage.removeItem(CHAVE);
    } catch {
      // navegador sem localStorage: a sessão vale só nesta página
    }
    window.dispatchEvent(new Event("sessao-operador"));
  }, []);

  return { senha: atual?.token ?? null, sessao: atual?.sessao ?? null, pronto, definir };
}

export function cabecalhoSenha(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
