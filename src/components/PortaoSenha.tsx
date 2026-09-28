"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { cabecalhoSenha, useSenhaEquipe } from "@/lib/senhaEquipe";

interface Props {
  titulo: string;
  children: (senha: string, sair: () => void) => ReactNode;
}

/** Só mostra o conteúdo depois que a senha da equipe for validada no servidor. */
export function PortaoSenha({ titulo, children }: Props) {
  const { senha, pronto, definir } = useSenhaEquipe();
  const [digitada, setDigitada] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setVerificando(true);
    setErro(null);
    try {
      const res = await fetch("/api/auth", { method: "POST", headers: cabecalhoSenha(digitada) });
      if (res.ok) definir(digitada);
      else setErro("Senha da equipe incorreta.");
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setVerificando(false);
    }
  }

  if (!pronto) return null;
  if (senha) return <>{children(senha, () => definir(null))}</>;

  return (
    <form className="card view" onSubmit={entrar} style={{ maxWidth: 420, margin: "24px auto" }}>
      <h2 style={{ fontSize: 20, margin: "0 0 6px" }}>{titulo}</h2>
      <p className="lead" style={{ marginBottom: 14 }}>
        Digite a senha da equipe para continuar.
      </p>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="senha-equipe">Senha da equipe</label>
        <input
          id="senha-equipe"
          type="password"
          autoComplete="current-password"
          value={digitada}
          onChange={(e) => setDigitada(e.target.value)}
        />
      </div>
      {erro && <p style={{ color: "var(--bad)", fontSize: 13, margin: "0 0 10px" }}>{erro}</p>}
      <button type="submit" className="btn primary" disabled={verificando || !digitada} style={{ width: "100%" }}>
        {verificando ? "Verificando…" : "Entrar"}
      </button>
    </form>
  );
}
