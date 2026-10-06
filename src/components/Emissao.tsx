"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { montarCertificado, REGRAS_EMPRESA, sugerirTipo, type TipoTratamento } from "@/lib/certificado";
import type { Comunicado } from "@/lib/comunicado";
import { curvaVazia, type Curva } from "@/lib/curvas/tipos";
import { identificarEmpresa, lerNomeArquivo } from "@/lib/madeireiras";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { avisosDuplicidade, validarComunicado, type EmissaoAnteriorResumo } from "@/lib/divergencias";
import { camposDoModelo, montarHtml, type Campo } from "@/lib/modelos";
import { chaveDoCiclo, juntarUltimos, verificarSequencia } from "@/lib/sequenciaCiclo";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos, ufDoMapa } from "@/lib/util";
import { FileDrop } from "./FileDrop";
import { DrCard } from "./DrCard";
import { SeiCard } from "./SeiCard";
import { LinhaRelatorioCard } from "./LinhaRelatorioCard";
import { PlanilhaControleCard } from "./PlanilhaControleCard";
import { Steps } from "./Steps";

interface Extraido {
  nomeArquivo: string;
  semTexto: boolean;
  ocr?: boolean;
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
  const [conferiuDivergencias, setConferiuDivergencias] = useState(false);
  const [sequenciaConferida, setSequenciaConferida] = useState<string[]>([]);
  const docRef = useRef<HTMLDivElement>(null);
  // Certificados já registrados nesta tela (copiar duas vezes não conta duas emissões).
  const registrados = useRef(new Set<string>());

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
      ? {
          curva,
          empresa,
          comunicado: extraido.comunicado,
          nomeArquivo: extraido.nomeArquivo,
          tomadores: empresa.relatorio?.tomadores,
          empresas: empresas ?? undefined,
          ultimoLote: empresa.relatorio?.ultimoLote,
        }
      : null;
  const sugestao = entrada ? sugerirTipo(entrada) : null;

  const montado = entrada ? montarCertificado(entrada, tipo) : null;
  const valores = montado ? { ...montado.valores, ...ajustes } : null;
  const html = montado && valores ? montarHtml(montado.modelo, valores) : "";

  // Trava de divergência: comunicado x curva (dia, horário, material, quantidade).
  const prestadora = !!(empresa && REGRAS_EMPRESA[soDigitos(empresa.cnpj)]?.prestadora);
  const numeroCertificado = valores?.numero ?? null;
  const numeroComunicado = extraido?.comunicado?.numero ?? null;

  // Prestadora: certificado/comunicado já emitido? (histórico de emissões; só informa se a consulta falhar)
  const cnpjConsulta = prestadora && empresa ? empresa.cnpj : null;
  const chaveConsulta = cnpjConsulta && numeroCertificado ? `${cnpjConsulta}|${numeroCertificado}|${numeroComunicado ?? ""}` : null;
  const [consulta, setConsulta] = useState<{ chave: string; anteriores: EmissaoAnteriorResumo[] } | null>(null);
  useEffect(() => {
    if (!cnpjConsulta || !numeroCertificado || !chaveConsulta) return;
    const ctrl = new AbortController();
    const p = new URLSearchParams({ cnpj: cnpjConsulta, numero: numeroCertificado });
    if (numeroComunicado) p.set("comunicado", numeroComunicado);
    fetch(`/api/emissoes?${p}`, { headers: cabecalhoSenha(senha), cache: "no-store", signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setConsulta({ chave: chaveConsulta, anteriores: data.anteriores ?? [] }))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [senha, cnpjConsulta, numeroCertificado, numeroComunicado, chaveConsulta]);
  // Só vale o resultado da consulta atual (trocou de certificado/empresa: some até responder).
  const anteriores = consulta && consulta.chave === chaveConsulta ? consulta.anteriores : [];

  const divergenciasComunicado =
    montado && valores && curva && extraido?.comunicado
      ? validarComunicado({
          curva,
          comunicado: extraido.comunicado,
          valores,
          tipo,
          prestadora,
          nomeArquivo: extraido.nomeArquivo,
          dataComunicado: extraido.dataComunicado,
        })
      : [];
  const divergencias = [
    ...divergenciasComunicado,
    ...(cnpjConsulta ? avisosDuplicidade(anteriores, numeroCertificado, numeroComunicado) : []),
  ];
  const errosDivergencia = divergencias.filter((d) => d.nivel === "erro");
  const travado = errosDivergencia.length > 0 && !conferiuDivergencias;

  // Sequência dos ciclos da estufa (curva faltando ou repetida).
  const chaveCiclo = valores ? chaveDoCiclo(valores.ciclo, curva?.camara, curva?.lote) : null;
  const avisoSequencia = empresa
    ? verificarSequencia(chaveCiclo, juntarUltimos(empresa.estilo?.ultimosCiclos, empresa.relatorio?.ciclos))
    : null;
  const mostrarSequencia = avisoSequencia && !sequenciaConferida.includes(avisoSequencia.id);

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
      setConferiuDivergencias(false);
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
    setConferiuDivergencias(false);
    setErro(null);
    setEditando(false);
  }

  /**
   * Depois de copiar: guarda na empresa o tomador preenchido (credenciadas/prestadoras)
   * e o lote numérico usado (empresas com lote sequencial), para os próximos certificados.
   */
  async function guardarTomador() {
    if (!empresa || !valores) return;
    const padrao: Record<string, unknown> = {};
    if (/^\d{1,8}$/.test(valores.lote ?? "")) padrao.ultimoLote = valores.lote;
    if (chaveCiclo) padrao.ciclos = { [chaveCiclo.estufa]: chaveCiclo.numero };
    const cnpj = soDigitos(valores.tomCnpj);
    if (cnpj.length === 14 && cnpj !== soDigitos(empresa.cnpj) && valores.tomEndereco) {
      padrao.tomadores = {
        [cnpj]: {
          razao: valores.tomRazao ?? "",
          cnpj: valores.tomCnpj ?? "",
          endereco: valores.tomEndereco ?? "",
          telefone: valores.tomTelefone ?? "",
          email: valores.tomEmail ?? "",
        },
      };
    }
    if (!Object.keys(padrao).length) return;
    try {
      const res = await fetch("/api/madeireiras/padrao", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj: empresa.cnpj, padrao }),
      });
      if (res.ok) {
        const { padrao } = await res.json();
        setEmpresas((lista) => lista?.map((x) => (x.cnpj === empresa.cnpj ? { ...x, relatorio: padrao } : x)) ?? lista);
      }
    } catch {
      // conveniência: o certificado já foi copiado
    }
  }

  /** Controladoria: quem copiou qual certificado (e se passou por divergências conferidas). */
  async function registrarEmissao() {
    if (!empresa || !valores) return;
    const chave = `${empresa.cnpj}|${valores.numero}|${valores.lote}`;
    if (registrados.current.has(chave)) return;
    registrados.current.add(chave);
    try {
      await fetch("/api/emissoes", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({
          empresaCnpj: empresa.cnpj,
          empresaApelido: empresa.apelido,
          numero: valores.numero,
          tipo,
          lote: valores.lote,
          ciclo: valores.ciclo,
          dataTratamento: valores.dataInicio,
          comunicado: prestadora ? numeroComunicado : null,
          divergencias: conferiuDivergencias ? errosDivergencia.map((d) => `${d.campo}: ${d.detalhe}`) : [],
        }),
      });
    } catch {
      registrados.current.delete(chave); // tenta de novo na próxima cópia
    }
  }

  async function copiar() {
    if (travado) {
      setToast("Há divergências entre o comunicado e a curva: confira e marque “Conferi as divergências” para copiar.");
      document.getElementById("divergencias")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
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
      void guardarTomador();
      void registrarEmissao();
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
          <li>Confira se a tabela foi criada no Supabase e envie a planilha na aba Cadastros.</li>
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
                <li>Cadastre a empresa na aba Cadastros antes de emitir.</li>
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
              {carregando ? "Lendo os PDFs… (curvas em imagem levam até 30 s)" : "Extrair dados"}
            </button>
            <span className="hint">
              O nº do certificado e o lote vêm do nome do arquivo da curva (“341 ABB 1-350” → 341/2026, lote 1-350). Lote próprio da empresa no fim, entre parênteses: “165 GM 1-446(833)”.
            </span>
          </div>
        </form>
      ) : (
        <div className="view">
          {divergencias.length > 0 && (
            <div id="divergencias" className={`alert-box${errosDivergencia.length ? " critical" : ""}`} role="alert">
              <h4>
                {errosDivergencia.length
                  ? "Divergências encontradas — confira antes de copiar"
                  : "Confira antes de copiar"}
              </h4>
              <ul className="diverg">
                {divergencias.map((d, i) => (
                  <li key={i}>
                    <b>{d.campo}:</b> {d.detalhe}
                    {(d.comunicado || d.curva) && (
                      <span className="diverg-lados mono">
                        {d.rotulos?.[0] ?? "Comunicado"}: {d.comunicado} · {d.rotulos?.[1] ?? "Curva"}: {d.curva}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {errosDivergencia.length > 0 && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={conferiuDivergencias}
                    onChange={(e) => setConferiuDivergencias(e.target.checked)}
                  />{" "}
                  Conferi as divergências e quero continuar mesmo assim
                </label>
              )}
            </div>
          )}

          {mostrarSequencia && avisoSequencia && (
            <div className="alert-box" role="status">
              <h4>Sequência de ciclos</h4>
              <ul>
                <li>{avisoSequencia.texto}</li>
              </ul>
              <button
                type="button"
                className="btn"
                onClick={() => setSequenciaConferida((l) => [...l, avisoSequencia.id])}
              >
                Conferido
              </button>
            </div>
          )}

          {(extraido.semTexto || extraido.ocr || !empresa || (montado && montado.avisos.length > 0)) && (
            <div className="alert-box">
              <h4>Confira antes de copiar</h4>
              <ul>
                {extraido.semTexto && (
                  <li>
                    Este PDF é uma imagem (sem texto): preencha início, término, ciclo e temperatura em “Editar
                    campos”.
                  </li>
                )}
                {extraido.ocr && (
                  <li>
                    Esta curva é uma imagem e foi lida por OCR: confira com atenção datas, horários, ciclo e
                    temperatura.
                  </li>
                )}
                {!empresa && <li>Não identifiquei a empresa: escolha na lista abaixo.</li>}
                {montado?.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <div className="grid kpis">
            <div className="card">
              <div className="kpi-label">
                Empresa{" "}
                {empresa && <span className="uf-destaque pequeno">{ufDoMapa(empresa.regMapa, empresa.uf) ?? "?"}</span>}
              </div>
              <select value={cnpjEscolhido} onChange={(e) => trocarEmpresa(e.target.value)} aria-label="Empresa">
                <option value="">— escolha —</option>
                {empresas?.filter((e) => !e.config?.inativa || e.cnpj === cnpjEscolhido).map((e) => (
                  <option key={e.cnpj} value={e.cnpj}>
                    {e.apelido} · {ufDoMapa(e.regMapa, e.uf) ?? "?"} · {e.regMapa}
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
              <select value={tipo} onChange={(e) => {
                  setTipo(e.target.value as TipoTratamento);
                  // Mantém o que veio da planilha de controle / foi digitado sobre o produto.
                  setAjustes((a) => ({ produto: a.produto, volumes: a.volumes, quantidade: a.quantidade, numero: a.numero }));
                }} aria-label="Tipo de tratamento">
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

          {empresa && <SeiCard senha={senha} empresa={empresa} valores={valores} onToast={setToast} />}

          {curva && montado && (curva.sistema === "SV520" || curva.sistema === "Mahild") && (
            <PlanilhaControleCard
              key={extraido.nomeArquivo}
              curva={curva}
              onPreencher={(p) =>
                setAjustes((a) => ({
                  ...a,
                  produto: p.produto,
                  ...(p.volumes && { volumes: p.volumes }),
                  ...(p.quantidade && { quantidade: p.quantidade }),
                }))
              }
            />
          )}

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
                  comunicado={extraido.comunicado}
                  dataComunicado={extraido.dataComunicado}
                  onToast={setToast}
                  onPadraoSalvo={(padrao) =>
                    setEmpresas((lista) =>
                      lista?.map((x) => (x.cnpj === empresa.cnpj ? { ...x, relatorio: padrao } : x)) ?? lista
                    )
                  }
                />
              )}
              {empresa && valores && (
                <DrCard empresa={empresa} valores={valores} tipo={tipo} curva={curva} onToast={setToast} />
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
