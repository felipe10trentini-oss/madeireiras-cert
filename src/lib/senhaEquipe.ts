"use client";

import { useCallback, useEffect, useState } from "react";

const CHAVE = "senha-equipe";

/** Senha da equipe guardada só na aba do navegador (sessionStorage), até haver login por usuário. */
export function useSenhaEquipe() {
  const [senha, setSenhaState] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    try {
      setSenhaState(sessionStorage.getItem(CHAVE));
    } catch {
      // navegador sem sessionStorage: o usuário digita a senha a cada visita
    }
    setPronto(true);
  }, []);

  const definir = useCallback((s: string | null) => {
    setSenhaState(s);
    try {
      if (s) sessionStorage.setItem(CHAVE, s);
      else sessionStorage.removeItem(CHAVE);
    } catch {
      // ignora
    }
  }, []);

  return { senha, pronto, definir };
}

export function cabecalhoSenha(senha: string | null): HeadersInit {
  return senha ? { "x-team-password": senha } : {};
}
