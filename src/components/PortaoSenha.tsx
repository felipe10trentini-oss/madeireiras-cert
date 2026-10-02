"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useSenhaEquipe, type SessaoCliente } from "@/lib/senhaEquipe";

interface Props {
  titulo: string;
  /** Página restrita: entra o master ou o colaborador com a permissão marcada na controladoria. */
  pagina?: "controladoria" | "madeireiras";
  children: (senha: string, sair: () => void, sessao: SessaoCliente) => ReactNode;
}

/** Só mostra o conteúdo depois do login do operador (cada emissão fica registrada no nome dele). */
export function PortaoSenha({ titulo, pagina, children }: Props) {
  const { senha, sessao, pronto, definir } = useSenhaEquipe();
  const [login, setLogin] = useState("");
  const [digitada, setDigitada] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setVerificando(true);
    setErro(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, senha: digitada }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        definir({ token: data.token, sessao: data.sessao });
        setDigitada("");
      } else setErro(data.error ?? "Login ou senha incorretos.");
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setVerificando(false);
    }
  }

  if (!pronto) return null;
  const sair = () => definir(null);
  const liberado = !!sessao && (!pagina || sessao.perfil === "master" || !!sessao.acessos?.[pagina]);
  if (senha && sessao && liberado) return <>{children(senha, sair, sessao)}</>;

  return (
    <form className="card view" onSubmit={entrar} style={{ maxWidth: 420, margin: "24px auto" }}>
      <h2 style={{ fontSize: 20, margin: "0 0 6px" }}>{titulo}</h2>
      <p className="lead" style={{ marginBottom: 14 }}>
        {pagina
          ? sessao
            ? `Você entrou como ${sessao.nome}, sem permissão para esta página. Peça a liberação na controladoria (Editar > Acessos) e entre de novo, ou use outro login.`
            : "Entre com um login que tenha permissão para esta página."
          : "Entre com o seu login: os certificados ficam registrados no seu nome."}
      </p>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="login-operador">Login</label>
        <input
          id="login-operador"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="senha-operador">Senha</label>
        <input
          id="senha-operador"
          type="password"
          autoComplete="current-password"
          value={digitada}
          onChange={(e) => setDigitada(e.target.value)}
        />
      </div>
      {erro && <p style={{ color: "var(--bad)", fontSize: 13, margin: "0 0 10px" }}>{erro}</p>}
      <button type="submit" className="btn primary" disabled={verificando || !digitada || !login} style={{ width: "100%" }}>
        {verificando ? "Verificando…" : "Entrar"}
      </button>
    </form>
  );
}
