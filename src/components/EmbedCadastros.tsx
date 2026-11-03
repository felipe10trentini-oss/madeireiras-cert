"use client";

import { useEffect, type ReactNode } from "react";
import { useSenhaEquipe, type SessaoCliente } from "@/lib/senhaEquipe";

// A aba Cadastros também abre dentro do Controle de Curvas (iframe em /madeireiras?embed=1), com o
// mesmo login de lá: o token chega por postMessage, nunca pela URL. Só o Controle de Curvas pode
// enviar (e o CSP de next.config.ts só deixa ele abrir a página); o servidor continua conferindo a
// assinatura do token em cada pedido.
const ORIGEM_CURVAS = "https://controle-curvas.vercel.app";

/** Corpo do token (nome e perfil, só para a tela). */
function sessaoDoToken(token: string): SessaoCliente | null {
  try {
    const b64 = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as SessaoCliente;
  } catch {
    return null;
  }
}

export function EmbedCadastros({ children }: { children: ReactNode }) {
  const { definir } = useSenhaEquipe();

  useEffect(() => {
    const embutida = window.parent !== window && new URLSearchParams(window.location.search).has("embed");
    if (!embutida) return;
    document.documentElement.classList.add("embed");
    const aoReceber = (ev: MessageEvent) => {
      if (ev.origin !== ORIGEM_CURVAS || ev.source !== window.parent) return;
      const token: unknown = ev.data?.token;
      if (ev.data?.tipo !== "sessao" || typeof token !== "string") return;
      const sessao = sessaoDoToken(token);
      if (sessao) definir({ token, sessao });
      window.parent.postMessage({ tipo: "cadastros-pronto" }, ORIGEM_CURVAS);
    };
    window.addEventListener("message", aoReceber);
    window.parent.postMessage({ tipo: "cadastros-carregado" }, ORIGEM_CURVAS);
    return () => window.removeEventListener("message", aoReceber);
  }, [definir]);

  return <>{children}</>;
}
