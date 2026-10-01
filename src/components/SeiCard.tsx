"use client";

import { useEffect, useState } from "react";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import type { ValoresCertificado } from "@/lib/modelos";
import { cabecalhoSenha } from "@/lib/senhaEquipe";

interface Acesso {
  nome: string;
  login: string;
  senha: string;
  certeza: "alta" | "media";
}

interface Props {
  senha: string;
  empresa: MadeireiraSalva;
  valores: ValoresCertificado | null;
  onToast: (msg: string) => void;
}

/**
 * Dados para o peticionamento no SEI, com botão de copiar: CNPJ e razão social (do prestador do
 * certificado — na Inexport Capivari, a matriz) e o login/senha do SEI do RT da empresa, para não
 * peticionar com o RT errado.
 */
export function SeiCard({ senha, empresa, valores, onToast }: Props) {
  const [dados, setDados] = useState<{ rt: string | null; acesso: Acesso | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    setMostrar(false);
    fetch(`/api/madeireiras/sei?cnpj=${encodeURIComponent(empresa.cnpj)}`, { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (res.ok) setDados(d);
        else setErro(d.error ?? "Não foi possível consultar o acesso do SEI.");
      })
      .catch(() => vivo && setErro("Não foi possível conectar ao servidor."));
    return () => {
      vivo = false;
    };
  }, [empresa.cnpj, senha]);

  async function copiar(rotulo: string, valor: string | null | undefined) {
    if (!valor) return;
    try {
      await navigator.clipboard.writeText(valor);
      onToast(`${rotulo} copiado.`);
    } catch {
      onToast("Não foi possível copiar. Permita o acesso à área de transferência.");
    }
  }

  const cnpj = valores?.cnpj || empresa.cnpj;
  const razao = valores?.razao || empresa.razaoSocial;
  const a = dados?.acesso;
  const linhas: { rotulo: string; valor: string | null | undefined; secreto?: boolean }[] = [
    { rotulo: "CNPJ", valor: cnpj },
    { rotulo: "Razão social", valor: razao },
    { rotulo: "E-mail do RT no SEI", valor: a?.login },
    { rotulo: "Senha do RT no SEI", valor: a?.senha, secreto: true },
  ];

  return (
    <div className="card sei-card" style={{ marginBottom: 14 }}>
      <div className="kpi-label">
        Dados para o SEI · RT: {a?.nome ?? dados?.rt ?? empresa.rt ?? "—"}
        {a?.certeza === "media" && <span className="kpi-sub"> (confira: achado só pelo primeiro nome)</span>}
      </div>
      <div className="sei-grid">
        {linhas.map((l) => (
          <div className="sei-item" key={l.rotulo}>
            <span className="kpi-sub">{l.rotulo}</span>
            <span className="mono sei-valor">{l.valor ? (l.secreto && !mostrar ? "••••••••" : l.valor) : "—"}</span>
            <span className="sei-botoes">
              {l.secreto && l.valor && (
                <button type="button" className="link" onClick={() => setMostrar((m) => !m)}>
                  {mostrar ? "ocultar" : "mostrar"}
                </button>
              )}
              <button type="button" className="btn" disabled={!l.valor} onClick={() => copiar(l.rotulo, l.valor)}>
                Copiar
              </button>
            </span>
          </div>
        ))}
      </div>
      {erro && <p className="hint">{erro}</p>}
      {dados && !a && (
        <p className="hint">
          Não achei o acesso do SEI de {dados.rt ?? "o RT"}. Envie a Planilha Geral na aba Madeireiras e clique em “Atualizar acessos
          do SEI” (aba ACESSO SEI).
        </p>
      )}
    </div>
  );
}
