"use client";

// Cadastro feito no próprio site (aba Cadastros), alternativa ao upload das planilhas:
// formulário da empresa (as mesmas colunas da planilha de cadastro) e dos RTs (acessos do SEI).
import { useState, type FormEvent } from "react";
import { COLUNAS_CADASTRO, empresaDaLinha, type ColunaCadastro } from "@/lib/cadastroColunas";
import { rtCompleto } from "@/lib/responsaveis";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos } from "@/lib/util";

const GRUPOS = [...new Set(COLUNAS_CADASTRO.map((c) => c.grupo))];

/** Valores iniciais de uma empresa nova: Sim/Não em "Não" (Ativa: "Sim"); o resto em branco. */
function linhaVazia(): Record<string, string> {
  return Object.fromEntries(
    COLUNAS_CADASTRO.map((c) => [c.titulo, c.titulo === "Ativa" ? "Sim" : c.opcoes?.[0] === "Sim" ? "Não" : ""])
  );
}

function Campo({ c, valor, onChange, rts }: { c: ColunaCadastro; valor: string; onChange: (v: string) => void; rts: string[] }) {
  const id = `cad-${COLUNAS_CADASTRO.indexOf(c)}`;
  const largo = c.largura >= 30;
  return (
    <div className={`field${largo ? " full" : ""}`}>
      <label htmlFor={id} title={c.ajuda}>
        {c.titulo}
        {c.obrigatoria ? " *" : ""}
      </label>
      {c.tipo === "lista" ? (
        <select id={id} value={valor} onChange={(e) => onChange(e.target.value)}>
          {!c.obrigatoria && !c.opcoes?.includes(valor) && <option value="">—</option>}
          {c.obrigatoria && !valor && <option value="">— escolha —</option>}
          {c.opcoes?.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          value={valor}
          inputMode={c.tipo === "numero" ? "decimal" : undefined}
          list={c.titulo === "Responsável técnico" ? "lista-rts" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {c.ajuda && <span className="hint">{c.ajuda}</span>}
      {c.titulo === "Responsável técnico" && (
        <datalist id="lista-rts">
          {rts.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      )}
    </div>
  );
}

/** Formulário da empresa. `inicial` = linha da empresa a editar (null = nova). */
export function FormEmpresa({
  senha,
  inicial,
  cnpjsExistentes,
  rts,
  onSalvo,
  onCancelar,
}: {
  senha: string;
  inicial: Record<string, string> | null;
  cnpjsExistentes: string[];
  rts: string[];
  onSalvo: (msg: string) => void;
  onCancelar: () => void;
}) {
  const [linha, setLinha] = useState<Record<string, string>>(inicial ?? linhaVazia());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const editando = !!inicial;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const faltam = COLUNAS_CADASTRO.filter((c) => c.obrigatoria && !linha[c.titulo]?.trim()).map((c) => c.titulo);
    if (faltam.length) return setErro(`Preencha: ${faltam.join(", ")}.`);
    if (soDigitos(linha.CNPJ).length !== 14) return setErro("CNPJ inválido (precisa ter 14 dígitos).");
    const cnpjOriginal = soDigitos(inicial?.CNPJ ?? "");
    if (soDigitos(linha.CNPJ) !== cnpjOriginal && cnpjsExistentes.includes(soDigitos(linha.CNPJ))) {
      return setErro("Já existe uma empresa com esse CNPJ: use Editar na lista.");
    }
    if (editando && soDigitos(linha.CNPJ) !== cnpjOriginal) {
      return setErro("O CNPJ é a chave da empresa e não pode ser trocado aqui: cadastre como empresa nova.");
    }
    const r = empresaDaLinha(linha);
    if (!r) return setErro("Preencha razão social e CNPJ.");
    setSalvando(true);
    try {
      const res = await fetch("/api/madeireiras/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ empresas: [r.empresa], ignoradas: 0, modo: "aplicar" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data.error ?? "Não foi possível salvar.");
      onSalvo(data.novas?.length ? `${r.empresa.apelido} cadastrada.` : data.atualizadas?.length ? `${r.empresa.apelido} atualizada.` : "Nada mudou.");
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="card" onSubmit={salvar} style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{editando ? `Editar ${inicial?.Apelido}` : "Cadastrar empresa"}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Os mesmos campos da planilha de cadastro. * = obrigatório. Para tirar uma empresa da lista, marque Ativa: Não.
      </p>
      {GRUPOS.map((g) => (
        <fieldset key={g} className="grupo-cadastro">
          <legend>{g}</legend>
          <div className="form-grid tres">
            {COLUNAS_CADASTRO.filter((c) => c.grupo === g).map((c) => (
              <Campo key={c.titulo} c={c} rts={rts} valor={linha[c.titulo] ?? ""} onChange={(v) => setLinha((l) => ({ ...l, [c.titulo]: v }))} />
            ))}
          </div>
        </fieldset>
      ))}
      {erro && (
        <div className="alert-box critical" role="alert">
          <ul>
            <li>{erro}</li>
          </ul>
        </div>
      )}
      <div className="actions" style={{ marginTop: 10 }}>
        <button type="submit" className="btn primary" disabled={salvando}>
          {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar empresa"}
        </button>
        <button type="button" className="btn" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export interface Rt {
  id: number;
  nome: string;
  funcao: string | null;
  empresa: string | null;
  login: string;
}

const RT_VAZIO = { nome: "", funcao: "Resp. Técnico", empresa: "", login: "", senha: "" };

/** Formulário do RT (acesso ao SEI). `inicial` = RT a editar (null = novo). */
export function FormRt({
  senha,
  inicial,
  onSalvo,
  onCancelar,
}: {
  senha: string;
  inicial: Rt | null;
  onSalvo: (msg: string) => void;
  onCancelar: () => void;
}) {
  // O formulário é recriado (key) a cada RT aberto: o estado inicial vem de `inicial`.
  const [rt, setRt] = useState(() =>
    inicial
      ? { nome: rtCompleto(inicial.nome) ?? inicial.nome, funcao: inicial.funcao ?? "", empresa: inicial.empresa ?? "", login: inicial.login, senha: "" }
      : RT_VAZIO
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/madeireiras/rts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ ...rt, id: inicial?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data.error ?? "Não foi possível salvar.");
      onSalvo(inicial ? `${rt.nome} atualizado(a).` : `${rt.nome} cadastrado(a).`);
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="card" onSubmit={salvar} style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{inicial ? `Editar ${rtCompleto(inicial.nome)}` : "Cadastrar RT"}</h3>
      <div className="form-grid tres">
        <div className="field">
          <label htmlFor="rt-nome">Nome completo *</label>
          <input id="rt-nome" value={rt.nome} onChange={(e) => setRt({ ...rt, nome: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rt-login">E-mail de acesso ao SEI *</label>
          <input id="rt-login" type="email" autoComplete="off" value={rt.login} onChange={(e) => setRt({ ...rt, login: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rt-senha">{inicial ? "Nova senha do SEI (vazio = mantém)" : "Senha do SEI *"}</label>
          <input id="rt-senha" type="password" autoComplete="new-password" value={rt.senha} onChange={(e) => setRt({ ...rt, senha: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="rt-funcao">Responsabilidade</label>
          <select id="rt-funcao" value={rt.funcao} onChange={(e) => setRt({ ...rt, funcao: e.target.value })}>
            <option value="">—</option>
            <option>Resp. Técnico</option>
            <option>Resp. Legal</option>
            {rt.funcao && !["Resp. Técnico", "Resp. Legal"].includes(rt.funcao) && <option>{rt.funcao}</option>}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rt-empresa">Empresa (só se for RT de uma empresa)</label>
          <input id="rt-empresa" value={rt.empresa} onChange={(e) => setRt({ ...rt, empresa: e.target.value })} />
        </div>
      </div>
      {erro && (
        <div className="alert-box critical" role="alert">
          <ul>
            <li>{erro}</li>
          </ul>
        </div>
      )}
      <div className="actions" style={{ marginTop: 10 }}>
        <button type="submit" className="btn primary" disabled={salvando || !rt.nome.trim() || !rt.login.trim() || (!inicial && !rt.senha)}>
          {salvando ? "Salvando…" : inicial ? "Salvar alterações" : "Cadastrar RT"}
        </button>
        <button type="button" className="btn" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Lista dos RTs cadastrados: senha oculta, com botão para mostrar. */
export function ListaRts({
  senha,
  rts,
  onEditar,
  onExcluido,
  onToast,
}: {
  senha: string;
  rts: Rt[] | null;
  onEditar: (rt: Rt) => void;
  onExcluido: () => void;
  onToast: (msg: string) => void;
}) {
  const [visiveis, setVisiveis] = useState<Record<number, string>>({});

  async function alternar(id: number) {
    if (visiveis[id] !== undefined) {
      setVisiveis((v) => {
        const resto = { ...v };
        delete resto[id];
        return resto;
      });
      return;
    }
    const res = await fetch(`/api/madeireiras/rts?senha=${id}`, { headers: cabecalhoSenha(senha), cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok && typeof data.senha === "string") setVisiveis((v) => ({ ...v, [id]: data.senha }));
    else onToast(data.error ?? "Não foi possível ler a senha.");
  }

  async function copiar(texto: string, oque: string) {
    try {
      await navigator.clipboard.writeText(texto);
      onToast(`${oque} copiado.`);
    } catch {
      onToast("Não foi possível copiar.");
    }
  }

  async function excluir(rt: Rt) {
    if (!confirm(`Excluir o acesso do SEI de ${rtCompleto(rt.nome)}?`)) return;
    const res = await fetch(`/api/madeireiras/rts?id=${rt.id}`, { method: "DELETE", headers: cabecalhoSenha(senha) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      onToast(`${rtCompleto(rt.nome)} excluído(a).`);
      onExcluido();
    } else onToast(data.error ?? "Não foi possível excluir.");
  }

  return (
    <div className="table-wrap">
      <table className="dados">
        <thead>
          <tr>
            <th>Nome completo</th>
            <th>Responsabilidade</th>
            <th>Empresa</th>
            <th>E-mail (SEI)</th>
            <th>Senha (SEI)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {!rts?.length ? (
            <tr>
              <td colSpan={6} className="empty-row">
                {rts ? "Nenhum RT cadastrado." : "Carregando…"}
              </td>
            </tr>
          ) : (
            rts.map((r) => (
              <tr key={r.id}>
                <td>{rtCompleto(r.nome)}</td>
                <td>{r.funcao ?? "—"}</td>
                <td>{r.empresa ?? "—"}</td>
                <td className="mono">
                  {r.login}{" "}
                  <button type="button" className="link" onClick={() => copiar(r.login, "E-mail")}>
                    copiar
                  </button>
                </td>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>
                  {visiveis[r.id] ?? "••••••••"}{" "}
                  <button type="button" className="link" onClick={() => alternar(r.id)}>
                    {visiveis[r.id] !== undefined ? "ocultar" : "mostrar"}
                  </button>
                  {visiveis[r.id] !== undefined && (
                    <>
                      {" · "}
                      <button type="button" className="link" onClick={() => copiar(visiveis[r.id], "Senha")}>
                        copiar
                      </button>
                    </>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="link" onClick={() => onEditar(r)}>
                    Editar
                  </button>
                  {" · "}
                  <button type="button" className="link" onClick={() => excluir(r)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
