"use client";

import { useEffect, useRef, useState } from "react";
import { analisarModelo } from "@/lib/preencherModelo";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { PreviaWord } from "./PreviaWord";
import { SoltarArquivos } from "./SoltarArquivos";

export interface ModeloSalvo {
  salvo: boolean;
  nomeModelo: string | null;
  atualizado: string | null;
  bytes: Uint8Array | null;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Modelo da declaração da empresa: o Word que ela já usa. O site guarda o arquivo e, em cada
 * declaração, troca só os dados; mudou o layout, é só carregar o Word novo aqui.
 */
export function ModeloDeclaracao({
  senha,
  cnpj,
  nome,
  atual,
  arquivoInicial,
  onSalvo,
  onFechar,
}: {
  senha: string;
  cnpj: string;
  nome: string;
  atual: ModeloSalvo | null;
  /** Word solto na área principal da aba: já entra aqui. */
  arquivoInicial?: File | null;
  onSalvo: () => void;
  onFechar: () => void;
}) {
  const [arquivo, setArquivo] = useState<{ nome: string; bytes: Uint8Array } | null>(null);
  const [analise, setAnalise] = useState<{ campos: string[]; tabela: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function escolher(f: File | null) {
    setMsg(null);
    setAnalise(null);
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) return setMsg("Envie o Word (.docx). Arquivo .doc antigo: abra no Word e salve como .docx.");
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      setAnalise(await analisarModelo(bytes));
      setArquivo({ nome: f.name, bytes });
    } catch {
      setMsg("Não consegui abrir este Word.");
    }
  }

  // Word que veio solto na área principal: lê uma vez ao abrir.
  const lido = useRef<File | null>(null);
  useEffect(() => {
    if (arquivoInicial && lido.current !== arquivoInicial) {
      lido.current = arquivoInicial;
      void escolher(arquivoInicial);
    }
  });

  async function salvar() {
    if (!arquivo) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/declaracoes/modelo", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj, nome: arquivo.nome, modelo: base64(arquivo.bytes) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Não foi possível salvar.");
      onSalvo();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--accent)" }}>
      <div className="kpi-label">Modelo da declaração · {nome}</div>
      <p className="hint" style={{ marginTop: 4 }}>
        Carregue o <b>Word</b> de uma declaração que vocês já fazem para esta empresa. As declarações vão sair desse Word, iguais a ele: o site
        só troca os dados (cliente, lotes, quantidade, datas, NF). Mudou o layout? Carregue o Word novo aqui.
        {atual?.salvo && ` Modelo atual: “${atual.nomeModelo ?? "modelo.docx"}”${atual.atualizado ? ` (${new Date(atual.atualizado).toLocaleDateString("pt-BR")})` : ""}.`}
      </p>
      <div style={{ marginTop: 8 }}>
        <SoltarArquivos
          titulo={arquivo ? "Trocar o Word" : "Arraste o Word do modelo"}
          dica={arquivo ? arquivo.nome : "Solte aqui o .docx da declaração (ou clique para escolher)."}
          accept=".docx"
          multiplos={false}
          onArquivos={(fs) => void escolher(fs[0] ?? null)}
        />
      </div>
      {msg && <p className="hint">{msg}</p>}

      {analise && (
        <div className={`alert-box${analise.campos.length ? "" : " critical"}`} style={{ marginTop: 10 }}>
          <h4>{analise.campos.length ? "O que o site vai preencher neste Word" : "Não reconheci os campos"}</h4>
          <ul>
            <li>{analise.campos.length ? analise.campos.join(" · ") : "Nenhum rótulo conhecido (ex.: “EXPORTADOR/SHIPPER:”)."}</li>
            <li>{analise.tabela ? "Tabela do tratamento: as linhas viram uma por ciclo." : "Sem tabela do tratamento (início/término)."}</li>
            <li>O resto do Word (timbre, textos, assinatura, logo) fica igual.</li>
          </ul>
        </div>
      )}
      {arquivo && <PreviaWord bytes={arquivo.bytes} />}

      <div className="toolbar" style={{ marginTop: 10 }}>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onFechar}>
          Fechar
        </button>
        <button type="button" className="btn primary" disabled={!arquivo || salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar modelo"}
        </button>
      </div>
    </div>
  );
}
