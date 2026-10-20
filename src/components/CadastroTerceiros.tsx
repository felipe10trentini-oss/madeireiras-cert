"use client";

// Cadastro de terceiros: os tomadores do serviço das credenciadas que tratam para outras empresas
// (Madeval, Madepallete, DM, CJ…) e os clientes da Mann móvel (era a aba "Cadastrar cliente móvel"). Ficam em relatorio.tomadores da empresa, pelo CNPJ;
// na emissão, o comunicado traz o CNPJ do tomador e o certificado puxa razão, endereço, telefone e
// e-mail daqui (2.1–2.5). Grava pela mesma rota do cadastro de clientes da móvel.
import { useState, type FormEvent } from "react";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import type { Tomador } from "@/lib/relatorio";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos } from "@/lib/util";

const VAZIO: Tomador = { razao: "", cnpj: "", endereco: "", telefone: "", email: "" };

/** "62468466000173" -> "62.468.466/0001-73" (o que vier com 14 dígitos). */
function formatarCnpj(s: string): string {
  const d = soDigitos(s);
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : s.trim();
}

export function CadastroTerceiros({
  senha,
  empresas,
  onSalvo,
  onFechar,
}: {
  senha: string;
  empresas: MadeireiraSalva[] | null;
  onSalvo: (msg: string) => void;
  onFechar: () => void;
}) {
  // Só as credenciadas (são as que tratam para terceiros).
  const lista = (empresas ?? [])
    .filter((e) => !e.config?.inativa && e.modalidade === "Credenciada")
    .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  const [cnpjEmpresa, setCnpjEmpresa] = useState("");
  const empresa = lista.find((e) => e.cnpj === cnpjEmpresa) ?? null;
  const salvos = Object.values(empresa?.relatorio?.tomadores ?? {}).sort((a, b) => a.razao.localeCompare(b.razao, "pt-BR"));
  const [editando, setEditando] = useState(""); // CNPJ (dígitos) do terceiro em edição; "" = novo
  const [c, setC] = useState<Tomador>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  // Busca na lista (a Mann móvel tem mais de 100 clientes).
  const [busca, setBusca] = useState("");
  const b = busca.trim().toLowerCase();
  const visiveis = b ? salvos.filter((t) => `${t.razao} ${t.cnpj} ${soDigitos(t.cnpj)} ${t.endereco}`.toLowerCase().includes(b)) : salvos;

  function abrir(cnpj: string) {
    setEditando(cnpj);
    setErro(null);
    setC(cnpj ? { ...VAZIO, ...(empresa?.relatorio?.tomadores?.[cnpj] ?? {}) } : VAZIO);
  }

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (!empresa) return setErro("Escolha a empresa.");
    const t = { ...c, cnpj: formatarCnpj(c.cnpj), razao: c.razao.trim() };
    if (!t.razao) return setErro("Informe a razão social do tomador.");
    if (soDigitos(t.cnpj).length !== 14) return setErro("CNPJ inválido (precisa ter 14 dígitos).");
    if (soDigitos(t.cnpj) === soDigitos(empresa.cnpj)) return setErro("Esse é o CNPJ da própria empresa: o tomador é o terceiro.");
    if (editando && soDigitos(t.cnpj) !== editando) return setErro("O CNPJ é a chave do tomador: para outro CNPJ, cadastre um novo.");
    if (!editando && salvos.some((s) => soDigitos(s.cnpj) === soDigitos(t.cnpj))) {
      return setErro("Esse CNPJ já está cadastrado nesta empresa: clique em “Editar” na lista.");
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/madeireiras/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: empresa.cnpj, clientes: [t], ignoradas: 0, modo: "aplicar" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data.error ?? "Não foi possível salvar.");
      onSalvo(data.novos?.length ? `${t.razao} cadastrado em ${empresa.apelido}.` : data.atualizados?.length ? `${t.razao} atualizado.` : "Nada mudou.");
      abrir("");
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setSalvando(false);
    }
  }

  async function remover(t: Tomador) {
    if (!empresa || !window.confirm(`Remover ${t.razao} dos terceiros de ${empresa.apelido}?`)) return;
    try {
      const res = await fetch("/api/madeireiras/clientes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: empresa.cnpj, tomador: t.cnpj }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data.error ?? "Não foi possível remover.");
      if (editando === soDigitos(t.cnpj)) abrir("");
      onSalvo(`${t.razao} removido.`);
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    }
  }

  const campo = (k: keyof Tomador, rotulo: string, extra: { full?: boolean; type?: string; dica?: string } = {}) => (
    <div className={`field${extra.full ? " full" : ""}`}>
      <label htmlFor={`ter-${k}`}>{rotulo}</label>
      <input id={`ter-${k}`} type={extra.type ?? "text"} value={c[k]} placeholder={extra.dica} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Cadastro de terceiros (tomadores do serviço)</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Para empresas que tratam para outras (Madeval, Madepallete, DM, CJ…) e os clientes da Mann móvel. Quando o comunicado traz o CNPJ de um tomador cadastrado aqui,
        o certificado já sai com razão social, CNPJ, endereço, telefone e e-mail dele (2.1–2.5).
      </p>

      <div className="form-grid tres" style={{ marginBottom: 12 }}>
        <div className="field">
          <label htmlFor="ter-empresa">Empresa</label>
          <select
            id="ter-empresa"
            value={cnpjEmpresa}
            onChange={(e) => {
              setCnpjEmpresa(e.target.value);
              setBusca("");
              setEditando("");
              setC(VAZIO);
              setErro(null);
            }}
          >
            <option value="">— escolha a empresa —</option>
            {lista.map((e) => {
              const n = Object.keys(e.relatorio?.tomadores ?? {}).length;
              return (
                <option key={e.cnpj} value={e.cnpj}>
                  {e.apelido}
                  {n ? ` · ${n} terceiro(s)` : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {empresa && (
        <>
          {salvos.length > 8 && (
            <div className="field" style={{ maxWidth: 360, marginBottom: 8 }}>
              <label htmlFor="ter-busca">Buscar ({salvos.length} cadastrados)</label>
              <input id="ter-busca" value={busca} placeholder="nome, CNPJ ou cidade" onChange={(e) => setBusca(e.target.value)} />
            </div>
          )}
          {salvos.length > 0 ? (
            <div className="table-wrap" style={{ marginBottom: 14, maxHeight: 480, overflowY: "auto" }}>
              <table className="dados">
                <thead>
                  <tr>
                    <th>Tomador</th>
                    <th>CNPJ</th>
                    <th>Endereço</th>
                    <th>Telefone / e-mail</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((t) => (
                    <tr key={t.cnpj} style={{ background: editando === soDigitos(t.cnpj) ? "var(--surface-2)" : undefined }}>
                      <td>{t.razao}</td>
                      <td className="mono">{t.cnpj}</td>
                      <td>{t.endereco || <span className="hint">—</span>}</td>
                      <td>{[t.telefone, t.email].filter(Boolean).join(" · ") || <span className="hint">—</span>}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="btn btn-sm" onClick={() => abrir(soDigitos(t.cnpj))}>
                          Editar
                        </button>{" "}
                        <button type="button" className="btn btn-sm danger" onClick={() => void remover(t)}>
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="hint">Nenhum terceiro cadastrado em {empresa.apelido} ainda.</p>
          )}

          <form onSubmit={salvar}>
            <div className="kpi-label" style={{ marginBottom: 6 }}>
              {editando ? `Editar ${c.razao || "tomador"}` : `Novo tomador de ${empresa.apelido}`}
            </div>
            <div className="form-grid tres">
              {campo("razao", "Razão social *")}
              {campo("cnpj", "CNPJ *", { dica: "00.000.000/0000-00" })}
              {campo("telefone", "Telefone")}
              {campo("endereco", "Endereço da sede (com CEP)", { full: true, dica: "Rua, nº, bairro, CEP, cidade - UF (do cartão CNPJ)" })}
              {campo("email", "E-mail", { type: "email" })}
            </div>
            {erro && (
              <div className="alert-box critical" role="alert">
                <ul>
                  <li>{erro}</li>
                </ul>
              </div>
            )}
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="submit" className="btn primary" disabled={salvando}>
                {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar tomador"}
              </button>
              {editando && (
                <button type="button" className="btn" onClick={() => abrir("")}>
                  Novo tomador
                </button>
              )}
              <button type="button" className="btn" onClick={onFechar}>
                Fechar
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
