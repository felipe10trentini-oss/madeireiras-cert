"use client";

// Retificação de um comunicado já emitido: o operador solta o PDF (ou o Excel) do comunicado, escolhe
// alteração ou cancelamento, muda nº/produto/quantidade/horário e escreve o motivo. O site gera o
// comunicado retificado no modelo da empresa (idêntico ao Excel), com o sufixo no nº e a observação na
// última linha, e salva na pasta da empresa.
import { useState } from "react";
import { comObservacao, lerModeloComunicado, preencherComunicado, ROTULOS_COMUNICADO, type CampoComunicado, type ModeloComunicado } from "@/lib/comunicadoModelo";
import {
  CAMPOS_RETIFICAVEIS,
  CAMPOS_RETIFICAVEIS_MANN,
  lerComunicadoDoTexto,
  motivoPadrao,
  nomeComunicado,
  partirNumero,
  sufixoMann,
  sufixoRetificacao,
  sufixosNosNomes,
  type TipoRetificacao,
} from "@/lib/comunicadoRetificacao";
import { baixarFontes } from "@/lib/declaracaoLgPdf";
import { excelParaPdf } from "@/lib/excelPdf";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { salvarNaPasta, type UltimoDaPasta } from "@/lib/pastaComunicados";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { SoltarArquivos } from "./SoltarArquivos";

type Valores = Partial<Record<CampoComunicado, string>>;

interface Props {
  senha: string;
  sair: () => void;
  empresa: MadeireiraSalva;
  modelo: ModeloComunicado;
  /** Excel modelo da empresa (layout do comunicado). */
  bytesModelo: Uint8Array;
  nomeModelo: string | null;
  /** Mann Móvel: nº = aviso, sufixos da tabela da aba AVISO. */
  mann: boolean;
  /** Pasta da empresa ligada (onde salvar), ou null para baixar. */
  pasta: UltimoDaPasta | null;
  onToast: (msg: string) => void;
}

const ROTULO = Object.fromEntries(ROTULOS_COMUNICADO.map(([c, , r]) => [c, r])) as Record<CampoComunicado, string>;

function baixar(bytes: Uint8Array, nome: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function RetificarComunicado({ senha, sair, empresa, modelo, bytesModelo, nomeModelo, mann, pasta, onToast }: Props) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [orig, setOrig] = useState<Valores | null>(null);
  const [novos, setNovos] = useState<Valores>({});
  const [tipo, setTipo] = useState<TipoRetificacao>("alteracao");
  const [obs, setObs] = useState<string | null>(null);
  const [numeroManual, setNumeroManual] = useState<string | null>(null);

  const editaveis = mann ? CAMPOS_RETIFICAVEIS_MANN : CAMPOS_RETIFICAVEIS;
  const campos = editaveis.filter((c) => modelo.campos[c]);
  const mudou = tipo === "alteracao" && orig ? campos.filter((c) => (novos[c] ?? orig[c] ?? "").trim() !== (orig[c] ?? "").trim()) : [];
  const { base, sufixo: sufixoAtual } = partirNumero(orig?.numero ?? "");
  const existentes = [...(sufixoAtual ? [sufixoAtual] : []), ...(pasta ? sufixosNosNomes(pasta.nomes, base) : [])];
  const sufixo = orig ? sufixoRetificacao(tipo, existentes, { mann, mudou }) : "";
  const numero = numeroManual ?? (orig ? `${base}-${sufixo}` : "");
  const motivo = obs ?? motivoPadrao(tipo, mudou, mann);
  // Campos que não estavam no arquivo: ficam como no modelo (último comunicado) — o operador confere.
  const faltando = orig ? (Object.keys(modelo.campos) as CampoComunicado[]).filter((c) => c !== "observacao" && !orig[c]?.trim()) : [];

  function limpar() {
    setArquivo(null);
    setOrig(null);
    setNovos({});
    setTipo("alteracao");
    setObs(null);
    setNumeroManual(null);
  }

  async function ler(files: File[]) {
    const f = files.find((x) => /\.(pdf|xlsx)$/i.test(x.name));
    if (!f) return onToast("Solte o PDF (ou o Excel) do comunicado a retificar.");
    setOcupado(true);
    try {
      let v: Valores;
      if (/\.xlsx$/i.test(f.name)) {
        const m = await lerModeloComunicado(new Uint8Array(await f.arrayBuffer()));
        v = Object.fromEntries(Object.values(m.campos).map((c) => [c!.campo, c!.valor]));
      } else {
        const form = new FormData();
        form.append("arquivo", f);
        const res = await fetch("/api/comunicados/ler", { method: "POST", headers: cabecalhoSenha(senha), body: form });
        if (res.status === 401) return sair();
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return onToast(j.error ?? `Não consegui ler ${f.name}.`);
        v = lerComunicadoDoTexto(j.texto ?? "");
      }
      if (!v.numero?.trim()) return onToast("Não achei o “Comunicado de tratamento nº” neste arquivo.");
      limpar();
      setArquivo(f.name);
      setOrig(v);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
    } finally {
      setOcupado(false);
    }
  }

  async function salvar() {
    if (!orig) return;
    if (tipo === "alteracao" && !mudou.length) return onToast("Nada mudou: altere o produto, a quantidade ou o horário (ou escolha cancelamento).");
    if (!motivo.trim()) return onToast("Escreva o motivo na observação.");
    if (mann && tipo === "alteracao" && !sufixoMann(mudou)) onToast("Essa combinação não está na tabela de sufixos da Mann: confira o nº.");
    setOcupado(true);
    try {
      const doModelo = Object.fromEntries(Object.values(modelo.campos).map((c) => [c!.campo, c!.valor])) as Valores;
      const valores: Valores = {};
      for (const c of Object.keys(modelo.campos) as CampoComunicado[]) valores[c] = orig[c]?.trim() ? orig[c] : (doModelo[c] ?? "");
      if (tipo === "alteracao") for (const c of campos) if (novos[c] != null) valores[c] = novos[c];
      valores.numero = numero.trim();
      delete valores.observacao;
      let xlsx = await preencherComunicado(bytesModelo, modelo, valores);
      xlsx = await comObservacao(xlsx, modelo, motivo.trim());
      const celulas = Object.values(modelo.campos).map((c) => c!.celula);
      const pdf = await excelParaPdf(xlsx, await baixarFontes(), { aba: modelo.aba, ajustar: celulas });
      const nome = nomeComunicado(nomeModelo, valores.numero, empresa.apelido).replace(/\.xlsx$/i, ".pdf");
      let onde = "";
      if (pasta) {
        try {
          onde = (await salvarNaPasta(pasta.destino, nome, pdf)) === "salvo" ? `salvo em “${pasta.caminhoDestino}”` : "";
          if (!onde) {
            baixar(pdf, nome);
            onde = "já existia um arquivo com esse nome na pasta (não sobrescrevi): baixei";
          } else pasta.nomes.push(nome);
        } catch {
          baixar(pdf, nome);
          onde = "não consegui gravar na pasta: baixei";
        }
      } else {
        baixar(pdf, nome);
        onde = "baixado (ligue a pasta da empresa para salvar direto lá)";
      }
      onToast(`Comunicado ${valores.numero} retificado — ${onde}.`);
      limpar();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Não foi possível gerar a retificação.");
    } finally {
      setOcupado(false);
    }
  }

  if (!aberto) {
    return (
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <button type="button" className="btn" onClick={() => setAberto(true)}>
          Retificar um comunicado
        </button>
        <span className="hint">Alteração (-A{mann ? "H, -AM…" : ", -A2…"}) ou cancelamento (-{mann ? "AC" : "C"}) de um comunicado já emitido.</span>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <div className="kpi-label" style={{ margin: 0 }}>
          Retificação de comunicado
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            limpar();
            setAberto(false);
          }}
        >
          Fechar
        </button>
      </div>

      {!orig ? (
        <SoltarArquivos
          titulo={ocupado ? "Lendo o comunicado…" : "Arraste o comunicado que será retificado"}
          dica={
            <>
              O <b>PDF</b> do comunicado emitido (ou o <b>Excel</b> dele). O site lê os campos, você muda o que precisa e ele gera o retificado no
              modelo de {empresa.apelido}, com o sufixo no nº e a observação na última linha.
            </>
          }
          accept=".pdf,.xlsx"
          ocupado={ocupado}
          onArquivos={(fs) => void ler(fs)}
        />
      ) : (
        <>
          <p className="hint" style={{ marginTop: 0 }}>
            Arquivo: <b>{arquivo}</b> · nº {orig.numero} · {orig.data} {orig.horario}
            {orig.tomador ? ` · ${orig.tomador}` : ""}{" "}
            <button type="button" className="link" onClick={limpar}>
              trocar
            </button>
          </p>
          {faltando.length > 0 && (
            <div className="alert-box">
              <h4>Confira</h4>
              <ul>
                <li>Não achei no arquivo: {faltando.map((c) => ROTULO[c]).join(", ")}. Ficaram como no último comunicado da empresa.</li>
              </ul>
            </div>
          )}
          <div className="actions" style={{ marginBottom: 10 }}>
            <label>
              <input type="radio" name="ret-tipo" checked={tipo === "alteracao"} onChange={() => { setTipo("alteracao"); setObs(null); setNumeroManual(null); }} /> Alteração
            </label>
            <label style={{ marginLeft: 14 }}>
              <input type="radio" name="ret-tipo" checked={tipo === "cancelamento"} onChange={() => { setTipo("cancelamento"); setObs(null); setNumeroManual(null); }} /> Cancelamento
            </label>
          </div>
          <div className="form-grid tres">
            <div className="field">
              <label htmlFor="ret-numero">{ROTULO.numero}</label>
              <input id="ret-numero" value={numero} onChange={(e) => setNumeroManual(e.target.value)} />
            </div>
            {tipo === "alteracao" &&
              campos.map((c) => (
                <div className={`field${c === "quantidade" || c === "produto" ? " full" : ""}`} key={c}>
                  <label htmlFor={`ret-${c}`}>
                    {ROTULO[c]}
                    {mudou.includes(c) ? <span className="badge pago" style={{ marginLeft: 6 }}>alterado</span> : null}
                  </label>
                  {c === "quantidade" ? (
                    <textarea
                      id={`ret-${c}`}
                      rows={Math.max(1, (novos[c] ?? orig[c] ?? "").split("\n").length)}
                      value={novos[c] ?? orig[c] ?? ""}
                      onChange={(e) => setNovos((v) => ({ ...v, [c]: e.target.value }))}
                      style={{ width: "100%", resize: "vertical" }}
                    />
                  ) : (
                    <input id={`ret-${c}`} value={novos[c] ?? orig[c] ?? ""} onChange={(e) => setNovos((v) => ({ ...v, [c]: e.target.value }))} />
                  )}
                </div>
              ))}
            <div className="field full">
              <label htmlFor="ret-obs">Observação (motivo, vai na última linha como “Obs: …”)</label>
              <input id="ret-obs" value={motivo} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: Alteração de horário" />
            </div>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn primary" disabled={ocupado} onClick={() => void salvar()}>
              {ocupado ? "Gerando…" : "Salvar retificação"}
            </button>
            <span className="hint">
              {pasta ? `Salva em “${pasta.caminhoDestino}” como ${nomeComunicado(nomeModelo, numero || "0/0", empresa.apelido).replace(/\.xlsx$/i, ".pdf")}.` : "Sem a pasta ligada, o PDF é baixado."} O
              número do próximo comunicado não muda.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
