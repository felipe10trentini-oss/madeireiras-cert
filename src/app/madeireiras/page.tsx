"use client";

import { useCallback, useEffect, useState } from "react";
import { FileDrop } from "@/components/FileDrop";
import { PortaoSenha } from "@/components/PortaoSenha";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { lerPlanilhaMadeireiras } from "@/lib/planilhaMadeireiras";
import { cabecalhoSenha } from "@/lib/senhaEquipe";

interface Resumo {
  totalNaPlanilha: number;
  novas: string[];
  atualizadas: { apelido: string; campos: string[] }[];
  iguais: number;
  ignoradas: number;
  ausentesNaPlanilha: number;
  aplicado: boolean;
}

const NOME_CAMPO: Record<string, string> = {
  apelido: "empresa",
  rt: "RT",
  uf: "UF",
  modalidade: "modalidade",
  tratamentos: "tratamentos",
  razao_social: "razão social",
  cnpj: "CNPJ",
  crea: "CREA",
  telefone: "telefone",
  endereco: "endereço",
  reg_mapa: "registro MAPA",
  email: "e-mail",
  documento: "programação/comunicado",
  processo: "processo da programação",
  unidade_volumes: "unidade dos volumes",
};

function Madeireiras({ senha, sair }: { senha: string; sair: () => void }) {
  const [lista, setLista] = useState<MadeireiraSalva[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [planilhaLida, setPlanilhaLida] = useState<Awaited<ReturnType<typeof lerPlanilhaMadeireiras>> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/madeireiras", { headers: cabecalhoSenha(senha), cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setLista(data.empresas);
        setErroLista(null);
      } else setErroLista(data.error ?? "Falha ao ler o cadastro.");
    } catch {
      setErroLista("Não foi possível conectar ao servidor.");
    }
  }, [senha]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(modo: "previa" | "aplicar") {
    if (!arquivo) return;
    setTrabalhando(true);
    setErro(null);
    try {
      // Lida aqui no navegador: a Planilha Geral passa do limite de envio da Vercel (4,5 MB).
      let lida = planilhaLida;
      if (!lida) {
        try {
          lida = await lerPlanilhaMadeireiras(await arquivo.arrayBuffer());
          setPlanilhaLida(lida);
        } catch (e) {
          setErro(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
          return;
        }
      }
      const res = await fetch("/api/madeireiras/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ ...lida, modo }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) sair();
      else if (!res.ok) setErro(data.error ?? "Não foi possível processar a planilha.");
      else {
        setResumo(data as Resumo);
        if (modo === "aplicar") void carregar();
      }
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setTrabalhando(false);
    }
  }

  const mudancas = resumo ? resumo.novas.length + resumo.atualizadas.length : 0;
  const f = filtro.trim().toLowerCase();
  const visiveis = (lista ?? []).filter(
    (e) => !f || `${e.apelido} ${e.razaoSocial} ${e.regMapa} ${e.cnpj}`.toLowerCase().includes(f)
  );

  return (
    <div className="view">
      <p className="lead">
        Envie a <b>Planilha Geral</b>: o site lê a aba <b>DADOS CADASTRAIS</b> (dados das empresas) e a aba{" "}
        <b>PROGRAMAÇÕES</b> (quem usa programação mensal e o nº do processo; as demais usam comunicado). A comparação é
        pelo <b>CNPJ</b>: cadastra as novas e atualiza as que mudaram. Nenhuma empresa é apagada. Coluna opcional na
        aba de dados: <b>UNIDADE</b> (Fardos, Tábuas…).
      </p>

      {erroLista && (
        <div className="alert-box critical" role="alert">
          <h4>Cadastro indisponível</h4>
          <ul>
            <li>{erroLista}</li>
          </ul>
        </div>
      )}

      <div className="drops" style={{ gridTemplateColumns: "1fr" }}>
        <FileDrop
          titulo="Planilha Geral"
          dica="Arraste a Planilha Geral (.xlsx) aqui ou clique para escolher"
          arquivo={arquivo}
          onArquivo={(x) => {
            setArquivo(x);
            setPlanilhaLida(null);
            setResumo(null);
            setErro(null);
          }}
          accept=".xlsx"
          aceita={(x) => /\.xlsx$/i.test(x.name)}
        />
      </div>

      {erro && (
        <div className="alert-box critical" role="alert">
          <h4>Não foi possível continuar</h4>
          <ul>
            <li>{erro}</li>
          </ul>
        </div>
      )}

      <div className="actions" style={{ marginBottom: 18 }}>
        <button type="button" className="btn primary lg" disabled={!arquivo || trabalhando} onClick={() => enviar("previa")}>
          {trabalhando && !resumo ? "Lendo a planilha…" : "Ver o que vai mudar"}
        </button>
        <button type="button" className="btn" onClick={sair}>
          Sair
        </button>
      </div>

      {resumo && (
        <div className="view">
          <div className="grid kpis">
            <div className="card">
              <div className="kpi-label">Novas</div>
              <div className="kpi-value">{resumo.novas.length}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Atualizadas</div>
              <div className="kpi-value">{resumo.atualizadas.length}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Sem mudança</div>
              <div className="kpi-value">{resumo.iguais}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Ignoradas (sem CNPJ válido)</div>
              <div className="kpi-value">{resumo.ignoradas}</div>
              <div className="kpi-sub">{resumo.ausentesNaPlanilha} do cadastro não estão nesta planilha (mantidas)</div>
            </div>
          </div>

          {resumo.novas.length > 0 && (
            <p className="lead">
              <b>Novas:</b> {resumo.novas.join(", ")}
            </p>
          )}
          {resumo.atualizadas.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table className="dados">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>O que mudou</th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.atualizadas.map((c) => (
                    <tr key={c.apelido}>
                      <td>{c.apelido}</td>
                      <td>{c.campos.map((k) => NOME_CAMPO[k] ?? k).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resumo.aplicado ? (
            <div className="alert-box" style={{ borderColor: "var(--good)", background: "var(--good-bg)" }}>
              <h4>Cadastro atualizado</h4>
              <ul>
                <li>
                  {resumo.novas.length} nova(s) e {resumo.atualizadas.length} atualizada(s).
                </li>
              </ul>
            </div>
          ) : mudancas === 0 ? (
            <div className="alert-box">
              <h4>Nada a fazer</h4>
              <ul>
                <li>O cadastro já está igual à planilha.</li>
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

      <div className="section-title">
        <h2>Madeireiras cadastradas {lista ? `(${lista.length})` : ""}</h2>
        <div className="field" style={{ minWidth: 240 }}>
          <input type="text" placeholder="Buscar empresa, CNPJ ou registro" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="dados">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Modalidade</th>
              <th>Trat.</th>
              <th>Documento</th>
              <th>Registro MAPA</th>
              <th>CNPJ</th>
              <th>RT</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-row">
                  {lista ? "Nenhuma empresa." : "Carregando…"}
                </td>
              </tr>
            ) : (
              visiveis.map((e) => (
                <tr key={e.cnpj}>
                  <td>{e.apelido}</td>
                  <td>
                    <span className={`badge ${e.modalidade === "Credenciada" ? "pago" : "pendente"}`}>{e.modalidade}</span>
                  </td>
                  <td>{e.tratamentos.join("/")}</td>
                  <td>{e.documento === "comunicado" ? "Comunicado" : e.documento === "programacao" ? "Programação" : "—"}</td>
                  <td className="mono">{e.regMapa}</td>
                  <td className="mono">{e.cnpj}</td>
                  <td>{e.rt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PaginaMadeireiras() {
  return (
    <PortaoSenha titulo="Cadastro de madeireiras">
      {(senha, sair) => <Madeireiras senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
