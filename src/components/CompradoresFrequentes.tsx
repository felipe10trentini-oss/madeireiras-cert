"use client";

// Compradores frequentes do desdobrado e do consolidado (aba Cadastros): a razão social que aparece para escolher
// no campo 2.1 do certificado desdobrado.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { cabecalhoSenha } from "@/lib/senhaEquipe";

interface Comprador {
  id: number;
  razao: string;
}

export function CompradoresFrequentes({ senha, onToast, onFechar }: { senha: string; onToast: (msg: string) => void; onFechar: () => void }) {
  const [lista, setLista] = useState<Comprador[] | null>(null);
  const [padrao, setPadrao] = useState(false);
  const [razao, setRazao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Correção do nome na própria lista (alguém digitou errado).
  const [editando, setEditando] = useState<{ id: number; razao: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/madeireiras/compradores", { headers: cabecalhoSenha(senha), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data.error ?? "Não foi possível ler a lista.");
      setLista(data.compradores);
      setPadrao(!!data.padrao);
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    }
  }, [senha]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial da lista
    void carregar();
  }, [carregar]);

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const r = razao.replace(/\s+/g, " ").trim();
    if (r.length < 3) return setErro("Informe a razão social do comprador.");
    if (lista?.some((c) => c.razao.toLowerCase() === r.toLowerCase())) return setErro("Esse comprador já está na lista.");
    setSalvando(true);
    try {
      const res = await fetch("/api/madeireiras/compradores", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ razao: r }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data.error ?? "Não foi possível cadastrar.");
      onToast(`${r} cadastrado.`);
      setRazao("");
      void carregar();
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao() {
    if (!editando) return;
    const r = editando.razao.replace(/\s+/g, " ").trim();
    if (r.length < 3) return onToast("Informe a razão social do comprador.");
    if (lista?.some((c) => c.id !== editando.id && c.razao.toLowerCase() === r.toLowerCase())) return onToast("Já existe um comprador com esse nome.");
    const res = await fetch("/api/madeireiras/compradores", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
      body: JSON.stringify({ id: editando.id, razao: r }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return onToast(data.error ?? "Não foi possível alterar.");
    onToast(`Nome corrigido: ${r}.`);
    setEditando(null);
    void carregar();
  }

  async function remover(c: Comprador) {
    if (!confirm(`Tirar ${c.razao} dos compradores frequentes?`)) return;
    const res = await fetch(`/api/madeireiras/compradores?id=${c.id}`, { method: "DELETE", headers: cabecalhoSenha(senha) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      onToast(`${c.razao} removido.`);
      void carregar();
    } else onToast(data.error ?? "Não foi possível remover.");
  }

  return (
    <form className="card" onSubmit={adicionar} style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Compradores frequentes (desdobrado e consolidado)</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Aparecem para escolher no desdobrado e no consolidado e preenchem a razão social do comprador (2.1).
      </p>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="comp-razao">Razão social do comprador</label>
          <input id="comp-razao" value={razao} onChange={(e) => setRazao(e.target.value)} placeholder="ex.: Serrabras Comércio de Madeiras Ltda" />
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
        <button type="submit" className="btn primary" disabled={salvando || padrao}>
          {salvando ? "Salvando…" : "Adicionar comprador"}
        </button>
        <button type="button" className="btn" onClick={onFechar}>
          Fechar
        </button>
        {padrao && <span className="hint">A tabela de compradores ainda não foi criada no banco: a lista abaixo é a padrão.</span>}
      </div>

      <div className="table-wrap" style={{ marginTop: 14 }}>
        <table className="dados">
          <thead>
            <tr>
              <th>Compradores cadastrados {lista ? `(${lista.length})` : ""}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!lista ? (
              <tr>
                <td colSpan={2} className="empty-row">
                  Carregando…
                </td>
              </tr>
            ) : (
              lista.map((c) => {
                const ed = editando?.id === c.id ? editando : null;
                return (
                  <tr key={c.id}>
                    <td>
                      {ed ? (
                        <input
                          aria-label="Razão social do comprador"
                          value={ed.razao}
                          autoFocus
                          onChange={(e) => setEditando({ ...ed, razao: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void salvarEdicao();
                            } else if (e.key === "Escape") setEditando(null);
                          }}
                          style={{ width: "100%" }}
                        />
                      ) : (
                        c.razao
                      )}
                    </td>
                    <td style={{ width: 1, whiteSpace: "nowrap" }}>
                      {padrao ? null : ed ? (
                        <>
                          <button type="button" className="link" onClick={() => void salvarEdicao()}>
                            Salvar
                          </button>
                          {" · "}
                          <button type="button" className="link" onClick={() => setEditando(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" className="link" onClick={() => setEditando({ id: c.id, razao: c.razao })}>
                            Editar
                          </button>
                          {" · "}
                          <button type="button" className="link" onClick={() => remover(c)}>
                            Remover
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </form>
  );
}
