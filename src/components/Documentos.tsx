"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CertificadoMestre, DemonstrativoRastreabilidade } from "@/lib/certificadoMestre";
import {
  CAMPOS_MANUAIS,
  COMPRADORES_FREQUENTES,
  filialEmissora,
  materialDaDR,
  materialDoMestre,
  montarDocumento,
  valoresConsolidado,
  valoresDesdobrado,
  type Material,
  type TipoDocumento,
} from "@/lib/documentos";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos, ufDoMapa } from "@/lib/util";
import { FileDrop } from "./FileDrop";
import { SeiCard } from "./SeiCard";

type Lido = { tipo: "mestre"; mestre: CertificadoMestre; nomeArquivo: string } | { tipo: "dr"; dr: DemonstrativoRastreabilidade; nomeArquivo: string };

const ROTULOS_TODOS: Record<TipoDocumento, [string, string][]> = {
  desdobrado: [
    ["numero", "Nº do certificado desdobrado"], ["processo", "Nº do processo do certificado original"],
    ["1.1", "1.1. Razão social"], ["1.2", "1.2. CNPJ"], ["1.3", "1.3. CREA"], ["1.4", "1.4. Endereço"], ["1.5", "1.5. Telefone"],
    ["1.6", "1.6. E-mail"], ["1.7", "1.7. Registro MAPA"], ["2.1", "2.1. Razão social (comprador)"], ["2.2", "2.2. CNPJ (comprador)"],
    ["2.3", "2.3. Endereço (comprador)"], ["2.4", "2.4. Telefone (comprador)"], ["2.5", "2.5. E-mail (comprador)"],
    ["3.1", "3.1. Comunicados"], ["3.2", "3.2. Endereço do tratamento"], ["3.3", "3.3. Destino"], ["3.4", "3.4. Produto"],
    ["3.5", "3.5. Volumes"], ["3.6", "3.6. Quantidade"], ["3.7", "3.7. Lote"], ["3.8", "3.8. Ciclos"], ["3.9", "3.9. Marcas (NFe)"],
    ["3.10", "3.10. Modalidade"], ["3.11", "3.11. Data início"], ["3.12", "3.12. Horário início"], ["3.13", "3.13. Data término"],
    ["3.14", "3.14. Horário término"], ["3.15", "3.15. Temperatura / duração"], ["obs", "Observação (abaixo do 3.15)"], ["local", "4. Local de emissão"],
  ],
  consolidado: [
    ["numero", "Nº do certificado consolidado"], ["1.1", "1.1. Razão social"], ["1.2", "1.2. CNPJ"], ["1.3", "1.3. Endereço"],
    ["1.4", "1.4. Telefone"], ["1.5", "1.5. E-mail"], ["1.6", "1.6. Registro MAPA"], ["1.7", "1.7. CREA"],
    ["2.1", "2.1. Razão social (comprador)"], ["2.2", "2.2. CNPJ (comprador)"], ["2.3", "2.3. Endereço (comprador)"],
    ["2.4", "2.4. E-mail (comprador)"], ["2.5", "2.5. Telefone (comprador)"], ["3.1", "3.1. Endereço do tratamento"],
    ["3.2", "3.2. Destino"], ["3.3", "3.3. Produto"], ["3.4", "3.4. Volumes"], ["3.5", "3.5. Quantidade"], ["3.6", "3.6. Lotes"],
    ["3.8", "3.8. Marcas (NFe)"], ["local", "4. Local de emissão"],
  ],
};

export function Documentos({ senha, sair }: { senha: string; sair: () => void }) {
  const [empresas, setEmpresas] = useState<MadeireiraSalva[] | null>(null);
  const [tipo, setTipo] = useState<TipoDocumento>("desdobrado");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lido, setLido] = useState<Lido | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [material, setMaterial] = useState<Material>("palete");
  const [sequencia, setSequencia] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [volumes, setVolumes] = useState("");
  const [ajustes, setAjustes] = useState<Record<string, string>>({});
  const [editando, setEditando] = useState(false);
  const [bilingue, setBilingue] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const registrados = useRef(new Set<string>());
  // Compradores frequentes cadastrados na aba Cadastros (sem a tabela no banco, a lista padrão).
  const [compradores, setCompradores] = useState<string[]>(COMPRADORES_FREQUENTES);

  useEffect(() => {
    fetch("/api/madeireiras", { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (r) => (r.status === 401 ? sair() : setEmpresas((await r.json()).empresas ?? [])))
      .catch(() => setErro("Não foi possível carregar o cadastro."));
    fetch("/api/madeireiras/compradores", { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok && Array.isArray(d.compradores)) setCompradores(d.compradores.map((c: { razao: string }) => c.razao));
      })
      .catch(() => undefined);
  }, [senha, sair]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const empresa = empresas?.find((e) => soDigitos(e.cnpj) === soDigitos(cnpj)) ?? null;
  const filial = filialEmissora(empresa, empresas ?? []);
  const base =
    lido?.tipo === "mestre"
      ? valoresDesdobrado(lido.mestre, empresa, material, sequencia, quantidade, volumes, filial)
      : lido?.tipo === "dr"
        ? valoresConsolidado(lido.dr, empresa, material, filial)
        : null;
  const valores = base ? { ...base, ...ajustes } : null;
  const html = valores ? montarDocumento(tipo, valores, bilingue) : "";

  function novo() {
    setArquivo(null);
    setLido(null);
    setAjustes({});
    setErro(null);
    setEditando(false);
  }

  async function ler(e: FormEvent) {
    e.preventDefault();
    if (!arquivo) return;
    setCarregando(true);
    setErro(null);
    try {
      const form = new FormData();
      form.append("arquivo", arquivo);
      const res = await fetch("/api/documentos/ler", { method: "POST", headers: cabecalhoSenha(senha), body: form });
      if (res.status === 401) return sair();
      const data = await res.json();
      if (!res.ok) return setErro(data.error ?? "Não foi possível ler o PDF.");
      const l = data as Lido;
      if (tipo === "desdobrado" && l.tipo !== "mestre") return setErro("Para o desdobrado, envie o certificado mestre (PDF do SEI), não a DR.");
      if (tipo === "consolidado" && l.tipo !== "dr") return setErro("Para o consolidado, envie o PDF da DR (Demonstrativo de Rastreabilidade).");
      const doc = l.tipo === "mestre" ? l.mestre.cnpj : l.dr.cnpj;
      const achada = empresas?.find((x) => soDigitos(x.cnpj) === soDigitos(doc ?? ""));
      setCnpj(achada?.cnpj ?? "");
      setMaterial(l.tipo === "mestre" ? materialDoMestre(l.mestre) : materialDaDR(l.dr, achada));
      setAjustes({});
      setSequencia("");
      setQuantidade("");
      setVolumes("");
      setLido(l);
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setCarregando(false);
    }
  }

  async function copiar() {
    if (!valores) return;
    const texto = docRef.current?.innerText ?? "";
    try {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([texto], { type: "text/plain" }) }),
        ]);
      } catch {
        await navigator.clipboard.writeText(texto);
      }
      setToast("Copiado! No editor do SEI: Ctrl+A e Ctrl+V.");
    } catch {
      setToast("Não foi possível copiar. Permita o acesso à área de transferência.");
      return;
    }
    // Controladoria e sequência dos desdobrados: registra a emissão (uma vez por número).
    const chave = `${tipo}|${valores.numero}`;
    if (registrados.current.has(chave)) return;
    registrados.current.add(chave);
    void fetch("/api/emissoes", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
      body: JSON.stringify({
        empresaCnpj: valores["1.2"] || cnpj,
        empresaApelido: empresa?.apelido ?? valores["1.1"],
        numero: valores.numero,
        tipo: tipo === "desdobrado" ? "DESD" : "CONS",
        lote: tipo === "desdobrado" ? valores["3.7"] : valores["3.6"],
        ciclo: tipo === "desdobrado" ? valores["3.8"] : null,
        dataTratamento: tipo === "desdobrado" ? valores["3.11"] : null,
        divergencias: [],
      }),
    });
  }

  const manuais = CAMPOS_MANUAIS[tipo];
  const faltando = valores
    ? [
        ...(tipo === "desdobrado" && !sequencia ? [{ k: "numero", rotulo: "Nº do desdobramento" }] : []),
        ...(tipo === "desdobrado" && !volumes.trim() ? [{ k: "3.5", rotulo: "3.5." }] : []),
        ...(tipo === "desdobrado" && !quantidade.trim() ? [{ k: "3.6", rotulo: "3.6." }] : []),
        ...manuais.filter((c) => !valores[c.k] || ["m³", "unidades", "NFe"].includes(valores[c.k].trim())),
      ]
    : [];

  return (
    <div className="view">
      <div className="toolbar" style={{ gap: 8 }}>
        {(["desdobrado", "consolidado"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`btn${tipo === t ? " primary" : ""}`}
            onClick={() => {
              setTipo(t);
              novo();
            }}
          >
            {t === "desdobrado" ? "Certificado desdobrado" : "Certificado consolidado"}
          </button>
        ))}
      </div>

      {!lido ? (
        <form onSubmit={ler}>
          <p className="lead">
            {tipo === "desdobrado" ? (
              <>
                Envie o <b>certificado mestre</b> (PDF do SEI). O site identifica a empresa e preenche o desdobrado; o nº é o do
                mestre com “-1”, “-2”… e o processo original vem do rodapé do mestre. Ficam para você: a sequência, 2.1, 2.2, 3.5 (fardos/volumes), 3.6 e a NFe (3.9).
              </>
            ) : (
              <>
                Envie a <b>DR</b> do consolidado (PDF do Demonstrativo de Rastreabilidade). O nº do consolidado e os lotes vêm da
                DR. Ficam para você: 2.1, 2.2, a quantidade (3.5) e a NFe (3.8).
              </>
            )}
          </p>
          <div className="drops" style={{ gridTemplateColumns: "1fr" }}>
            <FileDrop
              titulo={tipo === "desdobrado" ? "Certificado mestre" : "DR do consolidado"}
              dica={tipo === "desdobrado" ? "Arraste o PDF do certificado mestre (ex.: CERT 089 AGK 468.pdf)" : "Arraste o PDF da DR (ex.: 2026-389-C DR.pdf)"}
              arquivo={arquivo}
              onArquivo={setArquivo}
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
          <div className="actions">
            <button type="submit" className="btn primary lg" disabled={!arquivo || carregando || !empresas}>
              {carregando ? "Lendo o PDF…" : "Ler o PDF"}
            </button>
          </div>
        </form>
      ) : (
        valores && (
          <>
            {!empresa && (
              <div className="alert-box">
                <h4>Confira</h4>
                <ul>
                  <li>Não achei a empresa do PDF no cadastro: escolha abaixo (os dados 1.x vêm do PDF enquanto isso).</li>
                </ul>
              </div>
            )}
            <div className="grid kpis">
              <div className="card">
                <div className="kpi-label">
                  Empresa {empresa && <span className="uf-destaque pequeno">{ufDoMapa(empresa.regMapa, empresa.uf) ?? "?"}</span>}
                </div>
                <select value={cnpj} onChange={(e) => setCnpj(e.target.value)} aria-label="Empresa">
                  <option value="">— escolha —</option>
                  {empresas?.filter((e) => !e.config?.inativa || e.cnpj === cnpj).map((e) => (
                    <option key={e.cnpj} value={e.cnpj}>
                      {e.apelido} · {ufDoMapa(e.regMapa, e.uf) ?? "?"} · {e.regMapa}
                    </option>
                  ))}
                </select>
                <div className="kpi-sub">{lido.nomeArquivo}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Material</div>
                <select value={material} onChange={(e) => setMaterial(e.target.value as Material)} aria-label="Material">
                  <option value="palete">Paletes / embalagens</option>
                  <option value="madeira">Madeira serrada</option>
                </select>
                <div className="kpi-sub">{tipo === "desdobrado" && valores.obs ? "com a observação de umidade < 18% (KD)" : " "}</div>
              </div>
              <div className="card">
                <div className="kpi-label">Nº do {tipo === "desdobrado" ? "desdobrado" : "consolidado"}</div>
                <div className="kpi-value text mono">{valores.numero || "—"}</div>
                <div className="kpi-sub">
                  {tipo === "desdobrado"
                    ? sequencia
                      ? "sequência digitada em “Preencher”"
                      : "falta a sequência (em “Preencher”)"
                    : lido.tipo === "dr"
                      ? `${lido.dr.linhas.length} tratamento(s) na DR`
                      : ""}
                </div>
              </div>
            </div>

            {empresa && <SeiCard key={empresa.cnpj} senha={senha} empresa={empresa} valores={{ cnpj: valores["1.2"], razao: valores["1.1"] }} onToast={setToast} />}

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="kpi-label">Preencher</div>
              <div className="form-grid">
                {tipo === "desdobrado" && (
                  <div className="field">
                    <label htmlFor="m-seq">Sequência do desdobrado (nº {lido.tipo === "mestre" ? lido.mestre.numero : ""}-?)</label>
                    <input
                      id="m-seq"
                      value={sequencia}
                      onChange={(e) => setSequencia(e.target.value.replace(/[^0-9A-Za-z]/g, "").toUpperCase())}
                      placeholder="1, 2, 3… ou A, B, C…"
                    />
                  </div>
                )}
                {tipo === "desdobrado" && (
                  <div className="field">
                    <label htmlFor="m-vol">3.5. Quantidade de {material === "palete" ? "volumes" : "fardos"}</label>
                    <input
                      id="m-vol"
                      inputMode="numeric"
                      value={volumes}
                      onChange={(e) => setVolumes(e.target.value)}
                      placeholder="ex.: 12"
                    />
                  </div>
                )}
                {tipo === "desdobrado" && (
                  <div className="field">
                    <label htmlFor="m-qtd">3.6. Quantidade de produto tratado ({material === "palete" ? "unidades" : "m³"})</label>
                    <input
                      id="m-qtd"
                      inputMode="decimal"
                      value={quantidade}
                      onChange={(e) => setQuantidade(e.target.value)}
                      placeholder={material === "palete" ? "ex.: 250" : "ex.: 50,252"}
                    />
                  </div>
                )}
                {tipo === "desdobrado" && (
                  <div className="field">
                    <label htmlFor="m-comprador">Comprador frequente (preenche o 2.1)</label>
                    <select
                      id="m-comprador"
                      value={compradores.includes(valores["2.1"] ?? "") ? valores["2.1"] : ""}
                      onChange={(e) => setAjustes((a) => ({ ...a, "2.1": e.target.value }))}
                    >
                      <option value="">— nenhum (digitar no 2.1) —</option>
                      {compradores.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                )}
                {manuais.map((c) => (
                  <div className="field" key={c.k}>
                    <label htmlFor={`m-${c.k}`}>{c.rotulo}</label>
                    <input id={`m-${c.k}`} value={valores[c.k] ?? ""} onChange={(e) => setAjustes((a) => ({ ...a, [c.k]: e.target.value }))} />
                  </div>
                ))}
              </div>
              {faltando.length > 0 && (
                <p className="hint">Falta completar: {faltando.map((c) => (c.k === "numero" ? c.rotulo : c.rotulo.split(" ")[0])).join(", ")}</p>
              )}
            </div>

            <div className="toolbar">
              <div className="spacer" />
              <button
                type="button"
                className={`btn${bilingue ? " primary" : ""}`}
                onClick={() => setBilingue((b) => !b)}
                title="Rótulos e textos-padrão em português / inglês (as declarações do final ficam em português)"
              >
                {bilingue ? "Português / Inglês ✓" : "Traduzir para inglês"}
              </button>
              <button type="button" className="btn" onClick={() => setEditando((v) => !v)}>
                {editando ? "Fechar edição" : "Editar todos os campos"}
              </button>
              <button type="button" className="btn" onClick={novo}>
                Novo
              </button>
              <button type="button" className="btn primary lg" onClick={copiar}>
                Copiar certificado
              </button>
            </div>

            {editando && (
              <div className="card" style={{ marginBottom: 18 }}>
                <div className="form-grid">
                  {ROTULOS_TODOS[tipo].map(([k, r]) => (
                    <div className={`field${/endere|3\.2|3\.1|obs/i.test(r) ? " full" : ""}`} key={k}>
                      <label htmlFor={`e-${k}`}>{r}</label>
                      <input id={`e-${k}`} value={valores[k] ?? ""} onChange={(e) => setAjustes((a) => ({ ...a, [k]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="section-title">
              <h2>
                Prévia do certificado {tipo}
                {bilingue ? " · português / inglês" : ""}
              </h2>
              <p>Modelo do SEI “Certificado TFQ - {tipo === "desdobrado" ? "Desdobrado" : "Consolidado"} - HT”.</p>
            </div>
            <div className="paper-wrap">
              <div ref={docRef} className="sei-doc" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          </>
        )
      )}

      {toast && (
        <div id="toast-host" role="status">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}
