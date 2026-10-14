"use client";

import { useEffect } from "react";
import { cabecalhoSenha, useSenhaEquipe } from "@/lib/senhaEquipe";

/** Sinal de presença (controladoria: quem está online) a cada minuto enquanto o site está aberto. */
const PRESENCA_MS = 60 * 1000;

/** Operador logado, no canto superior direito do site. */
export function Usuario() {
  const { senha, sessao, definir } = useSenhaEquipe();

  useEffect(() => {
    if (!senha) return;
    const avisar = () => {
      if (document.visibilityState === "hidden") return;
      void fetch("/api/presenca", { method: "POST", headers: cabecalhoSenha(senha) }).catch(() => undefined);
    };
    avisar();
    const t = setInterval(avisar, PRESENCA_MS);
    document.addEventListener("visibilitychange", avisar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", avisar);
    };
  }, [senha]);

  if (!sessao) return null;
  return (
    <div className="usuario-topo">
      <span className="usuario-icone" aria-hidden="true">
        {sessao.nome.trim().charAt(0).toUpperCase()}
      </span>
      <span className="usuario-nome" title={sessao.login}>
        {sessao.nome}
        {sessao.perfil === "master" ? <small> · controladoria</small> : sessao.perfil === "engenheiro" ? <small> · engenheiro(a)</small> : null}
      </span>
      <button
        type="button"
        className="link"
        onClick={async () => {
          // Fica offline na controladoria na hora (sem esperar os 2 minutos sem sinal).
          await fetch("/api/presenca", { method: "DELETE", headers: cabecalhoSenha(senha) }).catch(() => undefined);
          definir(null);
          window.location.reload();
        }}
      >
        Sair
      </button>
    </div>
  );
}
