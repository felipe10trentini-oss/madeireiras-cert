"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { montarCertificado, sugerirTipo, type TipoTratamento } from "@/lib/certificado";
import type { Comunicado } from "@/lib/comunicado";
import { curvaVazia, type Curva } from "@/lib/curvas/tipos";
import { identificarEmpresa, lerNomeArquivo } from "@/lib/madeireiras";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { camposDoModelo, montarHtml, type Campo } from "@/lib/modelos";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos } from "@/lib/util";
import { FileDrop } from "./FileDrop";
import { LinhaRelatorioCard } from "./LinhaRelatorioCard";
import { Steps } from "./Steps";

interface Extraido {
  nomeArquivo: string;
  semTexto: boolean;
  curva: Curva | null;
  comunicado: Comunicado | null;
  dataComunicado: string | null;
}

const TIPOS: { id: TipoTratamento; nome: string }[] = [
  { id: "KD", nome: "Secagem em estufa · KD" },
  { id: "HT", nome: "Secagem em estufa · HT" },
  { id: "AQF", nome: "Ar quente forçado · AQF - HT" },
];

const LONGOS: Campo[] = ["endereco", "enderecoTrat", "tomEndereco", "produto", "razao"];

export function Emissao({ senha, sair }: { senha: string; sair: () => void }) {
  const [empresas, setEmpresas] = useState<MadeireiraSalva[] | null>(null);
  const [erroCadastro, setErroCadastro] = useState<string | null>(null);
  const [curvaArq, setCurvaArq] = useState<File | null>(null);
  const [comunicadoArq, setComunicadoArq] = useState<File | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [extraido, setExtraido] = useState<Extraido | null>(null);
  const [cnpjEscolhido, setCnpjEscolhido] = useState<string>("");
  const [tipo, setTipo] = useState<TipoTratamento>("KD");
  const [ajustes, setAjustes] = useState<Partial<Record<Campo | "numero", string>>>({});
  const [editando, setEditando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement>(null);

  // `sair` muda a cada render do portão de senha: guardado em ref para não refazer a busca.
  const sairRef = useRef(sair);
  useEffect(() => {
    sairRef.current = sair;
  }, [sair]);

  useEffect(() => {
    fetch("/api/madeireiras", { headers: cabecalhoSenha(senha), cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) return sairRef.current();
        const data = await res.json();
        if (!res.ok) setErroCadastro(data.error ?? "Falha ao ler o cadastro.");
        else setEmpresas(data.empresas);
      })
      .catch(() => setErroCadastro("Não foi possível conectar ao servidor."));
  }, [senha]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const empresa = empresas?.find((e) => soDigitos(e.cnpj) === soDigitos(cnpjEscolhido)) ?? null;
  const curva: Curva | null = extraido ? (extraido.curva ?? curvaVazia("CRG08 KDHT")) : null;
  const entrada =
    extraido && curva && empresa
      ? { curva, empresa, comunicado: extraido.comunicado, nomeArquivo: extraido.nomeArquivo }
      : null;
  const sugestao = entrada ? sugerirTipo(entrada) : null;

  const montado = entrada ? montarCertificado(entrada, tipo) : null;
  const valores = montado ? { ...montado.valores, ...ajustes } : null;
  const html = montado && valores ? montarHtml(montado.modelo, valores) : "";

  async function extrair(e: FormEvent) {
    e.preventDefault();
    if (!curvaArq) return setErro("Envie o PDF da curva de tratamento.");
    setCarregando(true);
    setErro(null);
    const form = new FormData();
    form.append("curva", curvaArq);
    if (comunicadoArq) form.append("comunicado", comunicadoArq);
    try {
      const res = await fetch("/api/extrair", { method: "POST", headers: cabecalhoSenha(senha), body: form });
      const data = await res.json();
      if (res.status === 401) return sair();
      if (!res.ok) return setErro(data.error ?? "Erro ao processar os arquivos.");
      const ex = data as Extraido;
      const c = ex.curva;
      const ident = identificarEmpresa(empresas ?? [], {
        cnpj: c?.cnpj,
        regMapa: c?.regMapa,
        nomeArquivo: lerNomeArquivo(ex.nomeArquivo).nome,
      });
      setExtraido(ex);
      setCnpjEscolhido(ident?.empresa.cnpj ?? "");
      if (ident && (c || ex.semTexto)) {
        setTipo(sugerirTipo({ curva: c ?? curvaVazia("CRG08 KDHT"), empresa: ident.empresa, comunicado: ex.comunicado, nomeArquivo: ex.nomeArquivo }).tipo);
      }
      setAjustes({});
      setCopiado(false);
    } catch {
      setErro("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  function trocarEmpresa(cnpj: string) {
    setCnpjEscolhido(cnpj);
    setAjustes({});
    const nova = empresas?.find((x) => x.cnpj === cnpj);
    if (nova && extraido) {
      setTipo(sugerirTipo({ curva: curva!, empresa: nova, comunicado: extraido.comunicado, nomeArquivo: extraido.nomeArquivo }).tipo);
    }
  }

  function novo() {
    setExtraido(null);
    setCurvaArq(null);
    setComunicadoArq(null);
    setAjustes({});
    setCopiado(false);
    setErro(null);
    setEditando(false);
  }

  async function copiar() {
    const texto = docRef.current?.innerText ?? "";
    try {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([texto], { type: "text/plain" }),
          }),
        ]);
      } catch {
        await navigator.clipboard.writeText(texto);
      }
      setCopiado(true);
      setToast("Copiado! No editor do SEI: Ctrl+A e Ctrl+V.");
    } catch {
      setToast("Não foi possível copiar. Permita o acesso à área de transferência e tente de novo.");
    }
  }

  if (erroCadastro) {
    return (
      <div className="alert-box critical" role="alert">
        <h4>Cadastro de madeireiras indisponível</h4>
        <ul>
          <li>{erroCadastro}</li>
          <li>Confira se a tabela foi criada no Supabase e envie a planilha na aba Madeireiras.</li>
        </ul>
      </div>
    );
  }

  return (
    <div>
      <Steps atual={!extraido ? 1 : copiado ? 3 : 2} />

      {!extraido ? (
        <form className="view" onSubmit={extrair}>
          <p className="lead">
            Envie a <b>curva de tratamento</b> da madeireira (SV580, SV520, CRG08 ou DMC2051). O site identifica a
            empresa, escolhe o modelo do SEI (cadastrada/credenciada, AQF/estufa) e preenche o certificado. Se a
            empresa trabalha com <b>comunicado</b>, envie também o PDF do comunicado.
          </p>
          {empresas && empresas.length === 0 && (
            <div className="alert-box">
              <h4>Nenhuma madeireira cadastrada</h4>
              <ul>
                <li>Envie a planilha Madeireiras.xlsx na aba Madeireiras antes de emitir.</li>
              </ul>
            </div>
          )}
          <div className="drops">
            <FileDrop
              titulo="Curva de tratamento"
              dica="Arraste o PDF aqui (ex.: 341 ABB 1-350.pdf)"
              arquivo={curvaArq}
              onArquivo={setCurvaArq}
            />
            <FileDrop
              titulo="Comunicado (se a empresa usar)"
              dica="Empresas com programação mensal não enviam nada aqui: o nº sai do mês do tratamento (ex.: 09/2026)"
              arquivo={comunicadoArq}
              onArquivo={setComunicadoArq}
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
            <button type="submit" className="btn primary lg" disabled={carregando || !empresas}>
              {carregando ? "Lendo os PDFs…" : "Extrair dados"}
            </button>
            <span className="hint">
              O nº do certificado e o lote vêm do nome do arquivo da curva (“341 ABB 1-350” → 341/2026, lote 1-350).
            </span>
          </div>
        </form>
      ) : (
        <div className="view">
          {(extraido.semTexto || !empresa || (montado && montado.avisos.length > 0)) && (
            <div className="alert-box">
              <h4>Confira antes de copiar</h4>
              <ul>
                {extraido.semTexto && (
                  <li>
                    Este PDF é uma imagem (sem texto): preencha início, término, ciclo e temperatura em “Editar
                    campos”.
                  </li>
                )}
                {!empresa && <li>Não identifiquei a empresa: escolha na lista abaixo.</li>}
                {montado?.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <div className="grid kpis">
            <div className="card">
              <div className="kpi-label">Empresa</div>
              <select value={cnpjEscolhido} onChange={(e) => trocarEmpresa(e.target.value)} aria-label="Empresa">
                <option value="">— escolha —</option>
                {empresas?.map((e) => (
                  <option key={e.cnpj} value={e.cnpj}>
                    {e.apelido} · {e.regMapa}
                  </option>
                ))}
              </select>
              <div className="kpi-sub">
                {empresa ? (
                  <>
                    <span className={`badge ${empresa.modalidade === "Credenciada" ? "pago" : "pendente"}`}>
                      {empresa.modalidade}
                    </span>{" "}
                    {empresa.tratamentos.join(" / ")} ·{" "}
                    {empresa.documento === "comunicado" ? "comunicado" : empresa.documento === "programacao" ? "programação" : "documento não informado"}
                  </>
                ) : (
                  " "
                )}
              </div>
            </div>
            <div className="card">
              <div className="kpi-label">Tratamento / modelo</div>
              <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoTratamento); setAjustes({}); }} aria-label="Tipo de tratamento">
                {TIPOS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
              <div className="kpi-sub">
                {montado?.modelo.nome}
                {sugestao && sugestao.tipo !== tipo ? ` · sugerido ${sugestao.tipo}` : sugestao ? ` · ${sugestao.motivo}` : ""}
              </div>
            </div>
            <div className="card">
              <div className="kpi-label">Curva</div>
              <div className="kpi-value text">{curva?.sistema ?? "—"}</div>
              <div className="kpi-sub mono">
                ciclo {valores?.ciclo || "?"} · lote {valores?.lote || "?"}
                {curva?.umidadeFinal != null ? ` · UM final ${curva.umidadeFinal}%` : ""}
              </div>
            </div>
            <div className="card">
              <div className="kpi-label">Tratamento</div>
              <div className="kpi-value text">{valores?.dataInicio || "—"}</div>
              <div className="kpi-sub mono">
                {valores?.horaInicio || "?"} → {valores?.dataFim !== valores?.dataInicio ? `${valores?.dataFim ?? ""} ` : ""}
                {valores?.horaFim || "?"}
              </div>
            </div>
          </div>

          <div className="toolbar">
            <div className="field">
              <label htmlFor="num-cert">Nº do certificado</label>
              <input
                id="num-cert"
                type="text"
                value={valores?.numero ?? ""}
                onChange={(e) => setAjustes((a) => ({ ...a, numero: e.target.value }))}
                placeholder="ex: 341/2026"
              />
            </div>
            <div className="spacer" />
            <button type="button" className="btn" onClick={() => setEditando((v) => !v)} disabled={!montado}>
              {editando ? "Fechar edição" : "Editar campos"}
            </button>
            <button type="button" className="btn" onClick={novo}>
              Novo certificado
            </button>
            <button type="button" className="btn primary lg" onClick={copiar} disabled={!montado}>
              Copiar certificado
            </button>
          </div>

          {editando && montado && valores && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="form-grid">
                {camposDoModelo(montado.modelo).map((cel) => (
                  <div key={cel.k} className={`field${LONGOS.includes(cel.k) ? " full" : ""}`}>
                    <label htmlFor={`f-${cel.k}`}>
                      {cel.r}
                      {cel.fixo ? ` ${cel.fixo} …` : ""}
                    </label>
                    <input
                      id={`f-${cel.k}`}
                      type="text"
                      value={valores[cel.k] ?? ""}
                      onChange={(e) => setAjustes((a) => ({ ...a, [cel.k]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {montado ? (
            <>
              <div className="section-title">
                <h2>Prévia do certificado</h2>
                <p>
                  Modelo “{montado.modelo.nome}” — é exatamente o que será colado no SEI.
                </p>
              </div>
              <div className="paper-wrap">
                <div ref={docRef} className="sei-doc" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
              <div className="toolbar" style={{ marginTop: 18, justifyContent: "flex-end" }}>
                <button type="button" className="btn primary lg" onClick={copiar}>
                  Copiar certificado
                </button>
              </div>

              {empresa && valores && (
                <LinhaRelatorioCard
                  key={`${empresa.cnpj}-${tipo}`}
                  senha={senha}
                  empresa={empresa}
                  valores={valores}
                  tipo={tipo}
                  camara={curva?.camara ?? null}
                  dataComunicado={extraido.dataComunicado}
                  onToast={setToast}
                  onPadraoSalvo={(padrao) =>
                    setEmpresas((lista) =>
                      lista?.map((x) => (x.cnpj === empresa.cnpj ? { ...x, relatorio: padrao } : x)) ?? lista
                    )
                  }
                />
              )}
            </>
          ) : (
            <p className="lead">Escolha a empresa para montar o certificado.</p>
          )}
        </div>
      )}

      {toast && (
        <div id="toast-host" role="status">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}
