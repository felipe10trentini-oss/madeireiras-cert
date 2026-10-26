"use client";

// Emissão do comunicado de tratamento: escolhe a empresa, cola o texto (mensagem do cliente, e-mail,
// lista) e o site preenche o Excel modelo da empresa (timbre e logo dela) com o número seguinte.
import { useEffect, useMemo, useState } from "react";
import { regraDe } from "@/lib/certificado";
import {
  lerModeloComunicado,
  preencherComunicado,
  proximoNumero,
  ROTULOS_COMUNICADO,
  type CampoComunicado,
  type ModeloComunicado,
} from "@/lib/comunicadoModelo";
import { interpretarTexto } from "@/lib/comunicadoTexto";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos } from "@/lib/util";
import { SoltarArquivos } from "./SoltarArquivos";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Empresas se descredenciando (26/10/2026): não emitem mais comunicado pelo site.
const SEM_COMUNICADO = new Set(["Flavia", "JJR", "Megga", "Vale Norte"]);

/** Cidade do endereço ("… - Salto - SP" / "… Salto/SP") para a coluna LOCAL da tabela (CJ). */
function cidadeDe(endereco: string): string {
  const m = endereco.replace(/CEP:?\s*[\d.]+-?\d*/gi, " ").match(/([A-Za-zÀ-ÿ' .]+?)\s*[-–/]\s*[A-Z]{2}\.?\s*$/);
  return m ? m[1].trim() : "";
}

/**
 * Modelo em tabela (CJ Tedeski): interessado (razão social) e cidade saem do tomador e do local, e as
 * colunas vão em maiúsculas (como as fórmulas da planilha dela).
 */
function completarTabela(m: ModeloComunicado, v: Partial<Record<CampoComunicado, string>>): Partial<Record<CampoComunicado, string>> {
  if (!m.campos.interessado && !m.campos.cidade) return v;
  const out = { ...v };
  const razao = (v.tomador ?? "").replace(/\s*[-–;,]?\s*CNPJ.*$/i, "").trim();
  if (m.campos.interessado && razao) out.interessado = razao.toUpperCase();
  if (m.campos.cidade && v.local) out.cidade = (cidadeDe(v.local) || v.cidade || "").toUpperCase();
  if (out.produto) out.produto = out.produto.toUpperCase();
  return out;
}

interface Salvo {
  salvo: boolean;
  nomeModelo: string | null;
  ultimoNumero: string | null;
  bytes: Uint8Array | null;
}

const deBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const paraBase64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

function baixar(bytes: Uint8Array, nome: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** "COMUNICADO 001-2026- MADEPALLETE- BR-PR0940.xlsx" + "360/2026" -> "COMUNICADO 360-2026- MADEPALLETE- BR-PR0940.xlsx". */
function nomeDoArquivo(modelo: string | null, numero: string, apelido: string): string {
  const n = numero.replace(/\//g, "-");
  const base = modelo ?? `COMUNICADO 000-0000 - ${apelido}.xlsx`;
  const trocado = base.replace(/(COMUNICADO\s+)\d{1,5}(?:-[A-Z]{1,4})?-\d{2,4}/i, `$1${n}`);
  return (trocado === base ? `COMUNICADO ${n} - ${apelido}.xlsx` : trocado).replace(/[\\/:*?"<>|]/g, "-");
}

export function Comunicados({ senha, sair }: { senha: string; sair: () => void }) {
  const [empresas, setEmpresas] = useState<MadeireiraSalva[] | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [salvo, setSalvo] = useState<Salvo | null>(null);
  const [modelo, setModelo] = useState<ModeloComunicado | null>(null);
  const [texto, setTexto] = useState("");
  const [valores, setValores] = useState<Partial<Record<CampoComunicado, string>>>({});
  const [achados, setAchados] = useState<CampoComunicado[]>([]);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    fetch("/api/madeireiras", { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (r) => (r.status === 401 ? sair() : setEmpresas((await r.json()).empresas ?? [])))
      .catch(() => setErro("Não foi possível carregar o cadastro."));
  }, [senha, sair]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const lista = useMemo(
    () =>
      (empresas ?? [])
        .filter((e) => e.documento === "comunicado" && !e.config?.inativa && !SEM_COMUNICADO.has(e.apelido))
        .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR")),
    [empresas]
  );
  const empresa = lista.find((e) => e.cnpj === cnpj) ?? null;
  const tomadores = useMemo(() => Object.values(empresa?.relatorio?.tomadores ?? {}).sort((a, b) => a.razao.localeCompare(b.razao, "pt-BR")), [empresa]);

  // Modelo da empresa (pasta privada) e o próximo número.
  useEffect(() => {
    if (!cnpj) return;
    let vivo = true;
    fetch(`/api/comunicados/modelo?cnpj=${soDigitos(cnpj)}`, { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) return sair();
        const j = await r.json();
        if (!vivo) return;
        const bytes = j.modelo ? deBase64(j.modelo) : null;
        setSalvo({ salvo: !!j.salvo, nomeModelo: j.nomeModelo, ultimoNumero: j.ultimoNumero, bytes });
        if (!bytes) {
          setModelo(null);
          return;
        }
        try {
          const m = await lerModeloComunicado(bytes);
          if (!vivo) return;
          setModelo(m);
          const base = Object.fromEntries(Object.values(m.campos).map((c) => [c!.campo, c!.valor])) as Partial<Record<CampoComunicado, string>>;
          base.numero = proximoNumero(j.ultimoNumero ?? m.campos.numero?.valor, new Date().getFullYear());
          setValores(base);
          setAchados([]);
          setAvisos([]);
        } catch (e) {
          setErro(e instanceof Error ? e.message : "Não consegui ler o modelo.");
        }
      })
      .catch(() => vivo && setErro("Não foi possível carregar o modelo do comunicado."));
    return () => {
      vivo = false;
    };
  }, [cnpj, senha, sair, versao]);

  function escolher(c: string) {
    setCnpj(c);
    setSalvo(null);
    setModelo(null);
    setValores({});
    setTexto("");
    setAchados([]);
    setAvisos([]);
    setErro(null);
  }

  async function carregarModelo(files: File[]) {
    const f = files.find((x) => /\.xlsx$/i.test(x.name));
    if (!f || !empresa) return setToast("Solte o Excel (.xlsx) do comunicado da empresa.");
    setOcupado(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const m = await lerModeloComunicado(bytes);
      const res = await fetch("/api/comunicados/modelo", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: empresa.cnpj, nome: f.name, modelo: paraBase64(bytes), ultimoNumero: m.campos.numero?.valor ?? "" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return setToast(j.error ?? "Não foi possível salvar o modelo.");
      setToast(`Modelo salvo (${Object.keys(m.campos).length} campos). Último comunicado: ${m.campos.numero?.valor || "—"}.`);
      setVersao((v) => v + 1);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não consegui ler este Excel.");
    } finally {
      setOcupado(false);
    }
  }

  function identificar() {
    if (!modelo || !empresa) return;
    const doModelo = Object.fromEntries(Object.values(modelo.campos).map((c) => [c!.campo, c!.valor])) as Partial<Record<CampoComunicado, string>>;
    const r = interpretarTexto(texto, { tomadores, prestadora: !!regraDe(empresa).prestadora, modelo: doModelo });
    // Número: o seguinte; na Mann/Exata o comunicado leva o número do aviso.
    const numeroEhAviso = !!modelo.campos.aviso && modelo.campos.aviso.valor === modelo.campos.numero?.valor;
    r.valores.numero =
      numeroEhAviso && r.achados.includes("aviso") ? r.valores.aviso! : proximoNumero(salvo?.ultimoNumero ?? modelo.campos.numero?.valor, new Date().getFullYear());
    setValores(completarTabela(modelo, r.valores));
    setAchados(r.achados);
    setAvisos(r.avisos);
  }

  function trocarTomador(razaoCnpj: string) {
    const t = tomadores.find((x) => `${x.razao} - CNPJ ${x.cnpj}` === razaoCnpj);
    setValores((v) => {
      const novo = { ...v, tomador: razaoCnpj, ...(t && empresa && regraDe(empresa).prestadora && t.endereco ? { local: t.endereco } : {}) };
      return modelo ? completarTabela(modelo, novo) : novo;
    });
  }

  async function gerar() {
    if (!salvo?.bytes || !modelo || !empresa) return;
    const numero = (valores.numero ?? "").trim();
    if (!numero) return setToast("Informe o número do comunicado.");
    setOcupado(true);
    try {
      // Todos os campos (os modelos da Mann/Exata têm fórmulas que puxariam o comunicado anterior).
      const todos = Object.fromEntries(Object.keys(modelo.campos).map((k) => [k, valores[k as CampoComunicado] ?? ""]));
      const bytes = await preencherComunicado(salvo.bytes, modelo, todos);
      baixar(bytes, nomeDoArquivo(salvo.nomeModelo, numero, empresa.apelido));
      const res = await fetch("/api/comunicados/modelo", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: empresa.cnpj, ultimoNumero: numero }),
      });
      setSalvo((s) => (s ? { ...s, ultimoNumero: numero } : s));
      setToast(res.ok ? `Comunicado ${numero} gerado. Abra o Excel e salve em PDF.` : `Comunicado ${numero} gerado, mas não consegui guardar o número.`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível gerar o comunicado.");
    } finally {
      setOcupado(false);
    }
  }

  const campos = modelo ? ROTULOS_COMUNICADO.filter(([c]) => modelo.campos[c]) : [];
  const longo = new Set<CampoComunicado>(["tomador", "local", "quantidade", "produto", "observacao"]);

  return (
    <div className="view">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-label">Empresa do comunicado</div>
        <select value={cnpj} onChange={(e) => escolher(e.target.value)} aria-label="Empresa" disabled={!empresas}>
          <option value="">{empresas ? "— escolha a empresa —" : "Carregando o cadastro…"}</option>
          {lista.map((e) => (
            <option key={e.cnpj} value={e.cnpj}>
              {e.apelido}
            </option>
          ))}
        </select>
        <div className="kpi-sub">Só as empresas que emitem comunicado (as outras usam programação).</div>
      </div>

      {erro && (
        <div className="alert-box critical" role="alert">
          <h4>Não foi possível continuar</h4>
          <ul>
            <li>{erro}</li>
          </ul>
        </div>
      )}

      {empresa && salvo && (
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <span className="hint">
            Modelo: {salvo.salvo ? `“${salvo.nomeModelo ?? "comunicado.xlsx"}”` : "ainda não carregado"}
            {salvo.ultimoNumero ? ` · último comunicado: ${salvo.ultimoNumero}` : ""}
          </span>
        </div>
      )}

      {empresa && salvo && (
        <SoltarArquivos
          titulo={ocupado ? "Lendo o modelo…" : salvo.salvo ? "Trocar o modelo (Excel do comunicado)" : "Arraste o Excel do comunicado da empresa"}
          dica={
            <>
              O <b>.xlsx</b> que vocês usam hoje (ex.: “COMUNICADO 001-2026 - {empresa.apelido}.xlsx”): o site acha os campos pelos rótulos e usa o
              timbre e o logo dele. O número que estiver nele é o do último comunicado.
            </>
          }
          accept=".xlsx"
          ocupado={ocupado}
          onArquivos={(fs) => void carregarModelo(fs)}
        />
      )}

      {empresa && modelo && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <label htmlFor="com-texto" className="kpi-label">
              Cole aqui o pedido do tratamento
            </label>
            <textarea
              id="com-texto"
              rows={7}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"Ex.: Tratamento amanhã às 13:30 para a MRP Comercio\n50 kit caixas 1000x1200x680\n8 paletes 1300x1300"}
              style={{ width: "100%" }}
            />
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn primary" disabled={!texto.trim()} onClick={identificar}>
                Identificar
              </button>
              <span className="hint">O que não estiver no texto fica como no último comunicado; confira antes de gerar.</span>
            </div>
          </div>

          {avisos.length > 0 && (
            <div className="alert-box">
              <h4>Confira</h4>
              <ul>
                {avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="kpi-label">Comunicado</div>
            <div className="form-grid tres">
              {campos.map(([c, , rotulo]) => (
                <div className={`field${longo.has(c) ? " full" : ""}`} key={c}>
                  <label htmlFor={`com-${c}`}>
                    {rotulo}
                    {achados.includes(c) ? <span className="badge pago" style={{ marginLeft: 6 }}>do texto</span> : null}
                  </label>
                  {c === "tomador" && tomadores.length > 0 ? (
                    <>
                      <input id={`com-${c}`} list="com-tomadores" value={valores[c] ?? ""} onChange={(e) => trocarTomador(e.target.value)} />
                      <datalist id="com-tomadores">
                        {tomadores.map((t) => (
                          <option key={t.cnpj} value={`${t.razao} - CNPJ ${t.cnpj}`} />
                        ))}
                      </datalist>
                    </>
                  ) : (
                    <input id={`com-${c}`} value={valores[c] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn primary lg" disabled={ocupado} onClick={() => void gerar()}>
                Gerar comunicado (Excel)
              </button>
              <span className="hint">Sai no Excel da empresa, com o timbre e o logo; abra e salve em PDF para protocolar.</span>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div id="toast-host" role="status">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}
