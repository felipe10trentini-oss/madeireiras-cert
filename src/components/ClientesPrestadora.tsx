"use client";

import { useRef, useState } from "react";
import { REGRAS_EMPRESA } from "@/lib/certificado";
import type { MadeireiraSalva, ResumoTomadores } from "@/lib/madeireirasDb";
import { CNPJ_MANN_MOVEL } from "@/lib/relatorioMannMovel";
import { lerPlanilhaClientes } from "@/lib/planilhaClientes";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos } from "@/lib/util";
import { FileDrop } from "./FileDrop";

const NOME_CAMPO: Record<string, string> = {
  razao: "razão social",
  cnpj: "CNPJ",
  endereco: "endereço",
  telefone: "telefone",
  email: "e-mail",
};

interface Props {
  senha: string;
  empresas: MadeireiraSalva[] | null;
  /** Chamado depois de aplicar, para recarregar o cadastro. */
  onAplicado: () => void;
}

/**
 * Clientes (tomadores) da prestadora de serviço — a Mann móvel: nome, CNPJ, endereço, telefone e e-mail que
 * entram no certificado. Substitui a antiga aba "Clientes" do site da Mann móvel.
 */
export function ClientesPrestadora({ senha, empresas, onAplicado }: Props) {
  const prestadoras = (empresas ?? []).filter((e) => REGRAS_EMPRESA[soDigitos(e.cnpj)]?.prestadora);
  const [escolhida, setEscolhida] = useState(CNPJ_MANN_MOVEL);
  const alvo = prestadoras.find((e) => soDigitos(e.cnpj) === soDigitos(escolhida)) ?? prestadoras[0] ?? null;
  const salvos = alvo ? Object.keys(alvo.relatorio?.tomadores ?? {}).length : 0;

  const [arquivo, setArquivo] = useState<File | null>(null);
  const bytes = useRef<ArrayBuffer | null>(null);
  const [resumo, setResumo] = useState<ResumoTomadores | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(modo: "previa" | "aplicar") {
    if (!arquivo || !alvo) return;
    setTrabalhando(true);
    setErro(null);
    try {
      const buffer = bytes.current ?? (await arquivo.arrayBuffer());
      const { clientes, ignoradas } = await lerPlanilhaClientes(buffer);
      const res = await fetch("/api/madeireiras/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: alvo.cnpj, clientes, ignoradas, modo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setErro(data.error ?? "Não foi possível processar a planilha.");
      else {
        setResumo(data as ResumoTomadores);
        if (modo === "aplicar") onAplicado();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
    } finally {
      setTrabalhando(false);
    }
  }

  if (!alvo) return null;
  const mudancas = resumo ? resumo.novos.length + resumo.atualizados.length : 0;

  return (
    <>
      <div className="section-title">
        <h2>Clientes da prestadora (tomadores)</h2>
        <p>Planilha de clientes da MANN MÓVEL (aba DADOS)</p>
      </div>
      <div className="card" style={{ marginBottom: 22 }}>
        <p className="hint" style={{ marginTop: 0 }}>
          Colunas: <b>Cliente</b>, <b>Nome</b>, <b>CNPJ</b>, <b>Endereço</b>, <b>E-mail</b>, <b>Telefone</b> e{" "}
          <b>Endereço escritório</b>. O site compara pelo <b>CNPJ</b>: cadastra os novos e atualiza os que mudaram. Nenhum
          cliente é apagado. Eles completam endereço, telefone e e-mail do tomador no certificado.
        </p>

        <div className="toolbar">
          {prestadoras.length > 1 && (
            <div className="field" style={{ minWidth: 240 }}>
              <label htmlFor="prest">Prestadora</label>
              <select
                id="prest"
                value={alvo.cnpj}
                onChange={(e) => {
                  setEscolhida(e.target.value);
                  setResumo(null);
                }}
              >
                {prestadoras.map((p) => (
                  <option key={p.cnpj} value={p.cnpj}>
                    {p.apelido}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="kpi-sub">
            <b>{salvos}</b> clientes cadastrados em {alvo.apelido}
          </div>
        </div>

        <div className="drops" style={{ gridTemplateColumns: "1fr" }}>
          <FileDrop
            titulo="Planilha de clientes"
            dica="Arraste a planilha de clientes (.xlsx) aqui ou clique para escolher"
            arquivo={arquivo}
            accept=".xlsx"
            aceita={(x) => /\.xlsx$/i.test(x.name)}
            onArquivo={(x) => {
              setArquivo(x);
              bytes.current = null;
              // Lê ao escolher, antes que o OneDrive sincronize o arquivo.
              x?.arrayBuffer().then((b) => (bytes.current = b)).catch(() => undefined);
              setResumo(null);
              setErro(null);
            }}
          />
        </div>

        {erro && (
          <div className="alert-box critical" role="alert" style={{ marginTop: 10 }}>
            <h4>Não foi possível continuar</h4>
            <ul>
              <li>{erro}</li>
            </ul>
          </div>
        )}

        <div className="actions" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary" disabled={!arquivo || trabalhando} onClick={() => enviar("previa")}>
            {trabalhando && !resumo ? "Lendo a planilha…" : "Ver o que vai mudar"}
          </button>
        </div>

        {resumo && (
          <div className="view" style={{ marginTop: 14 }}>
            <div className="grid kpis">
              <div className="card">
                <div className="kpi-label">Novos</div>
                <div className="kpi-value">{resumo.novos.length}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Atualizados</div>
                <div className="kpi-value">{resumo.atualizados.length}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Sem mudança</div>
                <div className="kpi-value">{resumo.iguais}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Ignorados</div>
                <div className="kpi-value">{resumo.ignoradas}</div>
                <div className="kpi-sub">sem CNPJ válido (e a própria prestadora) · {resumo.ausentesNaPlanilha} já salvos fora desta planilha (mantidos)</div>
              </div>
            </div>

            {resumo.novos.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table className="dados">
                  <thead>
                    <tr>
                      <th>Novos clientes</th>
                      <th>CNPJ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumo.novos.map((c) => (
                      <tr key={c.cnpj}>
                        <td>{c.razao}</td>
                        <td className="mono">{c.cnpj}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {resumo.atualizados.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table className="dados">
                  <thead>
                    <tr>
                      <th>Clientes que serão atualizados</th>
                      <th>CNPJ</th>
                      <th>O que mudou</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumo.atualizados.map((c) => (
                      <tr key={c.cnpj}>
                        <td>{c.razao}</td>
                        <td className="mono">{c.cnpj}</td>
                        <td>{c.campos.map((k) => NOME_CAMPO[k] ?? k).join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {resumo.aplicado ? (
              <div className="alert-box" style={{ borderColor: "var(--good)", background: "var(--good-bg)" }}>
                <h4>Clientes atualizados</h4>
                <ul>
                  <li>
                    {resumo.novos.length} novo(s) e {resumo.atualizados.length} atualizado(s).
                  </li>
                </ul>
              </div>
            ) : mudancas === 0 ? (
              <div className="alert-box">
                <h4>Nada a fazer</h4>
                <ul>
                  <li>Os clientes já estão iguais à planilha.</li>
                </ul>
              </div>
            ) : (
              <div className="actions">
                <button type="button" className="btn primary lg" disabled={trabalhando} onClick={() => enviar("aplicar")}>
                  {trabalhando ? "Aplicando…" : `Aplicar ${mudancas} mudança(s)`}
                </button>
                <span className="hint">Confira a lista acima antes de aplicar.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
