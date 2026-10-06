"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PortaoSenha } from "@/components/PortaoSenha";
import { cabecalhoSenha, useSenhaEquipe } from "@/lib/senhaEquipe";

interface Operador {
  id: number;
  login: string;
  nome: string;
  perfil: "operador" | "engenheiro" | "master";
  cargo: string | null;
  acesso_controladoria: boolean;
  acesso_madeireiras: boolean;
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

type Contagem = {
  hoje: number;
  semana: number;
  mes: number;
  ano: number;
  periodo: number;
  divergencias: number;
  desdobrados: number;
  consolidados: number;
};

type Categoria = "mestres" | "documentos";

const CARGOS = ["Engenheiro(a)", "Aux. Administrativo"];

const NOME_TIPO: Record<string, string> = { DESD: "Desdobrado", CONS: "Consolidado", KD: "KD", HT: "HT", AQF: "AQF" };

interface Painel {
  operadores: Operador[];
  periodo: { de: string; ate: string };
  resumo: Record<string, Contagem>;
  porEmpresa: [string, number][];
  ufPorNome: Record<string, string | null>;
  emissoes: Emissao[];
  totalPeriodo: number;
}

type TipoPeriodo = "dia" | "mes" | "ano" | "intervalo";

const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso)
  );

/** Hoje em São Paulo: "2026-09-30". */
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const ultimoDiaDoMes = (aaaaMm: string) => {
  const [a, m] = aaaaMm.split("-").map(Number);
  return `${aaaaMm}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

const dataBR = (iso: string) => iso.split("-").reverse().join("/");

/** "2026-10-06" + n dias. */
const somarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// Listas longas da página: mostram poucas linhas e crescem no "Ver mais".
const PRIMEIRAS_EMPRESAS = 8;
const PRIMEIRAS_EMISSOES = 15;

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function csv(linhas: Emissao[], nomes: Record<string, string>): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const cab = ["Data/hora", "Colaborador", "Empresa", "Certificado", "Tipo", "Lote", "Ciclo", "Data do tratamento", "Divergências conferidas"];
  const corpo = linhas.map((e) =>
    [quando(e.created_at), nomes[e.operador_login] ?? e.operador_login, e.empresa_apelido, e.numero_certificado, NOME_TIPO[e.tipo ?? ""] ?? e.tipo, e.lote, e.ciclo, e.data_tratamento, (e.divergencias ?? []).join(" | ")]
      .map(esc)
      .join(";")
  );
  return "﻿" + [cab.map(esc).join(";"), ...corpo].join("\r\n");
}

function Controladoria({ senha, sair }: { senha: string; sair: () => void }) {
  const hoje = hojeSP();
  // Cadastrar e editar colaboradores: só o login master (controladoriamann). Os demais só consultam.
  const master = useSenhaEquipe().sessao?.perfil === "master";
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [novo, setNovo] = useState({ login: "", nome: "", senha: "", perfil: "operador", cargo: "", acessoControladoria: false, acessoMadeireiras: false });
  const [editando, setEditando] = useState<{ id: number; nome: string; login: string; cargo: string; controladoria: boolean; madeireiras: boolean } | null>(null);

  // Filtro do período (padrão: mês atual) e filtros da lista.
  const [categoria, setCategoria] = useState<Categoria>("mestres");
  const [tipoDoc, setTipoDoc] = useState("");
  const [tipo, setTipo] = useState<TipoPeriodo>("mes");
  const [dia, setDia] = useState(hoje);
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [ano, setAno] = useState(hoje.slice(0, 4));
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(hoje);
  const [operador, setOperador] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [busca, setBusca] = useState("");
  const [verEmpresas, setVerEmpresas] = useState(PRIMEIRAS_EMPRESAS);
  const [verEmissoes, setVerEmissoes] = useState(PRIMEIRAS_EMISSOES);

  const intervalo: [string, string] =
    tipo === "dia" ? [dia, dia] : tipo === "mes" ? [`${mes}-01`, ultimoDiaDoMes(mes)] : tipo === "ano" ? [`${ano}-01-01`, `${ano}-12-31`] : [de, ate];
  const [pDe, pAte] = intervalo;
  const rotuloPeriodo =
    tipo === "dia"
      ? dataBR(dia)
      : tipo === "mes"
        ? `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`
        : tipo === "ano"
          ? ano
          : `${dataBR(de)} a ${dataBR(ate)}`;

  const carregar = useCallback(async () => {
    if (!pDe || !pAte) return;
    try {
      const res = await fetch(`/api/controladoria?de=${pDe}&ate=${pAte}&categoria=${categoria}`, { headers: cabecalhoSenha(senha), cache: "no-store" });
      if (res.status === 401) return sair();
      const data = await res.json();
      if (!res.ok) setErro(data.error ?? "Falha ao carregar.");
      else {
        setErro(null);
        setPainel(data);
      }
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    }
  }, [senha, sair, pDe, pAte, categoria]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial dos dados da página
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
    if (res.status === 401) {
      sair();
      return false;
    }
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
    if (await enviar("POST", novo, `Colaborador ${novo.nome} cadastrado.`)) setNovo({ login: "", nome: "", senha: "", perfil: "operador", cargo: "", acessoControladoria: false, acessoMadeireiras: false });
  }

  async function salvarEdicao(op: Operador) {
    if (!editando) return;
    const mudou: Record<string, unknown> = { id: op.id };
    if (editando.nome.trim() !== op.nome) mudou.nome = editando.nome;
    if (editando.login.trim().toLowerCase() !== op.login) mudou.login = editando.login;
    if (editando.cargo !== (op.cargo ?? "")) mudou.cargo = editando.cargo;
    if (editando.controladoria !== op.acesso_controladoria) mudou.acessoControladoria = editando.controladoria;
    if (editando.madeireiras !== op.acesso_madeireiras) mudou.acessoMadeireiras = editando.madeireiras;
    if (Object.keys(mudou).length === 1) return setEditando(null);
    if (await enviar("PATCH", mudou, `Colaborador ${editando.nome} atualizado.`)) setEditando(null);
  }

  async function trocarSenha(op: Operador) {
    const nova = window.prompt(`Nova senha para ${op.nome} (mínimo 8 caracteres):`);
    if (nova) await enviar("PATCH", { id: op.id, senha: nova }, `Senha de ${op.nome} alterada.`);
  }

  if (erro && !painel) {
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
  const zero: Contagem = { hoje: 0, semana: 0, mes: 0, ano: 0, periodo: 0, divergencias: 0, desdobrados: 0, consolidados: 0 };
  const docs = categoria === "documentos";
  // Colaborador escolhido no filtro: os quadros mostram só os números dele (dia, semana, mês, ano e período).
  const doColaborador = operador ? (painel.resumo[operador] ?? zero) : null;
  const soma = (k: keyof Contagem) => (doColaborador ? doColaborador[k] : Object.values(painel.resumo).reduce((s, r) => s + r[k], 0));
  const empresasDoPeriodo = painel.porEmpresa.map(([e]) => e).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const linhas = painel.emissoes.filter(
    (e) =>
      (!operador || e.operador_login === operador) &&
      (!empresa || e.empresa_apelido === empresa) &&
      (!docs || !tipoDoc || e.tipo === tipoDoc) &&
      (!busca || `${e.numero_certificado} ${e.lote} ${e.ciclo}`.toLowerCase().includes(busca.toLowerCase()))
  );
  const anos = Array.from({ length: Number(hoje.slice(0, 4)) - 2025 }, (_, i) => String(2026 + i)).reverse();

  function baixarCsv() {
    const url = URL.createObjectURL(new Blob([csv(linhas, nomes)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `emissoes-${pDe}-a-${pAte}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="view">
      <div className="toolbar" style={{ gap: 8, marginBottom: 14 }}>
        {(
          [
            ["mestres", "Certificados mestres"],
            ["documentos", "Consolidados / Desdobrados"],
          ] as const
        ).map(([c, nome]) => (
          <button
            key={c}
            type="button"
            className={`btn${categoria === c ? " primary" : ""}`}
            onClick={() => {
              setCategoria(c);
              setTipoDoc("");
              setEmpresa("");
            }}
          >
            {nome}
          </button>
        ))}
      </div>

      {doColaborador && (
        <p className="hint" style={{ margin: "0 0 8px" }}>
          Números de <b>{nomes[operador] ?? operador}</b>{" "}
          <button type="button" className="link" onClick={() => setOperador("")}>
            ver todos os colaboradores
          </button>
        </p>
      )}
      <div className="grid kpis cinco" style={{ marginBottom: 18 }}>
        <div className="card">
          <div className="kpi-label">Hoje</div>
          <div className="kpi-valor">{soma("hoje")}</div>
          <div className="kpi-sub">{dataBR(hoje)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Na semana</div>
          <div className="kpi-valor">{soma("semana")}</div>
          <div className="kpi-sub">de segunda a domingo</div>
        </div>
        <div className="card">
          <div className="kpi-label">No mês</div>
          <div className="kpi-valor">{soma("mes")}</div>
        </div>
        <div className="card">
          <div className="kpi-label">No ano</div>
          <div className="kpi-valor">{soma("ano")}</div>
        </div>
        <div className="card destaque">
          <div className="kpi-label">Período selecionado</div>
          <div className="kpi-valor">{doColaborador ? doColaborador.periodo : painel.totalPeriodo}</div>
          <div className="kpi-sub">
            {rotuloPeriodo}
            {docs ? ` · ${soma("desdobrados")} desdobrados · ${soma("consolidados")} consolidados` : ""}
          </div>
        </div>
      </div>

      <div className="card filtros" style={{ marginBottom: 18 }}>
        <div className="field">
          <span className="rotulo-campo">Ver por</span>
          <div className="periodo-botoes" role="group" aria-label="Ver por">
            {(
              [
                ["dia", "Dia"],
                ["mes", "Mês"],
                ["ano", "Ano"],
                ["intervalo", "Intervalo"],
              ] as const
            ).map(([t, nome]) => (
              <button key={t} type="button" className={`btn btn-sm${tipo === t ? " primary" : ""}`} aria-pressed={tipo === t} onClick={() => setTipo(t)}>
                {nome}
              </button>
            ))}
          </div>
        </div>
        {tipo === "dia" && (
          <div className="field">
            <label htmlFor="f-dia">Dia</label>
            <div className="periodo-botoes">
              <button type="button" className="btn btn-sm" aria-label="Dia anterior" onClick={() => setDia(somarDias(dia, -1))}>
                ◀
              </button>
              <input id="f-dia" type="date" value={dia} max={hoje} onChange={(e) => e.target.value && setDia(e.target.value)} />
              <button type="button" className="btn btn-sm" aria-label="Dia seguinte" disabled={dia >= hoje} onClick={() => setDia(somarDias(dia, 1))}>
                ▶
              </button>
              {dia !== hoje && (
                <button type="button" className="btn btn-sm" onClick={() => setDia(hoje)}>
                  Hoje
                </button>
              )}
            </div>
          </div>
        )}
        {tipo === "mes" && (
          <div className="field">
            <label htmlFor="f-mes">Mês</label>
            <input id="f-mes" type="month" value={mes} max={hoje.slice(0, 7)} onChange={(e) => e.target.value && setMes(e.target.value)} />
          </div>
        )}
        {tipo === "ano" && (
          <div className="field">
            <label htmlFor="f-ano">Ano</label>
            <select id="f-ano" value={ano} onChange={(e) => setAno(e.target.value)}>
              {anos.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </div>
        )}
        {tipo === "intervalo" && (
          <>
            <div className="field">
              <label htmlFor="f-de">De</label>
              <input id="f-de" type="date" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="f-ate">Até</label>
              <input id="f-ate" type="date" value={ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="f-op">Colaborador</label>
          <select id="f-op" value={operador} onChange={(e) => setOperador(e.target.value)}>
            <option value="">Todos</option>
            {painel.operadores.map((o) => (
              <option key={o.id} value={o.login}>
                {o.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-emp">Empresa</label>
          <select id="f-emp" value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Todas</option>
            {empresasDoPeriodo.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </div>
        {docs && (
          <div className="field">
            <label htmlFor="f-doc">Tipo</label>
            <select id="f-doc" value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)}>
              <option value="">Desdobrados e consolidados</option>
              <option value="DESD">Só desdobrados</option>
              <option value="CONS">Só consolidados</option>
            </select>
          </div>
        )}
      </div>

      <div className="section-title">
        <h2>Colaboradores</h2>
        <p>Certificados copiados por colaborador (horário de Brasília). “Período” = {rotuloPeriodo}.</p>
      </div>
      {aviso && <p className="hint" style={{ marginBottom: 8 }}>{aviso}</p>}
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="dados">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Login</th>
              <th>Cargo</th>
              <th>Acessos</th>
              <th>Hoje</th>
              <th>Semana</th>
              <th>Mês</th>
              <th>Ano</th>
              <th>Período</th>
              {docs ? (
                <>
                  <th>Desdobrados (período)</th>
                  <th>Consolidados (período)</th>
                </>
              ) : (
                <th>Divergências conferidas (período)</th>
              )}
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {painel.operadores.map((o) => {
              const r = painel.resumo[o.login] ?? zero;
              const ed = editando?.id === o.id ? editando : null;
              return (
                <tr key={o.id}>
                  <td>
                    {ed ? (
                      <input aria-label="Nome" value={ed.nome} onChange={(e) => setEditando({ ...ed, nome: e.target.value })} />
                    ) : (
                      <>
                        {o.nome}
                        {o.perfil === "master" ? (
                          <span className="kpi-sub"> · controladoria</span>
 ) : null}
                      </>
                    )}
                  </td>
                  <td className="mono">
                    {ed ? (
                      <input aria-label="Login" autoCapitalize="none" value={ed.login} onChange={(e) => setEditando({ ...ed, login: e.target.value })} />
                    ) : (
                      o.login
                    )}
                  </td>
                  <td>
                    {ed ? (
                      <select aria-label="Cargo" value={ed.cargo} onChange={(e) => setEditando({ ...ed, cargo: e.target.value })}>
                        <option value="">—</option>
                        {CARGOS.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    ) : (
                      (o.cargo ?? "—")
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {o.perfil === "master" ? (
                      <span className="kpi-sub">tudo (master)</span>
                    ) : ed ? (
                      <span className="acessos-edit">
                        <label>
                          <input type="checkbox" checked={ed.controladoria} onChange={(e) => setEditando({ ...ed, controladoria: e.target.checked })} />{" "}
                          Controladoria
                        </label>
                        <label>
                          <input type="checkbox" checked={ed.madeireiras} onChange={(e) => setEditando({ ...ed, madeireiras: e.target.checked })} />{" "}
                          Cadastros
                        </label>
                      </span>
                    ) : (
                      [o.acesso_controladoria && "Controladoria", o.acesso_madeireiras && "Cadastros"].filter(Boolean).join(", ") || "Só emissão"
                    )}
                  </td>
                  <td>{r.hoje}</td>
                  <td>{r.semana}</td>
                  <td>{r.mes}</td>
                  <td>{r.ano}</td>
                  <td>
                    <b>{r.periodo}</b>
                  </td>
                  {docs ? (
                    <>
                      <td>{r.desdobrados}</td>
                      <td>{r.consolidados}</td>
                    </>
                  ) : (
                    <td>{r.divergencias}</td>
                  )}
                  <td>{o.ativo ? "Ativo" : "Desativado"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!master ? null : ed ? (
                      <>
                        <button type="button" className="link" onClick={() => salvarEdicao(o)}>
                          Salvar
                        </button>{" "}
                        ·{" "}
                        <button type="button" className="link" onClick={() => setEditando(null)}>
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="link" onClick={() =>
                            setEditando({
                              id: o.id,
                              nome: o.nome,
                              login: o.login,
                              cargo: o.cargo ?? "",
                              controladoria: o.acesso_controladoria,
                              madeireiras: o.acesso_madeireiras,
                            })
                          }>
                          Editar
                        </button>{" "}
                        ·{" "}
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
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {master ? (
      <form className="card" onSubmit={criar} style={{ marginBottom: 18 }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Cadastrar colaborador</h3>
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
            <label htmlFor="op-cargo">Cargo</label>
            <select id="op-cargo" value={novo.cargo} onChange={(e) => setNovo({ ...novo, cargo: e.target.value })}>
              <option value="">—</option>
              {CARGOS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="rotulo-campo">Páginas liberadas</span>
            <span className="acessos-edit">
              <label>
                <input type="checkbox" checked={novo.acessoControladoria} onChange={(e) => setNovo({ ...novo, acessoControladoria: e.target.checked })} />{" "}
                Controladoria
              </label>
              <label>
                <input type="checkbox" checked={novo.acessoMadeireiras} onChange={(e) => setNovo({ ...novo, acessoMadeireiras: e.target.checked })} />{" "}
                Cadastros
              </label>
            </span>
          </div>
          <div className="field">
            <label htmlFor="op-perfil">Acesso</label>
            <select id="op-perfil" value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}>
              <option value="operador">Colaborador (emite certificados)</option>
              <option value="master">Controladoria (master)</option>
            </select>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button type="submit" className="btn primary" disabled={!novo.nome || !novo.login || !novo.senha}>
            Cadastrar
          </button>
        </div>
      </form>
      ) : (
        <p className="hint" style={{ marginBottom: 18 }}>Só o login da controladoria (controladoriamann) cadastra e edita colaboradores.</p>
      )}

      <div className="section-title">
        <h2>Emissões por empresa</h2>
        <p>{rotuloPeriodo}</p>
      </div>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="dados">
          <tbody>
            {painel.porEmpresa.length ? (
              painel.porEmpresa.slice(0, verEmpresas).map(([emp, n]) => (
                <tr key={emp}>
                  <td>
                    {emp} {painel.ufPorNome[emp] && <span className="badge">{painel.ufPorNome[emp]}</span>}
                  </td>
                  <td>{n}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td>Nenhuma emissão neste período.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <VerMais total={painel.porEmpresa.length} mostrando={verEmpresas} passo={PRIMEIRAS_EMPRESAS} onMudar={setVerEmpresas} nome="empresas" />

      <div className="section-title">
        <h2>Emissões do período</h2>
        <p>
          {linhas.length} de {painel.totalPeriodo}
          {painel.totalPeriodo > painel.emissoes.length ? ` (mostrando as ${painel.emissoes.length} mais recentes)` : ""}
        </p>
      </div>
      <div className="toolbar" style={{ marginBottom: 10, gap: 10 }}>
        <input
          type="search"
          placeholder="Buscar certificado, lote ou ciclo"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label="Buscar emissões"
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
              <th>Colaborador</th>
              <th>Empresa</th>
              <th>Certificado</th>
              <th>Tipo</th>
              <th>Lote</th>
              <th>Tratamento</th>
              <th>Divergências conferidas</th>
            </tr>
          </thead>
          <tbody>
            {linhas.slice(0, verEmissoes).map((e) => (
              <tr key={e.id}>
                <td className="mono">{quando(e.created_at)}</td>
                <td>{nomes[e.operador_login] ?? e.operador_login}</td>
                <td>
                  {e.empresa_apelido} {painel.ufPorNome[e.empresa_apelido] && <span className="badge">{painel.ufPorNome[e.empresa_apelido]}</span>}
                </td>
                <td className="mono">{e.numero_certificado}</td>
                <td>{NOME_TIPO[e.tipo ?? ""] ?? e.tipo}</td>
                <td className="mono">{e.lote}</td>
                <td className="mono">{e.data_tratamento}</td>
                <td>{e.divergencias?.length ? e.divergencias.join("; ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <VerMais total={linhas.length} mostrando={verEmissoes} passo={20} onMudar={setVerEmissoes} nome="emissões" inicial={PRIMEIRAS_EMISSOES} />
    </div>
  );
}

/** "Ver mais" de uma lista: mostra mais `passo` linhas; "Ver menos" volta ao início. */
function VerMais({
  total,
  mostrando,
  passo,
  onMudar,
  nome,
  inicial = passo,
}: {
  total: number;
  mostrando: number;
  passo: number;
  onMudar: (n: number) => void;
  nome: string;
  inicial?: number;
}) {
  if (total <= inicial) return <div style={{ marginBottom: 18 }} />;
  return (
    <div className="actions ver-mais">
      <span className="hint">
        Mostrando {Math.min(mostrando, total)} de {total} {nome}
      </span>
      {mostrando < total && (
        <>
          <button type="button" className="btn btn-sm" onClick={() => onMudar(mostrando + passo)}>
            Ver mais
          </button>
          <button type="button" className="link" onClick={() => onMudar(total)}>
            ver todas
          </button>
        </>
      )}
      {mostrando > inicial && (
        <button type="button" className="link" onClick={() => onMudar(inicial)}>
          ver menos
        </button>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <PortaoSenha titulo="Controladoria" pagina="controladoria">
      {(senha, sair) => <Controladoria senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
