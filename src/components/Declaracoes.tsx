"use client";

import JSZip from "jszip";
import { useEffect, useState } from "react";
import { CAMPOS_REMESSA, dadosIniciais, linhaDoMestre, nomeArquivo, type DadosDeclaracao, type LinhaTratamento } from "@/lib/declaracao";
import { CNPJ_LG, manualLg, montarDeclaracaoLg } from "@/lib/declaracaoLg";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { aplicar, regraLegivel, type Fonte } from "@/lib/aprenderRemessa";
import type { CertificadoMestre } from "@/lib/certificadoMestre";
import { aplicarPadrao, aprenderDoTexto, type PadraoDeclaracao } from "@/lib/modeloDeclaracao";
import type { NotaFiscal } from "@/lib/notaFiscal";
import { lerPlanilhaDR, type LinhaDR } from "@/lib/planilhaDR";
import { preencherModelo, textoDoModelo } from "@/lib/preencherModelo";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { hojeBR, soDigitos } from "@/lib/util";
import { lerFonte, ModeloDeclaracao, type ModeloSalvo } from "./ModeloDeclaracao";
import { PreviaWord } from "./PreviaWord";
import { SoltarArquivos } from "./SoltarArquivos";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface Item {
  arquivoNf: string;
  nf: NotaFiscal | null;
  erro?: string;
  dados: DadosDeclaracao | null;
  avisos: string[];
  arquivo: string;
}

const LINHA_VAZIA: LinhaTratamento = { certificado: "", ciclo: "", lote: "", inicio: "", fim: "", tipo: "HT", temperatura: "56", duracao: "32 min", quantidade: "" };

/** Edição de uma declaração (dados da nota e da DR já preenchidos). */
function Editor({ d, onChange }: { d: DadosDeclaracao; onChange: (d: DadosDeclaracao) => void }) {
  const set = <K extends keyof DadosDeclaracao>(k: K, v: DadosDeclaracao[K]) => onChange({ ...d, [k]: v });
  const setLinha = (i: number, k: keyof LinhaTratamento, v: string) => onChange({ ...d, linhas: d.linhas.map((l, j) => (j === i ? { ...l, [k]: v } : l)) });
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-label">Remessa</div>
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
        <p className="hint">Só entram os campos que existem no Word da empresa; em branco, fica o texto do modelo.</p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="kpi-label">Tratamento</div>
        <div className="form-grid tres">
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


/** Declaração em branco para preencher à mão: os campos fixos vêm do Word modelo da empresa. */
function manualDe(e: MadeireiraSalva | null, padrao?: PadraoDeclaracao): DadosDeclaracao {
  if (e && soDigitos(e.cnpj) === CNPJ_LG) return aplicarPadrao(manualLg(e, hojeBR()), padrao);
  const base = dadosIniciais([], e, hojeBR());
  return aplicarPadrao({ ...base, exportador: "", destinatario: "", localTratamento: e?.endereco ?? "", linhas: [{ ...LINHA_VAZIA }] }, padrao);
}

function deBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function Declaracoes({ senha, sair }: { senha: string; sair: () => void }) {
  const [empresas, setEmpresas] = useState<MadeireiraSalva[] | null>(null);
  const [cnpj, setCnpj] = useState("");
  const [nfs, setNfs] = useState<File[]>([]);
  const [drArquivo, setDrArquivo] = useState<string | null>(null);
  const [dr, setDr] = useState<Map<string, LinhaDR> | null>(null);
  const [modelo, setModelo] = useState<ModeloSalvo | null>(null);
  const [padrao, setPadrao] = useState<PadraoDeclaracao | undefined>(undefined);
  const [itens, setItens] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const [previa, setPrevia] = useState<Uint8Array | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editandoModelo, setEditandoModelo] = useState(false);
  const [versaoModelo, setVersaoModelo] = useState(0);
  const [modeloSolto, setModeloSolto] = useState<File | null>(null);

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
  // Empresas com o preenchimento automático (nota fiscal + DR). As outras: declaração manual.
  const automatico = soDigitos(cnpj) === CNPJ_LG;

  // Word modelo da empresa (pasta privada do Supabase).
  useEffect(() => {
    if (!cnpj) return;
    let vivo = true;
    fetch(`/api/declaracoes/modelo?cnpj=${soDigitos(cnpj)}`, { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (r) => {
        const j = r.ok ? await r.json() : null;
        if (!vivo) return;
        const bytes = j?.modelo ? deBase64(j.modelo) : null;
        setModelo(j ? { salvo: !!j.salvo, nomeModelo: j.nomeModelo, atualizado: j.atualizado, bytes, regras: j.regras ?? {}, documentos: j.documentos ?? [] } : null);
        setPadrao(bytes ? aprenderDoTexto(await textoDoModelo(bytes)).padrao : undefined);
        // Empresa sem modelo: abre a edição para carregar o Word.
        if (j && !j.salvo) setEditandoModelo(true);
      })
      .catch(() => vivo && setModelo(null));
    return () => {
      vivo = false;
    };
  }, [cnpj, senha, versaoModelo]);

  const atual = itens[sel];

  // Prévia do Word preenchido da declaração aberta.
  useEffect(() => {
    if (!atual?.dados || !modelo?.bytes) return;
    let vivo = true;
    const t = setTimeout(() => {
      void preencherModelo(modelo.bytes!, atual.dados!).then((r) => vivo && setPrevia(r.bytes));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [atual?.dados, modelo?.bytes]);

  function escolherEmpresa(c: string) {
    setCnpj(c);
    setModelo(null);
    setPadrao(undefined);
    setEditandoModelo(false);
    setItens([]);
    setNfs([]);
    setDr(null);
    setDrArquivo(null);
    setErro(null);
  }

  /** Documentos de uma remessa (empresa com regras aprendidas): uma declaração preenchida por eles. */
  async function soltarRemessa(files: File[]) {
    if (!modelo) return;
    setCarregando(true);
    try {
      const lidos = await Promise.all(files.map((f) => lerFonte(f, senha)));
      const fontes: Fonte[] = lidos.filter((f) => !f.erro && !f.mestre);
      const mestres = lidos.map((f) => f.mestre as CertificadoMestre | undefined).filter((m): m is CertificadoMestre => !!m);
      const { valores, faltando } = aplicar(modelo.regras, fontes);
      const d = manualDe(empresa, padrao);
      const [exp, ...end] = (valores.exportador ?? "").split("\n");
      const dados: DadosDeclaracao = {
        ...d,
        exportador: exp ?? "",
        enderecoExportador: end.join("\n"),
        importador: valores.importador ?? d.importador,
        navio: valores.navio ?? d.navio,
        fatura: valores.fatura ?? d.fatura,
        nfe: valores.nfe ?? d.nfe,
        booking: valores.booking ?? d.booking,
        bl: valores.bl ?? d.bl,
        container: valores.container ?? d.container,
        marcas: valores.marcas ?? d.marcas,
        volumes: valores.volumes ?? d.volumes,
        pesoLiquido: valores.pesoLiquido ?? d.pesoLiquido,
        pesoBruto: valores.pesoBruto ?? d.pesoBruto,
        comunicado: valores.programacao ?? d.comunicado,
        observacao: valores.observacao ?? d.observacao,
        linhas: mestres.length ? mestres.map(linhaDoMestre) : d.linhas,
      };
      const avisos = [
        ...lidos.filter((f) => f.erro).map((f) => `${f.nome}: ${f.erro}`),
        ...faltando.map((k) => `Não achei ${regraLegivel(`{${k}}`)} nos documentos: confira o campo.`),
        ...(mestres.length ? [] : ["Sem certificado mestre entre os arquivos: preencha as linhas do tratamento (ou solte o PDF do mestre junto)."]),
      ];
      const nf = fontes.find((f) => f.nf)?.nf ?? null;
      setItens((xs) => [...xs, { arquivoNf: files.map((f) => f.name).join(", "), nf, dados, avisos, arquivo: "" }]);
      setSel(itens.length);
    } finally {
      setCarregando(false);
    }
  }

  function novaManual() {
    setItens((xs) => [...xs, { arquivoNf: "manual", nf: null, dados: manualDe(empresa, padrao), avisos: [], arquivo: "" }]);
    setSel(itens.length);
  }

  async function escolherDR(f: File): Promise<Map<string, LinhaDR> | null> {
    try {
      const m = await lerPlanilhaDR(await f.arrayBuffer());
      if (!m.size) {
        setToast("Não achei lotes na aba DADOS da planilha.");
        return null;
      }
      setDr(m);
      setDrArquivo(`${f.name} · ${m.size} lotes`);
      // Declarações já montadas: refaz o tratamento com a DR nova.
      setItens((xs) => xs.map((x) => (x.nf ? { ...x, ...montarDeclaracaoLg(x.nf, m, empresa, x.dados?.data ?? hojeBR()) } : x)));
      return m;
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível ler a planilha DR.");
      return null;
    }
  }

  /** Arquivos soltos na área: .xlsx = DR, .pdf = notas fiscais (já monta), .docx = modelo. */
  async function soltar(files: File[]) {
    const planilha = files.find((f) => /\.xlsx$/i.test(f.name));
    const word = files.find((f) => /\.docx$/i.test(f.name));
    const notas = files.filter((f) => /\.pdf$/i.test(f.name));
    let drUsar = dr;
    if (planilha) drUsar = (await escolherDR(planilha)) ?? dr;
    if (word) {
      setModeloSolto(word);
      setEditandoModelo(true);
    }
    if (notas.length) await montar(notas, drUsar);
  }

  async function montar(notas: File[], drUsar: Map<string, LinhaDR> | null) {
    if (!notas.length) return;
    setCarregando(true);
    setErro(null);
    const hoje = hojeBR();
    const out: Item[] = [];
    for (const f of notas) {
      try {
        const form = new FormData();
        form.append("arquivo", f);
        const res = await fetch("/api/declaracoes/nf", { method: "POST", headers: cabecalhoSenha(senha), body: form });
        if (res.status === 401) return sair();
        const j = await res.json();
        if (!res.ok || !j.nf) {
          out.push({ arquivoNf: f.name, nf: null, erro: j.error ?? "Não reconheci a nota fiscal (DANFE) neste PDF.", dados: null, avisos: [], arquivo: "" });
          continue;
        }
        out.push({ arquivoNf: f.name, nf: j.nf, ...montarDeclaracaoLg(j.nf, drUsar, empresa, hoje) });
      } catch {
        out.push({ arquivoNf: f.name, nf: null, erro: "Falha de conexão.", dados: null, avisos: [], arquivo: "" });
      }
    }
    // Soma às que já estão na lista; a mesma nota de novo troca a anterior.
    const numeros = new Set(out.map((x) => x.nf?.numero).filter(Boolean));
    const ficam = itens.filter((x) => !(x.nf?.numero && numeros.has(x.nf.numero)) && !x.erro);
    setItens([...ficam, ...out]);
    setNfs((xs) => [...xs.filter((x) => !notas.some((n) => n.name === x.name)), ...notas]);
    setSel(ficam.length + Math.max(0, out.findIndex((x) => x.dados)));
    setCarregando(false);
  }

  const nomeDe = (it: Item) => it.arquivo || (it.dados ? nomeArquivo(it.dados) : "declaracao.docx");

  async function baixar(i: number) {
    const it = itens[i];
    if (!it?.dados || !modelo?.bytes) return;
    try {
      const r = await preencherModelo(modelo.bytes, it.dados);
      baixarBlob(r.bytes, nomeDe(it), DOCX);
      if (r.avisos.length) setToast(r.avisos.join(" "));
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível gerar o Word.");
    }
  }

  async function baixarTodas() {
    if (!modelo?.bytes) return;
    const zip = new JSZip();
    const usados = new Set<string>();
    for (const it of itens) {
      if (!it.dados) continue;
      let nome = nomeDe(it);
      for (let n = 2; usados.has(nome); n++) nome = nomeDe(it).replace(/\.docx$/, ` (${n}).docx`);
      usados.add(nome);
      zip.file(nome, (await preencherModelo(modelo.bytes, it.dados)).bytes);
    }
    const nomeZip = `Declarações ${empresa?.apelido ?? ""} ${hojeBR().replace(/\//g, "-")}.zip`.replace(/\s+/g, " ");
    baixarBlob(await zip.generateAsync({ type: "uint8array" }), nomeZip, "application/zip");
    setToast("Arquivo .zip gerado: extraia na pasta Declarações do mês.");
  }

  const prontos = itens.filter((x) => x.dados).length;
  const semModelo = !!cnpj && !!modelo && !modelo.salvo;

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
              ? "Automática: a nota fiscal traz o cliente e os lotes, a DR traz o tratamento. Também dá para fazer à mão."
              : "Declaração manual: você preenche os dados e o site coloca no Word modelo da empresa."}
        </div>
      </div>

      {cnpj && modelo && !editandoModelo && (
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <span className="hint">
            Modelo (Word): {modelo.salvo ? `“${modelo.nomeModelo ?? "modelo.docx"}”` : "ainda não carregado"}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setEditandoModelo(true)}>
            {modelo.salvo ? "Editar modelo" : "Carregar modelo"}
          </button>
        </div>
      )}
      {cnpj && editandoModelo && (
        <ModeloDeclaracao
          key={`${cnpj}-${versaoModelo}`}
          senha={senha}
          cnpj={cnpj}
          nome={empresa?.apelido ?? cnpj}
          atual={modelo}
          arquivoInicial={modeloSolto}
          onFechar={() => {
            setEditandoModelo(false);
            setModeloSolto(null);
          }}
          onSalvo={() => {
            setEditandoModelo(false);
            setModeloSolto(null);
            setVersaoModelo((v) => v + 1);
            setToast("Modelo salvo: as próximas declarações desta empresa saem neste Word.");
          }}
        />
      )}

      {erro && (
        <div className="alert-box critical" role="alert">
          <h4>Não foi possível continuar</h4>
          <ul>
            <li>{erro}</li>
          </ul>
        </div>
      )}

      {cnpj && !semModelo && automatico && (
        <>
          <SoltarArquivos
            titulo={carregando ? "Lendo as notas…" : "Arraste as notas fiscais e a DR"}
            dica={
              <>
                Solte aqui as <b>notas fiscais (PDF)</b> e a <b>planilha DR (xlsx)</b>, juntas ou separadas, ou clique para escolher. O site já
                monta as declarações.
              </>
            }
            accept=".pdf,.xlsx,.docx"
            ocupado={carregando}
            onArquivos={(fs) => void soltar(fs)}
          />
          <div className="actions" style={{ marginTop: 0 }}>
            <span className={`badge ${dr ? "pago" : "pendente"}`}>{drArquivo ? `DR: ${drArquivo}` : "DR ainda não carregada"}</span>
            {nfs.length > 0 && <span className="hint">{nfs.length} nota(s) lida(s)</span>}
            {!dr && nfs.length > 0 && <span className="hint">Sem a DR, as linhas do tratamento ficam em branco: solte a DR e elas se completam.</span>}
            <div className="spacer" />
            <button type="button" className="btn" onClick={novaManual}>
              Fazer manualmente
            </button>
          </div>
        </>
      )}

      {cnpj && !semModelo && !automatico && modelo && Object.keys(modelo.regras).length > 0 && (
        <SoltarArquivos
          titulo={carregando ? "Lendo os documentos…" : "Arraste os documentos da remessa"}
          dica={
            <>
              Solte juntos os documentos de <b>uma remessa</b> (NF-e, BL, booking, invoice e o certificado mestre, em PDF): sai uma declaração
              preenchida com o que o site aprendeu no modelo.
            </>
          }
          accept=".pdf"
          ocupado={carregando}
          onArquivos={(fs) => void soltarRemessa(fs)}
        />
      )}
      {cnpj && !semModelo && !automatico && modelo && (
        <div className="actions">
          <button type="button" className={`btn${Object.keys(modelo.regras).length ? "" : " primary lg"}`} onClick={novaManual}>
            Nova declaração manual
          </button>
          {!Object.keys(modelo.regras).length && (
            <span className="hint">Para preencher sozinho a partir dos documentos, ensine o site em “Editar modelo” (passo 2).</span>
          )}
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
                          disabled={!modelo?.bytes}
                          onClick={(e) => {
                            e.stopPropagation();
                            void baixar(i);
                          }}
                        >
                          Word
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
            <button type="button" className="btn primary lg" disabled={!prontos || !modelo?.bytes} onClick={() => void baixarTodas()}>
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
                <button type="button" className="btn primary" disabled={!modelo?.bytes} onClick={() => void baixar(sel)}>
                  Baixar Word desta declaração
                </button>
              </div>
              <div className="section-title">
                <h2>Prévia</h2>
                <p>O Word modelo da empresa com os dados trocados (prévia aproximada; o Word baixado é o fiel).</p>
              </div>
              <PreviaWord bytes={modelo?.bytes ? previa : null} />
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
