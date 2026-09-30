"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PortaoSenha } from "@/components/PortaoSenha";
import { cabecalhoSenha } from "@/lib/senhaEquipe";

interface Operador {
  id: number;
  login: string;
  nome: string;
  perfil: "operador" | "master";
  ativo: boolean;
}

interface Emissao {
  id: number;
  operador_login: string;
  empresa_apelido: string;
  numero_certificado: string | null;
  tipo: string | null;
  lote: string | null;
  ciclo: string | null;
  data_tratamento: string | null;
  divergencias: string[] | null;
  created_at: string;
}

interface Painel {
  operadores: Operador[];
  resumo: Record<string, { semana: number; mes: number; ano: number; divergencias: number }>;
  porEmpresaMes: [string, number][];
  ultimas: Emissao[];
  totalAno: number;
}

const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso)
  );

function csv(linhas: Emissao[], nomes: Record<string, string>): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cab = ["Data/hora", "Operador", "Empresa", "Certificado", "Tipo", "Lote", "Ciclo", "Data do tratamento", "Divergências conferidas"];
  const corpo = linhas.map((e) =>
    [quando(e.created_at), nomes[e.operador_login] ?? e.operador_login, e.empresa_apelido, e.numero_certificado, e.tipo, e.lote, e.ciclo, e.data_tratamento, (e.divergencias ?? []).join(" | ")]
      .map(esc)
      .join(";")
  );
  return "﻿" + [cab.map(esc).join(";"), ...corpo].join("\r\n");
}

function Controladoria({ senha, sair }: { senha: string; sair: () => void }) {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novo, setNovo] = useState({ login: "", nome: "", senha: "", perfil: "operador" });
  const [filtro, setFiltro] = useState("");

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/controladoria", { headers: cabecalhoSenha(senha), cache: "no-store" });
      if (res.status === 401) return sair();
      const data = await res.json();
      if (!res.ok) setErro(data.error ?? "Falha ao carregar.");
      else setPainel(data);
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    }
  }, [senha, sair]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function enviar(method: "POST" | "PATCH", corpo: object, ok: string) {
    setAviso(null);
    const res = await fetch("/api/controladoria/operadores", {
      method,
      headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
      body: JSON.stringify(corpo),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return sair();
    if (!res.ok) {
      setAviso(data.error ?? "Não foi possível salvar.");
      return false;
    }
    setAviso(ok);
    await carregar();
    return true;
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (await enviar("POST", novo, `Operador ${novo.nome} cadastrado.`)) setNovo({ login: "", nome: "", senha: "", perfil: "operador" });
  }

  async function trocarSenha(op: Operador) {
    const nova = window.prompt(`Nova senha para ${op.nome} (mínimo 8 caracteres):`);
    if (nova) await enviar("PATCH", { id: op.id, senha: nova }, `Senha de ${op.nome} alterada.`);
  }

  if (erro) {
    return (
      <div className="alert-box critical" role="alert">
        <h4>Controladoria indisponível</h4>
        <ul>
          <li>{erro}</li>
        </ul>
      </div>
    );
  }
  if (!painel) return <p className="lead">Carregando…</p>;

  const nomes = Object.fromEntries(painel.operadores.map((o) => [o.login, o.nome]));
  const soma = (k: "semana" | "mes" | "ano") => Object.values(painel.resumo).reduce((s, r) => s + r[k], 0);
  const linhas = painel.ultimas.filter((e) =>
    !filtro ? true : `${nomes[e.operador_login] ?? ""} ${e.operador_login} ${e.empresa_apelido} ${e.numero_certificado}`.toLowerCase().includes(filtro.toLowerCase())
  );

  function baixarCsv() {
    const url = URL.createObjectURL(new Blob([csv(linhas, nomes)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `emissoes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="view">
      <div className="grid kpis" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="kpi-label">Na semana</div>
          <div className="kpi-valor">{soma("semana")}</div>
          <div className="kpi-sub">certificados emitidos (seg. a dom.)</div>
        </div>
        <div className="card">
          <div className="kpi-label">No mês</div>
          <div className="kpi-valor">{soma("mes")}</div>
        </div>
        <div className="card">
          <div className="kpi-label">No ano</div>
          <div className="kpi-valor">{soma("ano")}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Com divergência conferida</div>
          <div className="kpi-valor">{Object.values(painel.resumo).reduce((s, r) => s + r.divergencias, 0)}</div>
          <div className="kpi-sub">copiados após marcar “Conferi”</div>
        </div>
      </div>

      <div className="section-title">
        <h2>Operadores</h2>
        <p>Certificados copiados por operador (horário de Brasília).</p>
      </div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="dados">
          <thead>
            <tr>
              <th>Operador</th>
              <th>Login</th>
              <th>Semana</th>
              <th>Mês</th>
              <th>Ano</th>
              <th>Divergências conferidas</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {painel.operadores.map((o) => {
              const r = painel.resumo[o.login] ?? { semana: 0, mes: 0, ano: 0, divergencias: 0 };
              return (
                <tr key={o.id}>
                  <td>
                    {o.nome}
                    {o.perfil === "master" && <span className="kpi-sub"> · controladoria</span>}
                  </td>
                  <td className="mono">{o.login}</td>
                  <td>{r.semana}</td>
                  <td>{r.mes}</td>
                  <td>{r.ano}</td>
                  <td>{r.divergencias}</td>
                  <td>{o.ativo ? "Ativo" : "Desativado"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button type="button" className="link" onClick={() => trocarSenha(o)}>
                      Trocar senha
                    </button>{" "}
                    ·{" "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => enviar("PATCH", { id: o.id, ativo: !o.ativo }, `${o.nome} ${o.ativo ? "desativado" : "ativado"}.`)}
                    >
                      {o.ativo ? "Desativar" : "Ativar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={criar} style={{ marginBottom: 18 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Cadastrar operador</h3>
        <div className="form-grid tres">
          <div className="field">
            <label htmlFor="op-nome">Nome</label>
            <input id="op-nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="op-login">Login</label>
            <input id="op-login" autoCapitalize="none" value={novo.login} onChange={(e) => setNovo({ ...novo, login: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="op-senha">Senha (mín. 8)</label>
            <input id="op-senha" type="password" autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="op-perfil">Perfil</label>
            <select id="op-perfil" value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}>
              <option value="operador">Operador (emite certificados)</option>
              <option value="master">Controladoria (master)</option>
            </select>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button type="submit" className="btn primary" disabled={!novo.nome || !novo.login || !novo.senha}>
            Cadastrar
          </button>
          {aviso && <span className="hint">{aviso}</span>}
        </div>
      </form>

      <div className="section-title">
        <h2>Emissões no mês por empresa</h2>
      </div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="dados">
          <tbody>
            {painel.porEmpresaMes.length ? (
              painel.porEmpresaMes.map(([emp, n]) => (
                <tr key={emp}>
                  <td>{emp}</td>
                  <td>{n}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td>Nenhuma emissão neste mês ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title">
        <h2>Últimas emissões</h2>
        <p>As 200 mais recentes.</p>
      </div>
      <div className="toolbar" style={{ marginBottom: 10, gap: 10 }}>
        <input
          type="search"
          placeholder="Filtrar por operador, empresa ou certificado"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          aria-label="Filtrar emissões"
          style={{ flex: 1, minWidth: 200 }}
        />
        <button type="button" className="btn" onClick={baixarCsv} disabled={!linhas.length}>
          Baixar CSV
        </button>
      </div>
      <div className="table-wrap">
        <table className="dados">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Operador</th>
              <th>Empresa</th>
              <th>Certificado</th>
              <th>Tipo</th>
              <th>Lote</th>
              <th>Tratamento</th>
              <th>Divergências conferidas</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((e) => (
              <tr key={e.id}>
                <td className="mono">{quando(e.created_at)}</td>
                <td>{nomes[e.operador_login] ?? e.operador_login}</td>
                <td>{e.empresa_apelido}</td>
                <td className="mono">{e.numero_certificado}</td>
                <td>{e.tipo}</td>
                <td className="mono">{e.lote}</td>
                <td className="mono">{e.data_tratamento}</td>
                <td>{e.divergencias?.length ? e.divergencias.join("; ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PortaoSenha titulo="Controladoria" master>
      {(senha, sair) => <Controladoria senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
