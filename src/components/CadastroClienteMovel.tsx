"use client";

// Cadastro de um cliente (tomador) da Mann móvel no próprio site — alternativa ao upload da
// planilha de clientes. Grava pela mesma rota do upload (/api/madeireiras/clientes), que só
// cadastra ou atualiza pelo CNPJ (nunca apaga).
import { useState, type FormEvent } from "react";
import { REGRAS_EMPRESA } from "@/lib/certificado";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import type { Tomador } from "@/lib/relatorio";
import { CNPJ_MANN_MOVEL } from "@/lib/relatorioMannMovel";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos } from "@/lib/util";

const VAZIO: Tomador = { razao: "", cnpj: "", endereco: "", telefone: "", email: "" };

/** Prestadoras com clientes (Mann móvel primeiro). */
export function prestadorasDe(empresas: MadeireiraSalva[] | null): MadeireiraSalva[] {
  return (empresas ?? [])
    .filter((e) => REGRAS_EMPRESA[soDigitos(e.cnpj)]?.prestadora)
    .sort((a, b) => Number(soDigitos(b.cnpj) === CNPJ_MANN_MOVEL) - Number(soDigitos(a.cnpj) === CNPJ_MANN_MOVEL));
}

export function FormClienteMovel({
  senha,
  empresas,
  onSalvo,
  onCancelar,
}: {
  senha: string;
  empresas: MadeireiraSalva[] | null;
  onSalvo: (msg: string) => void;
  onCancelar: () => void;
}) {
  const prestadoras = prestadorasDe(empresas);
  const [cnpjPrestadora, setCnpjPrestadora] = useState(prestadoras[0]?.cnpj ?? "");
  const prestadora = prestadoras.find((p) => p.cnpj === cnpjPrestadora) ?? prestadoras[0] ?? null;
  const salvos = Object.values(prestadora?.relatorio?.tomadores ?? {}).sort((a, b) => a.razao.localeCompare(b.razao, "pt-BR"));
  const [editando, setEditando] = useState<string>(""); // CNPJ (dígitos) do cliente em edição; "" = novo
  const [c, setC] = useState<Tomador>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  function abrir(cnpj: string) {
    setEditando(cnpj);
    setErro(null);
    setC(cnpj ? { ...VAZIO, ...(prestadora?.relatorio?.tomadores?.[cnpj] ?? {}) } : VAZIO);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!prestadora) return;
    if (!c.razao.trim()) return setErro("Informe o nome (razão social) do cliente.");
    if (soDigitos(c.cnpj).length !== 14) return setErro("CNPJ inválido (precisa ter 14 dígitos).");
    if (editando && soDigitos(c.cnpj) !== editando) return setErro("O CNPJ é a chave do cliente: para outro CNPJ, cadastre um cliente novo.");
    if (!editando && salvos.some((s) => soDigitos(s.cnpj) === soDigitos(c.cnpj))) {
      return setErro("Esse CNPJ já está cadastrado: escolha o cliente em “Editar cliente” para alterar.");
    }
    setSalvando(true);
    try {
      const res = await fetch("/api/madeireiras/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: prestadora.cnpj, clientes: [c], ignoradas: 0, modo: "aplicar" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data.error ?? "Não foi possível salvar.");
      onSalvo(data.novos?.length ? `${c.razao} cadastrado.` : data.atualizados?.length ? `${c.razao} atualizado.` : "Nada mudou.");
      abrir("");
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setSalvando(false);
    }
  }

  if (!prestadora) return <p className="hint">Nenhuma prestadora (Mann móvel) no cadastro.</p>;

  const campo = (k: keyof Tomador, rotulo: string, extra: { full?: boolean; type?: string } = {}) => (
    <div className={`field${extra.full ? " full" : ""}`}>
      <label htmlFor={`cli-${k}`}>{rotulo}</label>
      <input id={`cli-${k}`} type={extra.type ?? "text"} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
    </div>
  );

  return (
    <form className="card" onSubmit={salvar} style={{ marginBottom: 18 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>{editando ? `Editar ${c.razao || "cliente"}` : "Cadastrar cliente da móvel"}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Tomador do serviço: entra no certificado (2.1–2.5) quando o comunicado traz esse CNPJ. {salvos.length} cliente(s) em {prestadora.apelido}.
      </p>
      <div className="form-grid tres" style={{ marginBottom: 10 }}>
        {prestadoras.length > 1 && (
          <div className="field">
            <label htmlFor="cli-prest">Prestadora</label>
            <select
              id="cli-prest"
              value={prestadora.cnpj}
              onChange={(e) => {
                setCnpjPrestadora(e.target.value);
                abrir("");
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
        <div className="field">
          <label htmlFor="cli-editar">Editar cliente</label>
          <select id="cli-editar" value={editando} onChange={(e) => abrir(e.target.value)}>
            <option value="">— novo cliente —</option>
            {salvos.map((s) => (
              <option key={s.cnpj} value={soDigitos(s.cnpj)}>
                {s.razao} · {s.cnpj}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-grid tres">
        {campo("razao", "Nome / razão social *")}
        {campo("cnpj", "CNPJ *")}
        {campo("telefone", "Telefone")}
        {campo("endereco", "Endereço completo (com CEP)", { full: true })}
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
          {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar cliente"}
        </button>
        <button type="button" className="btn" onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
