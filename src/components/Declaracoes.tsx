"use client";

import JSZip from "jszip";
import { useEffect, useState } from "react";
import {
  CAMPOS_REMESSA,
  dadosIniciais,
  dataExtenso,
  INTRO,
  linhasRemessa,
  linhasTratamento,
  mostrarLote,
  nomeArquivo,
  OPCOES_SUJEITO,
  textoTratamento,
  type DadosDeclaracao,
  type ItemTabela,
  type LinhaTratamento,
  type Sujeito,
} from "@/lib/declaracao";
import { gerarDeclaracaoPdf, type Timbre } from "@/lib/declaracaoPdf";
import { CNPJ_LG, manualLg, montarDeclaracaoLg } from "@/lib/declaracaoLg";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import type { NotaFiscal } from "@/lib/notaFiscal";
import { lerPlanilhaDR, type LinhaDR } from "@/lib/planilhaDR";
import { rtCompleto } from "@/lib/responsaveis";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { hojeBR, soDigitos } from "@/lib/util";

const PDF = "application/pdf";

/** Timbre do PDF: dados do cadastro + logo, assinatura e linhas do RT (pasta privada do Supabase). */
function montarTimbre(e: MadeireiraSalva | null, ativos: { logo: string | null; assinatura: string | null; rt: string[] } | null): Timbre {
  const rt = rtCompleto(e?.rt);
  return {
    razao: e?.razaoSocial ?? "",
    linhas: [e?.endereco ?? "", [e?.cnpj ? `CNPJ ${e.cnpj}` : "", e?.crea ? `Reg. CREA ${e.crea}` : ""].filter(Boolean).join("  ·  "), [e?.email, e?.telefone].filter(Boolean).join("  ·  ")],
    regMapa: e?.regMapa ?? "",
    logo: ativos?.logo,
    assinatura: ativos?.assinatura,
    rt: ativos?.rt?.length ? ativos.rt : [...(rt ? [rt] : []), "Responsável Técnico"],
  };
}

interface Item {
  arquivoNf: string;
  nf: NotaFiscal | null;
  erro?: string;
  dados: DadosDeclaracao | null;
  avisos: string[];
  arquivo: string;
}

const LINHA_VAZIA: LinhaTratamento = { certificado: "", ciclo: "", lote: "", inicio: "", fim: "", tipo: "HT", temperatura: "56", duracao: "32 min", quantidade: "" };

function Tabela({ titulo, grupos }: { titulo: [string, string]; grupos: ItemTabela[][] }) {
  if (!grupos.length) return null;
  const rot = (l: ItemTabela) => (
    <th>
      {l.pt}
      {l.en.toLowerCase() !== l.pt.toLowerCase() && <i> / {l.en}</i>}
    </th>
  );
  const val = (l: ItemTabela) => l.v.split("\n").map((t, i) => <div key={i}>{t}</div>);
  return (
    <table className="decl-tab">
      <thead>
        <tr>
          <td colSpan={4} className="faixa">
            {titulo[0].toUpperCase()} <i>· {titulo[1].toUpperCase()}</i>
          </td>
        </tr>
      </thead>
      <tbody>
        {grupos.map((g, i) => (
          <tr key={i}>
            {rot(g[0])}
            <td colSpan={g.length === 1 ? 3 : 1}>{val(g[0])}</td>
            {g[1] && (
              <>
                {rot(g[1])}
                <td>{val(g[1])}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Prévia da declaração (o PDF sai com o timbre, o logo e a assinatura da empresa). */
function Previa({ d }: { d: DadosDeclaracao }) {
  const trat = textoTratamento(d);
  const data = dataExtenso(d.data);
  const kd = d.linhas.some((l) => l.tipo === "KD");
  const lote = mostrarLote(d.linhas);
  const qtd = d.linhas.some((l) => l.quantidade);
  const cols: [string, string][] = [
    ["Ciclo", "Cycle"],
    ...(lote ? ([["Lote", "Batch"]] as [string, string][]) : []),
    ["Início", "Start"], ["Término", "End"], ["Trat.", "Treat."], ["Temp. mín.", "Min. temp."], ["Duração", "Duration"],
    ...(kd ? ([["Umid. máx.", "Max. moist."]] as [string, string][]) : []),
    ...(qtd ? ([["Qtd.", "Qty."]] as [string, string][]) : []),
  ];
  return (
    <div className="decl-doc">
      <div className="decl-timbre">Timbre da empresa (logo e dados do cadastro)</div>
      <h3>DECLARAÇÃO DE TRATAMENTO FITOSSANITÁRIO</h3>
      <p className="sub">Declaration of Phytosanitary Treatment</p>
      <p className="just">{INTRO.pt}</p>
      <p className="just en">{INTRO.en}</p>
      <Tabela titulo={["1. Dados da remessa", "Consignment details"]} grupos={linhasRemessa(d)} />
      <Tabela titulo={["2. Dados do tratamento", "Treatment details"]} grupos={linhasTratamento(d)} />
      {d.linhas.length > 0 && (
        <table className="decl-tab ciclos">
          <thead>
            <tr>
              <td colSpan={cols.length} className="faixa">
                CICLOS DE TRATAMENTO <i>· TREATMENT CYCLES</i>
              </td>
            </tr>
            <tr>
              {cols.map(([a, b]) => (
                <th key={a}>
                  {a} <i>/ {b}</i>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.linhas.map((l, i) => (
              <tr key={i}>
                <td>{l.ciclo || "—"}</td>
                {lote && <td>{l.lote || "—"}</td>}
                <td>{l.inicio || "—"}</td>
                <td>{l.fim || "—"}</td>
                <td>{l.tipo}</td>
                <td>{l.temperatura ? `${l.temperatura} °C` : "—"}</td>
                <td>{l.duracao || "—"}</td>
                {kd && <td>{l.tipo === "KD" ? d.umidade : "—"}</td>}
                {qtd && <td>{l.quantidade || "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="just">
        <b>Tratamento:</b> {trat.pt}
      </p>
      <p className="just en">
        <b>Treatment:</b> {trat.en}
      </p>
      {d.observacao.trim() && (
        <p>
          <b>Observações</b> / <i>Remarks:</i> {d.observacao}
        </p>
      )}
      <p className="dir">
        {d.localEmissao ? `${d.localEmissao}, ` : ""}
        {data.pt} <i>/ {data.en}</i>
      </p>
      <div className="decl-assinatura">
        <span>assinatura do RT</span>
      </div>
    </div>
  );
}

/** Edição de uma declaração (dados da nota e da DR já preenchidos). */
function Editor({ d, onChange }: { d: DadosDeclaracao; onChange: (d: DadosDeclaracao) => void }) {
  const set = <K extends keyof DadosDeclaracao>(k: K, v: DadosDeclaracao[K]) => onChange({ ...d, [k]: v });
  const setLinha = (i: number, k: keyof LinhaTratamento, v: string) => onChange({ ...d, linhas: d.linhas.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  const [texto, setTexto] = useState(false);
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-label">Remessa (da nota fiscal)</div>
        <div className="form-grid tres">
          {CAMPOS_REMESSA.map((c) =>
            c.k === "volumes" ? (
              <div className="field full" key={c.k}>
                <label htmlFor={`d-${c.k}`}>
                  {c.pt} / {c.en} (uma linha por item)
                </label>
                <textarea id={`d-${c.k}`} rows={2} value={d.volumes} onChange={(e) => set("volumes", e.target.value)} />
              </div>
            ) : (
              <div className={`field${["exportador", "enderecoExportador", "importador", "produto"].includes(c.k) ? " full" : ""}`} key={c.k}>
                <label htmlFor={`d-${c.k}`}>
                  {c.pt} / {c.en}
                </label>
                <input id={`d-${c.k}`} value={String(d[c.k] ?? "")} placeholder={c.dica} onChange={(e) => set(c.k, e.target.value as never)} />
              </div>
            )
          )}
        </div>
        <p className="hint">Campo em branco não aparece na declaração.</p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-label">Tratamento (da DR)</div>
        <div className="form-grid tres">
          <div className="field">
            <label htmlFor="d-suj">Material tratado (frase do tratamento)</label>
            <select id="d-suj" value={d.sujeito} onChange={(e) => set("sujeito", e.target.value as Sujeito)}>
              {OPCOES_SUJEITO.map((o) => (
                <option key={o.k} value={o.k}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-com">Programação / comunicado</label>
            <input id="d-com" value={d.comunicado} onChange={(e) => set("comunicado", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-local-trat">Local do tratamento</label>
            <input id="d-local-trat" value={d.localTratamento} onChange={(e) => set("localTratamento", e.target.value)} />
          </div>
        </div>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="dados">
            <thead>
              <tr>
                <th>Certificado</th>
                <th>Ciclo</th>
                <th>Início</th>
                <th>Término</th>
                <th>Trat.</th>
                <th>Temp.</th>
                <th>Duração</th>
                <th>Qtd.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.linhas.map((l, i) => (
                <tr key={i}>
                  {(["certificado", "ciclo", "inicio", "fim"] as const).map((k) => (
                    <td key={k}>
                      <input aria-label={k} value={l[k]} onChange={(e) => setLinha(i, k, e.target.value)} />
                    </td>
                  ))}
                  <td>
                    <select aria-label="Tratamento" value={l.tipo} onChange={(e) => setLinha(i, "tipo", e.target.value)}>
                      <option>HT</option>
                      <option>KD</option>
                    </select>
                  </td>
                  <td>
                    <input aria-label="Temperatura" value={l.temperatura} onChange={(e) => setLinha(i, "temperatura", e.target.value)} style={{ width: 50 }} />
                  </td>
                  <td>
                    <input aria-label="Duração" value={l.duracao} onChange={(e) => setLinha(i, "duracao", e.target.value)} style={{ width: 70 }} />
                  </td>
                  <td>
                    <input aria-label="Quantidade" value={l.quantidade ?? ""} onChange={(e) => setLinha(i, "quantidade", e.target.value)} style={{ width: 60 }} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-sm danger" onClick={() => set("linhas", d.linhas.filter((_, j) => j !== i))}>
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => set("linhas", [...d.linhas, { ...LINHA_VAZIA }])}>
            + Linha
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-label">Emissão</div>
        <div className="form-grid tres">
          <div className="field">
            <label htmlFor="d-local">Local de emissão</label>
            <input id="d-local" value={d.localEmissao} onChange={(e) => set("localEmissao", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="d-data">Data</label>
            <input id="d-data" value={d.data} onChange={(e) => set("data", e.target.value)} placeholder="dd/mm/aaaa" />
          </div>
          <div className="field">
            <label htmlFor="d-obs">Observações / Remarks</label>
            <input id="d-obs" value={d.observacao} onChange={(e) => set("observacao", e.target.value)} />
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => setTexto((v) => !v)}>
            {texto ? "Fechar edição do texto" : "Editar o texto do tratamento"}
          </button>
        </div>
        {texto && (
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="d-tpt">Tratamento (português) — em branco = automático</label>
              <textarea id="d-tpt" rows={3} value={d.textoPt} placeholder={textoTratamento({ ...d, textoPt: "" }).pt} onChange={(e) => set("textoPt", e.target.value)} />
            </div>
            <div className="field full">
              <label htmlFor="d-ten">Treatment (inglês) — em branco = automático</label>
              <textarea id="d-ten" rows={3} value={d.textoEn} placeholder={textoTratamento({ ...d, textoEn: "" }).en} onChange={(e) => set("textoEn", e.target.value)} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function baixarBlob(bytes: Uint8Array, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Declaração em branco para preencher à mão (qualquer empresa). */
function manualDe(e: MadeireiraSalva | null): DadosDeclaracao {
  if (e && soDigitos(e.cnpj) === CNPJ_LG) return manualLg(e, hojeBR());
  const base = dadosIniciais([], e, hojeBR());
  return { ...base, exportador: "", destinatario: "", localTratamento: e?.endereco ?? "", linhas: [{ ...LINHA_VAZIA }] };
}

type Ativos = { logo: string | null; assinatura: string | null; rt: string[] };

export function Declaracoes({ senha, sair }: { senha: string; sair: () => void }) {
  const [empresas, setEmpresas] = useState<MadeireiraSalva[] | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [nfs, setNfs] = useState<File[]>([]);
  const [drArquivo, setDrArquivo] = useState<string | null>(null);
  const [dr, setDr] = useState<Map<string, LinhaDR> | null>(null);
  const [ativos, setAtivos] = useState<Ativos | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  const empresa = empresas?.find((e) => soDigitos(e.cnpj) === soDigitos(cnpj)) ?? null;
  // Empresas com o modelo automático (nota fiscal + DR). As outras: declaração manual.
  const automatico = soDigitos(cnpj) === CNPJ_LG;

  // Logo, assinatura e linhas do RT da empresa escolhida (pasta privada do Supabase).
  useEffect(() => {
    if (!cnpj) return;
    let vivo = true;
    fetch(`/api/declaracoes/ativos?cnpj=${soDigitos(cnpj)}`, { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (r) => {
        const j = r.ok ? ((await r.json()) as Ativos) : null;
        if (vivo) setAtivos(j);
      })
      .catch(() => {
        if (vivo) setAtivos(null);
      });
    return () => {
      vivo = false;
    };
  }, [cnpj, senha]);

  function escolherEmpresa(c: string) {
    setCnpj(c);
    setAtivos(null);
    setItens([]);
    setNfs([]);
    setDr(null);
    setDrArquivo(null);
    setErro(null);
  }

  function novaManual() {
    setItens((xs) => [...xs, { arquivoNf: "manual", nf: null, dados: manualDe(empresa), avisos: [], arquivo: "" }]);
    setSel(itens.length);
  }

  async function escolherDR(f: File | null) {
    if (!f) return;
    try {
      const m = await lerPlanilhaDR(await f.arrayBuffer());
      if (!m.size) return setToast("Não achei lotes na aba DADOS da planilha.");
      setDr(m);
      setDrArquivo(`${f.name} · ${m.size} lotes`);
      // Declarações já montadas: refaz o tratamento com a DR nova.
      setItens((xs) => xs.map((x) => (x.nf ? { ...x, ...montarDeclaracaoLg(x.nf, m, empresa, x.dados?.data ?? hojeBR()) } : x)));
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível ler a planilha DR.");
    }
  }

  async function montar() {
    if (!nfs.length) return;
    setCarregando(true);
    setErro(null);
    const hoje = hojeBR();
    const out: Item[] = [];
    for (const f of nfs) {
      try {
        const form = new FormData();
        form.append("arquivo", f);
        const res = await fetch("/api/declaracoes/nf", { method: "POST", headers: cabecalhoSenha(senha), body: form });
        if (res.status === 401) return sair();
        const j = await res.json();
        if (!res.ok) {
          out.push({ arquivoNf: f.name, nf: null, erro: j.error ?? "Não foi possível ler.", dados: null, avisos: [], arquivo: "" });
          continue;
        }
        out.push({ arquivoNf: f.name, nf: j.nf, ...montarDeclaracaoLg(j.nf, dr, empresa, hoje) });
      } catch {
        out.push({ arquivoNf: f.name, nf: null, erro: "Falha de conexão.", dados: null, avisos: [], arquivo: "" });
      }
    }
    // As manuais ficam; as da leitura anterior são trocadas pelas novas.
    const manuais = itens.filter((x) => !x.nf && !x.erro);
    setItens([...manuais, ...out]);
    setSel(manuais.length + Math.max(0, out.findIndex((x) => x.dados)));
    setCarregando(false);
  }

  const timbre = () => montarTimbre(empresa, ativos);
  const nomeDe = (it: Item) => it.arquivo || (it.dados ? nomeArquivo(it.dados) : "declaracao.pdf");

  async function baixar(i: number) {
    const it = itens[i];
    if (!it?.dados) return;
    try {
      baixarBlob(await gerarDeclaracaoPdf(it.dados, timbre()), nomeDe(it), PDF);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    }
  }

  async function baixarTodas() {
    const zip = new JSZip();
    const usados = new Set<string>();
    for (const it of itens) {
      if (!it.dados) continue;
      let nome = nomeDe(it);
      for (let n = 2; usados.has(nome); n++) nome = nomeDe(it).replace(/\.pdf$/, ` (${n}).pdf`);
      usados.add(nome);
      zip.file(nome, await gerarDeclaracaoPdf(it.dados, timbre()));
    }
    const nomeZip = `Declarações ${empresa?.apelido ?? ""} ${hojeBR().replace(/\//g, "-")}.zip`.replace(/\s+/g, " ");
    baixarBlob(await zip.generateAsync({ type: "uint8array" }), nomeZip, "application/zip");
    setToast("Arquivo .zip gerado: extraia na pasta Declarações do mês.");
  }

  const atual = itens[sel];
  const prontos = itens.filter((x) => x.dados).length;

  return (
    <div className="view">
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-label">Empresa da declaração</div>
        <select value={cnpj} onChange={(e) => escolherEmpresa(e.target.value)} aria-label="Empresa" disabled={!empresas}>
          <option value="">{empresas ? "— escolha a empresa —" : "Carregando o cadastro…"}</option>
          {empresas
            ?.filter((e) => !e.config?.inativa)
            .slice()
            .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"))
            .map((e) => (
              <option key={e.cnpj} value={e.cnpj}>
                {e.apelido}
                {soDigitos(e.cnpj) === CNPJ_LG ? " · automática (nota fiscal + DR)" : ""}
              </option>
            ))}
        </select>
        <div className="kpi-sub">
          {!cnpj
            ? "Escolha a empresa para fazer a declaração."
            : automatico
              ? "Modelo automático: a nota fiscal traz o cliente e os lotes, a DR traz o tratamento. Também dá para fazer à mão."
              : "Esta empresa ainda não tem o modelo automático: faça a declaração à mão (o timbre vem do cadastro)."}
        </div>
      </div>

      {erro && (
        <div className="alert-box critical" role="alert">
          <h4>Não foi possível continuar</h4>
          <ul>
            <li>{erro}</li>
          </ul>
        </div>
      )}

      {cnpj && automatico && (
        <>
          <div className="grid kpis">
            <div className="card">
              <div className="kpi-label">1. Notas fiscais (PDF)</div>
              <label className="btn" style={{ display: "inline-block", cursor: "pointer" }}>
                {nfs.length ? "Trocar notas" : "Escolher notas"}
                <input type="file" accept="application/pdf" multiple hidden onChange={(e) => setNfs([...(e.target.files ?? [])])} />
              </label>
              <div className="kpi-sub">{nfs.length ? `${nfs.length} nota(s): ${nfs.map((f) => f.name).join(", ")}` : "pode escolher várias de uma vez"}</div>
            </div>
            <div className="card">
              <div className="kpi-label">2. Planilha DR (xlsx)</div>
              <label className="btn" style={{ display: "inline-block", cursor: "pointer" }}>
                {dr ? "Trocar DR" : "Escolher DR"}
                <input type="file" accept=".xlsx" hidden onChange={(e) => void escolherDR(e.target.files?.[0] ?? null)} />
              </label>
              <div className="kpi-sub">{drArquivo ?? "planilha DR da empresa (aba DADOS)"}</div>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="btn primary lg" disabled={!nfs.length || carregando} onClick={() => void montar()}>
              {carregando ? "Lendo as notas…" : `Montar ${nfs.length || ""} declaração(ões)`}
            </button>
            <button type="button" className="btn" onClick={novaManual}>
              Fazer manualmente
            </button>
            {!dr && nfs.length > 0 && <span className="hint">Sem a DR, as linhas do tratamento ficam em branco.</span>}
          </div>
        </>
      )}

      {cnpj && !automatico && (
        <div className="actions">
          <button type="button" className="btn primary lg" onClick={novaManual}>
            Nova declaração manual
          </button>
          {ativos && !ativos.logo && <span className="hint">Sem logo e assinatura guardados para esta empresa: o PDF sai com o timbre em texto.</span>}
        </div>
      )}

      {itens.length > 0 && (
        <>
          <div className="section-title">
            <h2>Declarações</h2>
            <p>
              {prontos} de {itens.length} pronta(s). Clique numa linha para conferir e editar.
            </p>
          </div>
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table className="dados">
              <thead>
                <tr>
                  <th>Nota</th>
                  <th>Cliente</th>
                  <th>Lotes</th>
                  <th>Arquivo</th>
                  <th>Conferir</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itens.map((it, i) => (
                  <tr key={i} onClick={() => it.dados && setSel(i)} style={{ cursor: it.dados ? "pointer" : undefined, background: i === sel ? "var(--surface-2)" : undefined }}>
                    <td className="mono">{it.nf?.numero ?? (it.erro ? "—" : "manual")}</td>
                    <td>{it.nf ? `${it.nf.destinatario.razao ?? ""} · ${it.nf.destinatario.municipio ?? ""}` : it.dados?.exportador || it.arquivoNf}</td>
                    <td className="mono">
                      {it.dados?.linhas
                        .map((l) => `${l.ciclo}${l.quantidade ? ` (${l.quantidade})` : ""}`)
                        .filter((x) => x.trim())
                        .join(", ") || "—"}
                    </td>
                    <td>{it.dados ? nomeDe(it) : "—"}</td>
                    <td>
                      {it.erro ? (
                        <span className="badge erro">{it.erro}</span>
                      ) : it.avisos.length ? (
                        <span className="badge pendente">{it.avisos.length} aviso(s)</span>
                      ) : (
                        <span className="badge pago">ok</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {it.dados && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void baixar(i);
                          }}
                        >
                          PDF
                        </button>
                      )}{" "}
                      <button
                        type="button"
                        className="btn btn-sm danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setItens((xs) => xs.filter((_, j) => j !== i));
                          setSel(0);
                        }}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar">
            <div className="spacer" />
            <button type="button" className="btn primary lg" disabled={!prontos} onClick={() => void baixarTodas()}>
              Baixar todas (.zip)
            </button>
          </div>

          {atual?.dados && (
            <>
              <div className="section-title">
                <h2>{atual.nf ? `NF ${atual.nf.numero} · ${atual.nf.destinatario.razao}` : "Declaração manual"}</h2>
                <p>{nomeDe(atual)}</p>
              </div>
              {atual.avisos.length > 0 && (
                <div className="alert-box">
                  <h4>Confira</h4>
                  <ul>
                    {atual.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Editor d={atual.dados} onChange={(d) => setItens((xs) => xs.map((x, j) => (j === sel ? { ...x, dados: d } : x)))} />
              <div className="toolbar">
                <div className="spacer" />
                <button type="button" className="btn primary" onClick={() => void baixar(sel)}>
                  Baixar PDF desta declaração
                </button>
              </div>
              <div className="section-title">
                <h2>Prévia</h2>
                <p>O PDF tem o mesmo conteúdo, com o timbre da empresa.</p>
              </div>
              <div className="paper-wrap">
                <Previa d={atual.dados} />
              </div>
            </>
          )}
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
