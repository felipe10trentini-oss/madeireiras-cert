"use client";

import { useSenhaEquipe } from "@/lib/senhaEquipe";

/** Operador logado, no canto superior direito do site. */
export function Usuario() {
  const { sessao, definir } = useSenhaEquipe();
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
        onClick={() => {
          definir(null);
          window.location.reload();
        }}
      >
        Sair
      </button>
    </div>
  );
}
