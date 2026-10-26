"use client";

import { useEffect, useRef, useState } from "react";
import { aprender, regraLegivel, tipoDaFonte, type Fonte, type Regras } from "@/lib/aprenderRemessa";
import { analisarModelo, valoresAtuaisDoModelo, VARIAVEIS } from "@/lib/preencherModelo";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { PreviaWord } from "./PreviaWord";
import { SoltarArquivos } from "./SoltarArquivos";

export interface ModeloSalvo {
  salvo: boolean;
  nomeModelo: string | null;
  atualizado: string | null;
  bytes: Uint8Array | null;
  regras: Regras;
  documentos: string[];
}

const NOMES_CAMPO: Record<string, string> = {
  exportador: "Exportador", importador: "Importador", master: "Certificado mestre", ciclo: "Ciclo", lote: "Lote", navio: "Navio",
  fatura: "Fatura/Invoice", nfe: "NF-e", booking: "Booking", bl: "B/L", container: "Container", marcas: "Marcas",
  volumes: "Quantidade/Volume", pesoLiquido: "Peso líquido", pesoBruto: "Peso bruto", programacao: "Programação",
  dataTratamento: "Data do tratamento", observacao: "Observação",
};

const TIPOS: Record<string, string> = { nfe: "NF-e", bl: "BL", booking: "Booking", invoice: "Invoice", packing: "Packing list", outro: "Outro" };

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Lê um documento da remessa no servidor (texto + nota fiscal, se for). */
export async function lerFonte(f: File, senha: string): Promise<Fonte & { mestre?: unknown; erro?: string }> {
  const form = new FormData();
  form.append("arquivo", f);
  const r = await fetch("/api/declaracoes/nf", { method: "POST", headers: cabecalhoSenha(senha), body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { nome: f.name, tipo: "outro", texto: "", erro: j.error ?? "Não foi possível ler." };
  return { nome: f.name, tipo: tipoDaFonte(j.texto ?? "", j.nf), texto: j.texto ?? "", nf: j.nf, mestre: j.mestre };
}

/**
 * Modelo da declaração da empresa: o Word que ela já usa. O site guarda o arquivo e, em cada
 * declaração, troca só os dados; mudou o layout, é só carregar o Word novo aqui. Com os documentos
 * da remessa desse Word (NF-e, BL, booking…), o site aprende de onde vem cada dado.
 */
export function ModeloDeclaracao({
  senha,
  cnpj,
  nome,
  atual,
  arquivoInicial,
  onSalvo,
  onFechar,
}: {
  senha: string;
  cnpj: string;
  nome: string;
  atual: ModeloSalvo | null;
  /** Word solto na área principal da aba: já entra aqui. */
  arquivoInicial?: File | null;
  onSalvo: () => void;
  onFechar: () => void;
}) {
  const [arquivo, setArquivo] = useState<{ nome: string; bytes: Uint8Array } | null>(null);
  const [analise, setAnalise] = useState<{ campos: string[]; tabela: boolean } | null>(null);
  const [regras, setRegras] = useState<Regras>(atual?.regras ?? {});
  const [documentos, setDocumentos] = useState<{ nome: string; tipo: string; erro?: string }[]>((atual?.documentos ?? []).map((n) => ({ nome: n, tipo: "" })));
  const [regrasMudaram, setRegrasMudaram] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function escolher(f: File | null) {
    setMsg(null);
    setAnalise(null);
    if (!f) return;
    if (!/\.docx$/i.test(f.name)) return setMsg("Envie o Word (.docx). Arquivo .doc antigo: abra no Word e salve como .docx.");
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      setAnalise(await analisarModelo(bytes));
      setArquivo({ nome: f.name, bytes });
      // Word novo: as regras do Word antigo não valem mais.
      setRegras({});
      setDocumentos([]);
      setRegrasMudaram(true);
    } catch {
      setMsg("Não consegui abrir este Word.");
    }
  }

  // Word que veio solto na área principal: lê uma vez ao abrir.
  const lido = useRef<File | null>(null);
  useEffect(() => {
    if (arquivoInicial && lido.current !== arquivoInicial) {
      lido.current = arquivoInicial;
      void escolher(arquivoInicial);
    }
  });

  async function aprenderCom(files: File[]) {
    const bytes = arquivo?.bytes ?? atual?.bytes;
    if (!bytes) return setMsg("Carregue antes o Word do modelo.");
    setLendo(true);
    setMsg(null);
    try {
      const fontes = await Promise.all(files.map((f) => lerFonte(f, senha)));
      const boas = fontes.filter((f) => !f.erro);
      const aprendidas = aprender(await valoresAtuaisDoModelo(bytes), boas, VARIAVEIS);
      setRegras(aprendidas);
      setDocumentos(fontes.map((f) => ({ nome: f.nome, tipo: TIPOS[f.tipo] ?? f.tipo, erro: f.erro })));
      setRegrasMudaram(true);
      const n = Object.keys(aprendidas).length;
      setMsg(
        n
          ? `Aprendi ${n} campo(s). Confira abaixo de onde vem cada dado e salve.`
          : "Não achei nos documentos nenhum dado que esteja no Word. Confira se são os documentos da mesma remessa do Word modelo."
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível ler os documentos.");
    } finally {
      setLendo(false);
    }
  }

  async function salvar() {
    if (!arquivo && !regrasMudaram) return;
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/declaracoes/modelo", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({
          cnpj,
          ...(arquivo ? { nome: arquivo.nome, modelo: base64(arquivo.bytes) } : {}),
          regras,
          documentos: documentos.filter((d) => !d.erro).map((d) => d.nome),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Não foi possível salvar.");
      onSalvo();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const temWord = !!(arquivo?.bytes ?? atual?.bytes);
  const listaRegras = Object.entries(regras) as [string, string][];

  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--accent)" }}>
      <div className="kpi-label">Modelo da declaração · {nome}</div>
      <p className="hint" style={{ marginTop: 4 }}>
        <b>1.</b> Carregue o <b>Word</b> de uma declaração que vocês já fazem para esta empresa. As declarações vão sair desse Word, iguais a
        ele: o site só troca os dados. Mudou o layout? Carregue o Word novo aqui.
        {atual?.salvo && ` Modelo atual: “${atual.nomeModelo ?? "modelo.docx"}”${atual.atualizado ? ` (${new Date(atual.atualizado).toLocaleDateString("pt-BR")})` : ""}.`}
      </p>
      <div style={{ marginTop: 8 }}>
        <SoltarArquivos
          titulo={arquivo ? "Trocar o Word" : "Arraste o Word do modelo"}
          dica={arquivo ? arquivo.nome : "Solte aqui o .docx da declaração (ou clique para escolher)."}
          accept=".docx"
          multiplos={false}
          onArquivos={(fs) => void escolher(fs[0] ?? null)}
        />
      </div>

      {analise && (
        <div className={`alert-box${analise.campos.length ? "" : " critical"}`} style={{ marginTop: 10 }}>
          <h4>{analise.campos.length ? "O que o site vai preencher neste Word" : "Não reconheci os campos"}</h4>
          <ul>
            <li>{analise.campos.length ? analise.campos.join(" · ") : "Nenhum rótulo conhecido (ex.: “EXPORTADOR/SHIPPER:”)."}</li>
            <li>{analise.tabela ? "Tabela do tratamento: as linhas viram uma por ciclo." : "Sem tabela do tratamento (início/término)."}</li>
            <li>O resto do Word (timbre, textos, assinatura, logo) fica igual.</li>
          </ul>
        </div>
      )}

      {temWord && (
        <>
          <p className="hint" style={{ marginTop: 12 }}>
            <b>2.</b> Para o site aprender a preencher sozinho: arraste os documentos <b>da mesma remessa deste Word</b> (NF-e, BL, booking,
            invoice… em PDF ou imagem). Ele procura cada dado do Word nesses documentos e guarda de onde veio.
          </p>
          <SoltarArquivos
            titulo={lendo ? "Lendo os documentos…" : "Arraste os documentos da remessa do modelo"}
            dica="NF-e, BL, booking, invoice, packing list: PDF ou imagem (foto/print, lida por OCR — confira). Pode soltar todos juntos."
            accept=".pdf,.png,.jpg,.jpeg,.webp,image/*"
            ocupado={lendo}
            onArquivos={(fs) => void aprenderCom(fs)}
          />
        </>
      )}
      {msg && <p className="hint">{msg}</p>}

      {documentos.length > 0 && (
        <p className="hint">
          Documentos: {documentos.map((d) => `${d.nome}${d.tipo ? ` (${d.tipo})` : ""}${d.erro ? ` — ${d.erro}` : ""}`).join(" · ")}
        </p>
      )}
      {listaRegras.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="dados">
            <thead>
              <tr>
                <th>Campo</th>
                <th>De onde vem (aprendido)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listaRegras.map(([campo, r]) => (
                <tr key={campo}>
                  <td>{NOMES_CAMPO[campo] ?? campo}</td>
                  <td style={{ whiteSpace: "pre-wrap" }}>{regraLegivel(r)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm danger"
                      onClick={() => {
                        setRegras((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== campo)));
                        setRegrasMudaram(true);
                      }}
                    >
                      Tirar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {arquivo && <PreviaWord bytes={arquivo.bytes} />}

      <div className="toolbar" style={{ marginTop: 10 }}>
        <div className="spacer" />
        <button type="button" className="btn" onClick={onFechar}>
          Fechar
        </button>
        <button type="button" className="btn primary" disabled={(!arquivo && !regrasMudaram) || salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar modelo"}
        </button>
      </div>
    </div>
  );
}
