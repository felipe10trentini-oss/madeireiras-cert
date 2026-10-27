"use client";

import JSZip from "jszip";
import { useEffect, useRef, useState } from "react";
import { CAMPOS_REMESSA, dadosIniciais, linhaDoMestre, nomeArquivo, type DadosDeclaracao, type LinhaTratamento } from "@/lib/declaracao";
import { CNPJ_LG, manualLg, montarDeclaracaoLg } from "@/lib/declaracaoLg";
import { blsDoTexto, CNPJ_MANN_VOLANTE, montarDeclaracaoPadrao, quantidadeDigitada, type DadosBL, type MestreLido } from "@/lib/declaracaoMann";
import {
  ativosDoModelo,
  baixarFontes,
  completarTimbre,
  corDoLogo,
  gerarPdfLgB,
  gerarPdfPadrao,
  type AtivosModelo,
  type FontesPdf,
} from "@/lib/declaracaoLgPdf";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { aplicar, regraLegivel, type Fonte } from "@/lib/aprenderRemessa";
import type { CertificadoMestre } from "@/lib/certificadoMestre";
import { aplicarPadrao, aprenderDoTexto, type PadraoDeclaracao } from "@/lib/modeloDeclaracao";
import type { CartaCorrecao, NotaFiscal } from "@/lib/notaFiscal";
import { lerPlanilhaDR, type LinhaDR } from "@/lib/planilhaDR";
import { lerRelatorioTermico, linhasDoCiclo, type LinhaRelatorio } from "@/lib/relatorioMapa";
import { camposDoWord, completarComNihil, preencherModelo, textoDoModelo } from "@/lib/preencherModelo";
import { rtCompleto } from "@/lib/responsaveis";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { hojeBR, soDigitos } from "@/lib/util";
import { lerFonte, ModeloDeclaracao, type ModeloSalvo } from "./ModeloDeclaracao";
import { ColarPedido } from "./ColarPedido";
import { PreviaPdf } from "./PreviaPdf";
import { PreviaWord } from "./PreviaWord";
import { SoltarArquivos } from "./SoltarArquivos";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";

interface Item {
  arquivoNf: string;
  nf: NotaFiscal | null;
  erro?: string;
  dados: DadosDeclaracao | null;
  avisos: string[];
  arquivo: string;
  /** A nota como veio (sem a carta de correção), para refazer quando a carta chegar depois. */
  original?: NotaFiscal;
  /** Modelo padrão (todas menos a LG): a nota e/ou os BLs desta declaração (para refazer quando chegar o mestre). */
  mann?: { nf: NotaFiscal | null; bls: DadosBL[]; ciclos?: string[]; escolhas?: Record<string, string> };
}

/** Ciclos do pedido com a quantidade de cada um, como se digita no campo: "90 x 252, 200 x 226". */
function ciclosComQuantidade(bls: DadosBL[]): string[] | undefined {
  const q: Record<string, string> = Object.assign({}, ...bls.map((b) => b.quantidades ?? {}));
  if (!Object.keys(q).length) return undefined;
  return [...new Set(bls.flatMap((b) => b.ciclos))].map((c) => (q[c] ? `${q[c].match(/^[\d.]+/)?.[0]} x ${c}` : c));
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
            c.k === "volumes" || c.k === "enderecoExportador" ? (
              <div className="field full" key={c.k}>
                <label htmlFor={`d-${c.k}`}>
                  {c.pt} / {c.en} ({c.k === "volumes" ? "uma linha por item" : "rua na 1ª linha, cidade - UF na 2ª"})
                </label>
                <textarea
                  id={`d-${c.k}`}
                  rows={2}
                  value={String(d[c.k] ?? "")}
                  aria-invalid={c.k === "volumes" && !String(d.volumes ?? "").trim()}
                  placeholder={c.k === "volumes" ? "Ex.: 100 paletes de madeira/ wooden pallets" : undefined}
                  style={c.k === "volumes" && !String(d.volumes ?? "").trim() ? { borderColor: "var(--bad)", background: "var(--bad-bg)" } : undefined}
                  onChange={(e) => set(c.k, e.target.value as never)}
                />
                {c.k === "volumes" && !String(d.volumes ?? "").trim() && <span className="hint" style={{ color: "var(--bad)" }}>Quantidade não encontrada nos documentos: preencha.</span>}
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
        <p className="hint">
          Só entram os campos que existem no Word da empresa. Modelo padrão (todas menos a LG): o que os documentos não trazem vai como <b>Nihil</b>; apague o campo (deixe
          em branco) para ele sair da declaração.
        </p>
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
function manualDe(e: MadeireiraSalva | null, padrao?: PadraoDeclaracao, campos?: Set<string> | null): DadosDeclaracao {
  const d = manualSemNihil(e, padrao);
  // Modelo padrão: os campos do Word começam "Nihil" (apagar = o campo sai da declaração).
  return e && soDigitos(e.cnpj) !== CNPJ_LG ? completarComNihil(d, campos as Parameters<typeof completarComNihil>[1]) : d;
}

function manualSemNihil(e: MadeireiraSalva | null, padrao?: PadraoDeclaracao): DadosDeclaracao {
  if (e && soDigitos(e.cnpj) === CNPJ_LG) return aplicarPadrao(manualLg(e, hojeBR()), padrao);
  const base = dadosIniciais([], e, hojeBR());
  // Mann Unidade Volante: o tratamento é na casa do cliente (vem do mestre); emite em Curitiba.
  if (e && soDigitos(e.cnpj) === CNPJ_MANN_VOLANTE) {
    return aplicarPadrao({ ...base, exportador: "", destinatario: "", localTratamento: "", localEmissao: "Curitiba - PR", linhas: [{ ...LINHA_VAZIA }] }, padrao);
  }
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
  // Cartas de correção lidas (pelo nº da nota).
  const [cartas, setCartas] = useState<Map<string, CartaCorrecao>>(new Map());
  // Modelo padrão: certificados mestres soltos (valem para as notas/BLs que vierem depois).
  const [mestresMann, setMestresMann] = useState<MestreLido[]>([]);
  // Relatório do MAPA da empresa (aba TÉRMICO): o tratamento de cada ciclo, no lugar dos mestres.
  const [relatorio, setRelatorio] = useState<{ nome: string; linhas: LinhaRelatorio[]; atualizado?: string } | null>(null);
  // Rótulos que o Word da empresa tem (o que faltar nos documentos vai "Nihil").
  const [camposModelo, setCamposModelo] = useState<Set<string> | null>(null);
  // Editor dos campos da declaração aberta (abre sozinho quando falta a quantidade).
  const [editando, setEditando] = useState(false);

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
  // Todas as empresas menos a LG (modelo padrão): nota fiscal (ou BL) + certificado mestre do ciclo.
  const mann = !!cnpj && !automatico;

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
        setCamposModelo(bytes ? await camposDoWord(bytes) : null);
        // Empresa sem modelo: abre a edição para carregar o Word.
        if (j && !j.salvo) setEditandoModelo(true);
      })
      .catch(() => vivo && setModelo(null));
    return () => {
      vivo = false;
    };
  }, [cnpj, senha, versaoModelo]);

  // Último relatório do MAPA guardado da empresa (pasta privada): já vem carregado.
  useEffect(() => {
    if (!cnpj || soDigitos(cnpj) === CNPJ_LG) return;
    let vivo = true;
    fetch(`/api/declaracoes/relatorio?cnpj=${soDigitos(cnpj)}`, { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (r) => {
        const j = r.ok ? await r.json() : null;
        if (vivo && j?.salvo && Array.isArray(j.linhas)) {
          // Um por ano (os dois últimos): "2026: MANN & CIA - 2026.xlsx + 2025: …".
          const rs = (j.relatorios ?? []) as { ano: string; nome: string; atualizado: string }[];
          setRelatorio({ nome: rs.map((r) => `${r.ano}: ${r.nome}`).join(" + "), linhas: j.linhas, atualizado: rs[0]?.atualizado });
        }
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [cnpj, senha]);

  const atual = itens[sel];
  const faltaCampo = !!atual?.dados && !atual.dados.volumes.trim();
  const editorAberto = editando || faltaCampo;

  // Prévia do Word preenchido da declaração aberta.
  useEffect(() => {
    if (!atual?.dados || !modelo?.bytes) return;
    let vivo = true;
    const t = setTimeout(() => {
      void preencherModelo(modelo.bytes!, atual.dados!, { removerVazios: !automatico }).then((r) => vivo && setPrevia(r.bytes));
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [atual?.dados, modelo?.bytes, automatico]);

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
    setCartas(new Map());
    setMestresMann([]);
    setRelatorio(null);
  }

  /**
   * Modelo padrão (todas menos a LG): notas fiscais, BLs/bookings e certificados mestres, juntos ou
   * em levas. Uma declaração por nota (ou por BL, quando não vem nota); o ciclo escrito na nota/BL
   * escolhe o mestre. Mestre que chega depois completa as declarações que estavam esperando por ele.
   */
  async function soltarMann(files: File[]) {
    const word = files.find((f) => /\.docx$/i.test(f.name));
    if (word) {
      setModeloSolto(word);
      setEditandoModelo(true);
    }
    // Relatório do MAPA (.xlsx): refaz as declarações que já estão na lista com o tratamento dele.
    let rel = relatorio;
    const planilha = files.find((f) => /\.xlsx$/i.test(f.name));
    if (planilha) {
      try {
        const linhas = await lerRelatorioTermico(await planilha.arrayBuffer());
        if (!linhas.length) setToast("Não achei tratamentos na aba TÉRMICO deste relatório.");
        else {
          // O relatório novo troca o do mesmo ano; o do outro ano guardado continua valendo.
          const anoDe = (ls: LinhaRelatorio[]) => {
            const c = new Map<string, number>();
            for (const l of ls) {
              const a = l.data.slice(-4);
              c.set(a, (c.get(a) ?? 0) + 1);
            }
            return [...c.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
          };
          const ano = anoDe(linhas);
          const outros = (relatorio?.linhas ?? []).filter((l) => l.data.slice(-4) !== ano);
          rel = { nome: `${ano}: ${planilha.name}`, linhas: [...linhas, ...outros], atualizado: new Date().toISOString() };
          setRelatorio(rel);
          // Guarda para as próximas vezes (troca o anterior desta empresa).
          void fetch("/api/declaracoes/relatorio", {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
            body: JSON.stringify({ cnpj: soDigitos(cnpj), nome: planilha.name, linhas }),
          })
            .then((r) => setToast(r.ok ? `Relatório de ${ano} guardado: ${linhas.length} tratamentos. Da próxima vez ele já vem carregado.` : "O relatório foi lido, mas não consegui guardá-lo para a próxima vez."))
            .catch(() => setToast("O relatório foi lido, mas não consegui guardá-lo para a próxima vez."));
        }
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Não foi possível ler o relatório.");
      }
    }
    // PDF ou imagem (foto/print da nota, do BL…: lida por OCR).
    const pdfs = files.filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f.name) || f.type.startsWith("image/"));
    // Pedido escrito/colado na caixa (ColarPedido): lido aqui mesmo, como o texto de um print.
    const textos = files.filter((f) => f.type === "text/plain" || /\.txt$/i.test(f.name));
    if (!pdfs.length && !textos.length) {
      if (rel && rel !== relatorio) {
        const r = rel;
        setItens((xs) => xs.map((x) => (x.mann ? remontar(x, mestresMann, r.linhas) : x)));
      }
      return;
    }
    setCarregando(true);
    setErro(null);
    const notas: { f: File; nf: NotaFiscal }[] = [];
    const bls: { f: File; bl: DadosBL }[] = [];
    const novosMestres: MestreLido[] = [];
    const erros: Item[] = [];
    for (const f of textos) for (const bl of blsDoTexto(await f.text())) bls.push({ f, bl });
    for (const f of pdfs) {
      try {
        const form = new FormData();
        form.append("arquivo", f);
        const res = await fetch("/api/declaracoes/nf", { method: "POST", headers: cabecalhoSenha(senha), body: form });
        if (res.status === 401) return sair();
        const j = await res.json();
        if (!res.ok) erros.push({ arquivoNf: f.name, nf: null, erro: j.error ?? "Não consegui ler este PDF.", dados: null, avisos: [], arquivo: "" });
        else if (j.nf) notas.push({ f, nf: j.nf });
        else if (j.mestre) novosMestres.push({ mestre: j.mestre, texto: j.texto ?? "" });
        // BL/booking/packing list/pedido: pedido com vários clientes vira uma declaração por cliente.
        else for (const bl of blsDoTexto(j.texto ?? "")) bls.push({ f, bl });
      } catch {
        erros.push({ arquivoNf: f.name, nf: null, erro: "Falha de conexão.", dados: null, avisos: [], arquivo: "" });
      }
    }
    // O mesmo mestre de novo troca o anterior.
    const mestres = [...mestresMann.filter((m) => !novosMestres.some((n) => n.mestre.numero === m.mestre.numero)), ...novosMestres];
    setMestresMann(mestres);
    const hoje = hojeBR();
    const montarMann = (arquivoNf: string, nf: NotaFiscal | null, b: DadosBL[], data: string): Item => ({
      arquivoNf,
      nf,
      ...montarDeclaracaoPadrao(nf, b, mestres, empresa, data, { relatorio: rel?.linhas, campos: camposModelo }),
      mann: { nf, bls: b },
    });
    const out: Item[] = [];
    if (notas.length) {
      // BL junto com a nota: vai para a nota do mesmo ciclo (ou para a única nota da leva).
      for (const { f, nf } of notas) {
        const doCiclo = bls.filter(({ bl }) => notas.length === 1 || bl.ciclos.some((c) => nf.ciclos?.includes(c)));
        out.push(montarMann([f.name, ...doCiclo.map((x) => x.f.name)].join(" + "), nf, doCiclo.map((x) => x.bl), hoje));
      }
    } else {
      for (const { f, bl } of bls) out.push(montarMann(f.name, null, [bl], hoje));
    }
    // As que já estavam: a mesma nota de novo troca a anterior; com mestre novo, refaz as automáticas.
    const numeros = new Set(out.map((x) => x.nf?.numero).filter(Boolean));
    const ficam = itens
      .filter((x) => !(x.nf?.numero && numeros.has(x.nf.numero)) && !x.erro)
      .map((x) => (x.mann && (novosMestres.length || rel !== relatorio) ? remontar(x, mestres, rel?.linhas ?? null) : x));
    if (!out.length && novosMestres.length && !ficam.some((x) => x.mann)) {
      setToast(`${novosMestres.length} certificado(s) mestre(s) lido(s): solte agora a nota fiscal ou o BL do cliente.`);
    }
    setItens([...ficam, ...out, ...erros]);
    setSel(ficam.length + Math.max(0, out.findIndex((x) => x.dados)));
    setCarregando(false);
  }

  /** Refaz uma declaração do modelo padrão (mestre ou relatório novo, ciclos digitados). */
  function remontar(x: Item, mestres: MestreLido[], rel: LinhaRelatorio[] | null, ciclos?: string[], escolhas?: Record<string, string>): Item {
    if (!x.mann) return x;
    const cs = ciclos ?? x.mann.ciclos;
    const es = escolhas ?? x.mann.escolhas;
    return {
      ...x,
      ...montarDeclaracaoPadrao(x.mann.nf, x.mann.bls, mestres, empresa, x.dados?.data ?? hojeBR(), { relatorio: rel, ciclos: cs, escolhas: es, campos: camposModelo }),
      mann: { ...x.mann, ciclos: cs, escolhas: es },
    };
  }

  /** Ciclos da declaração como aparecem no campo: os digitados, os do pedido/nota ou os das linhas. */
  const ciclosDe = (x: Item): string[] =>
    (x.mann?.ciclos ?? (x.mann && ciclosComQuantidade(x.mann.bls)) ?? x.nf?.ciclos ?? x.dados?.linhas.map((l) => l.lote || l.ciclo) ?? []).filter(Boolean);
  const novoCiclo = useRef<HTMLInputElement>(null);
  /** "+ Adicionar ciclo": mais um ciclo na mesma declaração (o tratamento dele vem do relatório). */
  function adicionarCiclo(i: number) {
    const c = novoCiclo.current?.value.trim();
    if (!c) return;
    trocarCiclos(i, [...ciclosDe(itens[i]), c].join(", "));
    novoCiclo.current!.value = "";
  }

  /** Ciclos digitados (a nota não traz): puxa o tratamento deles do relatório/mestres. */
  function trocarCiclos(i: number, texto: string) {
    // Separados por vírgula, ponto e vírgula ou "e" antes de número; cada um pode ter o cliente
    // ("508 Rio Claro, 964 Madex"). Só números com espaço ("972 973") também separa.
    const ciclos = texto
      .split(/\s*[,;/\n]\s*|\s+e\s+(?=\d)/)
      .flatMap((c) => (/^\d+(?:\s+\d+)+$/.test(c.trim()) ? c.trim().split(/\s+/) : [c.trim()]))
      .filter(Boolean);
    setItens((xs) => xs.map((x, j) => (j === i ? remontar(x, mestresMann, relatorio?.linhas ?? null, ciclos) : x)));
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
      const d = manualDe(empresa, padrao, camposModelo);
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
    setItens((xs) => [...xs, { arquivoNf: "manual", nf: null, dados: manualDe(empresa, padrao, camposModelo), avisos: [], arquivo: "" }]);
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
      setItens((xs) => xs.map((x) => (x.original ? montarItem(x.arquivoNf.replace(/ \+ carta de correção$/, ""), x.original, m, cartas.get(x.original.numero ?? ""), x.dados?.data ?? hojeBR()) : x)));
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
    const notas = files.filter((f) => /\.(pdf|png|jpe?g|webp)$/i.test(f.name) || f.type.startsWith("image/"));
    let drUsar = dr;
    if (planilha) drUsar = (await escolherDR(planilha)) ?? dr;
    if (word) {
      setModeloSolto(word);
      setEditandoModelo(true);
    }
    if (notas.length) await montar(notas, drUsar);
  }

  /** Nota com a carta de correção aplicada: os lotes da carta valem no lugar dos da nota. */
  function comCarta(nf: NotaFiscal, cc: CartaCorrecao | undefined): { nf: NotaFiscal; aviso: string | null } {
    if (!cc) return { nf, aviso: null };
    const aviso = cc.lotes.length
      ? `Lotes da carta de correção${cc.sequencia ? ` nº ${cc.sequencia}` : ""}: ${cc.lotes.map((l) => `${l.quantidade ?? "?"} un. lote ${l.lote}`).join(", ")}.`
      : `A carta de correção desta nota não fala de lote (“${cc.correcao.slice(0, 120)}”): confira.`;
    return { nf: cc.lotes.length ? { ...nf, lotes: cc.lotes } : nf, aviso };
  }

  function montarItem(arquivoNf: string, nf: NotaFiscal, drUsar: Map<string, LinhaDR> | null, cc: CartaCorrecao | undefined, data: string): Item {
    const c = comCarta(nf, cc);
    const m = montarDeclaracaoLg(c.nf, drUsar, empresa, data);
    return { arquivoNf: cc ? `${arquivoNf} + carta de correção` : arquivoNf, nf: c.nf, ...m, avisos: c.aviso ? [c.aviso, ...m.avisos] : m.avisos, original: nf };
  }

  async function montar(arquivos: File[], drUsar: Map<string, LinhaDR> | null) {
    if (!arquivos.length) return;
    setCarregando(true);
    setErro(null);
    const hoje = hojeBR();
    const lidas: { f: File; nf: NotaFiscal }[] = [];
    const erros: Item[] = [];
    const novasCartas = new Map(cartas);
    for (const f of arquivos) {
      try {
        const form = new FormData();
        form.append("arquivo", f);
        const res = await fetch("/api/declaracoes/nf", { method: "POST", headers: cabecalhoSenha(senha), body: form });
        if (res.status === 401) return sair();
        const j = await res.json();
        if (res.ok && j.cc?.numeroNf) novasCartas.set(j.cc.numeroNf, j.cc);
        else if (res.ok && j.nf) lidas.push({ f, nf: j.nf });
        else erros.push({ arquivoNf: f.name, nf: null, erro: j.error ?? "Não reconheci a nota fiscal (DANFE) neste PDF.", dados: null, avisos: [], arquivo: "" });
      } catch {
        erros.push({ arquivoNf: f.name, nf: null, erro: "Falha de conexão.", dados: null, avisos: [], arquivo: "" });
      }
    }
    setCartas(novasCartas);
    const out = lidas.map(({ f, nf }) => montarItem(f.name, nf, drUsar, novasCartas.get(nf.numero ?? ""), hoje));
    // Soma às que já estão na lista; a mesma nota de novo troca a anterior. Carta que chegou depois
    // da nota: refaz a declaração daquela nota com os lotes corrigidos.
    const numeros = new Set(out.map((x) => x.nf?.numero).filter(Boolean));
    const ficam = itens
      .filter((x) => !(x.nf?.numero && numeros.has(x.nf.numero)) && !x.erro)
      .map((x) => {
        const cc = x.original?.numero ? novasCartas.get(x.original.numero) : undefined;
        return cc && cc !== cartas.get(x.original!.numero!) ? montarItem(x.arquivoNf, x.original!, drUsar, cc, x.dados?.data ?? hoje) : x;
      });
    // Carta sem a nota: avisa.
    const comNota = new Set([...ficam, ...out].map((x) => x.original?.numero).filter(Boolean));
    const soltas = [...novasCartas.values()]
      .filter((cc) => !comNota.has(cc.numeroNf ?? "") && !cartas.has(cc.numeroNf ?? ""))
      .map((cc) => ({ arquivoNf: `carta de correção da NF ${cc.numeroNf}`, nf: null, erro: `Solte também a NF ${cc.numeroNf}`, dados: null, avisos: [], arquivo: "" }));
    setItens([...ficam, ...out, ...erros, ...soltas]);
    setNfs((xs) => [...xs.filter((x) => !arquivos.some((n) => n.name === x.name)), ...arquivos]);
    setSel(ficam.length + Math.max(0, out.findIndex((x) => x.dados)));
    setCarregando(false);
  }

  const nomeDe = (it: Item) => it.arquivo || (it.dados ? nomeArquivo(it.dados) : "declaracao.docx");

  async function baixar(i: number) {
    const it = itens[i];
    if (!it?.dados || !modelo?.bytes) return;
    try {
      const r = await preencherModelo(modelo.bytes, it.dados, { removerVazios: !automatico });
      baixarBlob(r.bytes, nomeDe(it), DOCX);
      if (r.avisos.length) setToast(r.avisos.join(" "));
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível gerar o Word.");
    }
  }

  // PDF direto (LG): layout do Word dela desenhado pelo site, com o logo, a marca-d'água e a
  // assinatura tirados do Word modelo. Fontes e imagens carregadas uma vez.
  const cachePdf = useRef<{ bytes: Uint8Array; ativos: AtivosModelo; fontes: FontesPdf; cor: [number, number, number] } | null>(null);
  async function pdfDe(d: DadosDeclaracao): Promise<Uint8Array> {
    if (!modelo?.bytes) throw new Error("Sem o Word modelo da empresa.");
    if (cachePdf.current?.bytes !== modelo.bytes) {
      // Logo, marca-d'água, assinatura e timbre do Word modelo; o que faltar vem do cadastro.
      const ativos = completarTimbre(await ativosDoModelo(modelo.bytes), empresa, rtCompleto(empresa?.rt));
      cachePdf.current = { bytes: modelo.bytes, ativos, fontes: await baixarFontes(), cor: await corDoLogo(ativos.logo) };
    }
    const c = cachePdf.current;
    // LG: o layout novo na cor dela; as outras empresas: o mesmo layout, na cor do logo.
    if (automatico) return gerarPdfLgB(d, c.ativos, c.fontes);
    // Todas no layout da LG: tabela do tratamento (ciclo, início, término…), sem o parágrafo do tratamento.
    return gerarPdfPadrao(d, c.ativos, c.fontes, { cor: c.cor, geral: true, tabela: true });
  }

  async function baixarPdf(i: number) {
    const it = itens[i];
    if (!it?.dados) return;
    try {
      baixarBlob(await pdfDe(it.dados), nomeDe(it).replace(/\.docx$/, ".pdf"), PDF);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    }
  }

  async function baixarTodas(formato: "docx" | "pdf") {
    if (!modelo?.bytes) return;
    try {
      const zip = new JSZip();
      const usados = new Set<string>();
      for (const it of itens) {
        if (!it.dados) continue;
        const base = nomeDe(it).replace(/\.docx$/, `.${formato}`);
        let nome = base;
        for (let n = 2; usados.has(nome); n++) nome = base.replace(/\.(docx|pdf)$/, ` (${n}).$1`);
        usados.add(nome);
        zip.file(nome, formato === "pdf" ? await pdfDe(it.dados) : (await preencherModelo(modelo.bytes, it.dados, { removerVazios: !automatico })).bytes);
      }
      const nomeZip = `Declarações ${empresa?.apelido ?? ""} ${hojeBR().replace(/\//g, "-")}${formato === "pdf" ? " PDF" : ""}.zip`.replace(/\s+/g, " ");
      baixarBlob(await zip.generateAsync({ type: "uint8array" }), nomeZip, "application/zip");
      setToast("Arquivo .zip gerado: extraia na pasta Declarações do mês.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não foi possível gerar os arquivos.");
    }
  }

  // Prévia em PDF (LG): o próprio PDF que será baixado.
  const [previaPdf, setPreviaPdf] = useState<Uint8Array | null>(null);
  useEffect(() => {
    if (!atual?.dados || !modelo?.bytes) return;
    let vivo = true;
    const t = setTimeout(() => {
      void pdfDe(atual.dados!)
        .then((b) => vivo && setPreviaPdf(b))
        .catch(() => undefined);
    }, 400);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // pdfDe usa o modelo atual (dependência já listada)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automatico, atual?.dados, modelo?.bytes]);

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
              : mann
                ? "Automática: a nota fiscal do cliente (ou o BL) traz o ciclo, o certificado mestre traz o tratamento. Também dá para fazer à mão."
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
            accept=".pdf,.xlsx,.docx,.png,.jpg,.jpeg,.webp,image/*"
            ocupado={carregando}
            onArquivos={(fs) => void soltar(fs)}
          />
          <ColarPedido texto={false} ocupado={carregando} onArquivos={(fs) => void soltar(fs)} />
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

      {cnpj && !semModelo && mann && (
        <>
          <SoltarArquivos
            titulo={carregando ? "Lendo os documentos…" : "Arraste a nota fiscal (ou o BL / packing list) e o relatório do MAPA"}
            dica={
              <>
                Solte aqui a <b>nota fiscal</b> e/ou o <b>BL, booking ou packing list</b> (PDF) e o <b>relatório do MAPA</b> da empresa (.xlsx, o de
                RELATÓRIOS 2025; fica guardado para as próximas vezes), ou clique para escolher. A declaração só precisa do mês: o ciclo escrito na nota (ex.: “CICLO MANN 0249”) puxa o
                certificado, a data e a duração do relatório. Sem ciclo na nota, digite-o no campo “Ciclos”. O certificado mestre (PDF) também serve.
                Várias notas de uma vez: uma declaração por nota.
              </>
            }
            accept=".pdf,.xlsx,.docx,.png,.jpg,.jpeg,.webp,image/*"
            ocupado={carregando}
            onArquivos={(fs) => void soltarMann(fs)}
          />
          <ColarPedido ocupado={carregando} onArquivos={(fs) => void soltarMann(fs)} />
          <div className="actions" style={{ marginTop: 0 }}>
            <span className={`badge ${relatorio ? "pago" : "pendente"}`}>
              {relatorio
                ? `Relatório: ${relatorio.nome} · ${relatorio.linhas.length} tratamentos${relatorio.atualizado ? ` · guardado em ${new Date(relatorio.atualizado).toLocaleDateString("pt-BR")}` : ""}`
                : "Relatório do MAPA ainda não carregado"}
            </span>
            {mestresMann.length > 0 && (
              <span className="badge pago">
                Mestres: {mestresMann.map((m) => `${m.mestre.numero}${m.mestre.ciclo ? ` (ciclo ${parseInt(m.mestre.ciclo, 10) || m.mestre.ciclo})` : ""}`).join(", ")}
              </span>
            )}
            <div className="spacer" />
            <button type="button" className="btn" onClick={novaManual}>
              Fazer manualmente
            </button>
          </div>
        </>
      )}

      {cnpj && !semModelo && !automatico && !mann && modelo && Object.keys(modelo.regras).length > 0 && (
        <SoltarArquivos
          titulo={carregando ? "Lendo os documentos…" : "Arraste os documentos da remessa"}
          dica={
            <>
              Solte juntos os documentos de <b>uma remessa</b> (NF-e, BL, booking, invoice e o certificado mestre, em PDF): sai uma declaração
              preenchida com o que o site aprendeu no modelo.
            </>
          }
          accept=".pdf,.png,.jpg,.jpeg,.webp,image/*"
          ocupado={carregando}
          onArquivos={(fs) => void soltarRemessa(fs)}
        />
      )}
      {cnpj && !semModelo && !automatico && !mann && modelo && (
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
                    <td className="mono">{it.nf?.numero ?? (it.erro ? "—" : it.mann ? "BL" : "manual")}</td>
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
                            setSel(i);
                            setEditando(true);
                          }}
                        >
                          Editar
                        </button>
                      )}{" "}
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
                      {it.dados && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!modelo?.bytes}
                          onClick={(e) => {
                            e.stopPropagation();
                            void baixarPdf(i);
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
            <button type="button" className="btn" disabled={!prontos || !modelo?.bytes} onClick={() => void baixarTodas("docx")}>
              Todas em Word (.zip)
            </button>
            <button type="button" className="btn primary lg" disabled={!prontos || !modelo?.bytes} onClick={() => void baixarTodas("pdf")}>
              Todas em PDF (.zip)
            </button>
          </div>

          {atual?.dados && (
            <>
              <div className="section-title">
                <h2>{atual.nf ? `NF ${atual.nf.numero} · ${atual.nf.destinatario.razao}` : atual.mann ? `BL · ${atual.dados.exportador || atual.arquivoNf}` : "Declaração manual"}</h2>
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
              {atual.mann && (
                <div className="card" style={{ marginBottom: 14 }}>
                  <div className="field" style={{ maxWidth: 420 }}>
                    <label htmlFor="d-ciclos">Ciclos / lotes do tratamento (do relatório)</label>
                    <input
                      id="d-ciclos"
                      key={`${sel}-${(atual.mann.ciclos ?? atual.nf?.ciclos ?? []).join(",")}`}
                      defaultValue={ciclosDe(atual).join(", ")}
                      placeholder="ex.: 249, 256 · 972 e 973 · ciclo + cliente: 508 Rio Claro · quantidade x ciclo: 90 x 252, 200 x 226"
                      onBlur={(e) => trocarCiclos(sel, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && trocarCiclos(sel, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <div className="toolbar" style={{ marginTop: 8, flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {ciclosDe(atual).map((c, k) => (
                      <span key={`${c}-${k}`} className="btn btn-sm" style={{ cursor: "default" }}>
                        Ciclo {c}
                        <button
                          type="button"
                          aria-label={`Tirar o ciclo ${c}`}
                          title="Tirar este ciclo"
                          onClick={() => trocarCiclos(sel, ciclosDe(atual).filter((_, j) => j !== k).join(", "))}
                          style={{ marginLeft: 6, border: 0, background: "none", cursor: "pointer", font: "inherit" }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      ref={novoCiclo}
                      aria-label="Novo ciclo"
                      placeholder="nº do ciclo"
                      style={{ width: 130 }}
                      onKeyDown={(e) => e.key === "Enter" && adicionarCiclo(sel)}
                    />
                    <button type="button" className="btn btn-sm" onClick={() => adicionarCiclo(sel)}>
                      + Adicionar ciclo
                    </button>
                  </div>
                  {relatorio &&
                    (atual.mann.ciclos ?? atual.nf?.ciclos ?? atual.mann.bls.flatMap((b) => b.ciclos)).map((cd) => {
                      const c = quantidadeDigitada(cd)?.ciclo ?? cd;
                      // O mesmo nº de ciclo em mais de uma unidade (os veículos da Mann): escolhe qual.
                      const cands = linhasDoCiclo(relatorio.linhas, c);
                      if (cands.length < 2) return null;
                      const atualCert = atual.mann?.escolhas?.[c] ?? atual.dados?.linhas.find((l) => cands.some((k) => k.certificado === l.certificado))?.certificado ?? "";
                      return (
                        <div className="field" key={c} style={{ maxWidth: 640, marginTop: 8 }}>
                          <label htmlFor={`d-esc-${c}`}>Ciclo {c}: {cands.length} tratamentos com esse nº — qual é?</label>
                          <select
                            id={`d-esc-${c}`}
                            value={atualCert}
                            onChange={(e) =>
                              setItens((xs) =>
                                xs.map((x, j) => (j === sel ? remontar(x, mestresMann, relatorio.linhas, undefined, { ...(x.mann?.escolhas ?? {}), [c]: e.target.value }) : x))
                              )
                            }
                          >
                            {cands.map((k) => (
                              <option key={k.certificado} value={k.certificado}>
                                {k.certificado} · {k.data} {k.hora} · {k.tomador || "—"}
                                {k.unidade ? ` · ${k.unidade}` : ""}
                                {k.local ? ` · ${k.local}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  <p className="hint" style={{ margin: "4px 0 0" }}>
                    {relatorio
                      ? "Digite os ciclos (ou lotes) e tecle Enter: o certificado, o mês e a duração vêm do relatório. Ciclo repetido entre os veículos: digite ciclo + cliente (ex.: 508 Rio Claro) ou escolha na lista. Vários ciclos com quantidades diferentes: quantidade x ciclo (ex.: 90 x 252, 200 x 226, 100 x 227)."
                      : "Solte o relatório do MAPA da empresa na área acima para puxar o tratamento pelos ciclos."}
                  </p>
                </div>
              )}
              {editorAberto && (
                <Editor
                  d={atual.dados}
                  onChange={(d) => {
                    // Editando: fica aberto mesmo depois de preencher a quantidade.
                    setEditando(true);
                    setItens((xs) => xs.map((x, j) => (j === sel ? { ...x, dados: d } : x)));
                  }}
                />
              )}
              <div className="toolbar">
                <button type="button" className="btn" disabled={faltaCampo} onClick={() => setEditando((v) => !v)}>
                  {editorAberto ? (faltaCampo ? "Preencha a quantidade (em vermelho)" : "Fechar edição") : "Editar campos da declaração"}
                </button>
                <div className="spacer" />
                <button type="button" className="btn" disabled={!modelo?.bytes} onClick={() => void baixar(sel)}>
                  Baixar Word
                </button>
                <button type="button" className="btn primary" disabled={!modelo?.bytes} onClick={() => void baixarPdf(sel)}>
                  Baixar PDF
                </button>
              </div>
              <div className="section-title">
                <h2>Prévia</h2>
                <p>
                  {automatico
                    ? "O PDF que será baixado."
                    : "O PDF que será baixado: modelo padrão (mês do tratamento, sem a tabela), na cor do logo da empresa. O Word continua no modelo dela."}
                </p>
              </div>
              {modelo?.bytes ? (
                previaPdf ? (
                  <PreviaPdf bytes={previaPdf} />
                ) : (
                  <p className="hint">Gerando a prévia…</p>
                )
              ) : (
                <PreviaWord bytes={modelo?.bytes ? previa : null} />
              )}
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
