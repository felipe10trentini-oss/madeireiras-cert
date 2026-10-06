"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FormEmpresa, FormRt, ListaRts, type Rt } from "@/components/CadastroMadeireiras";
import { ClientesPrestadora } from "@/components/ClientesPrestadora";
import { FileDrop } from "@/components/FileDrop";
import { PortaoSenha } from "@/components/PortaoSenha";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { baixarPlanilha, linhaDaEmpresa, montarPlanilhaCadastro, montarPlanilhaRts } from "@/lib/planilhaCadastro";
import { lerAcessosSei, lerPlanilhaMadeireiras } from "@/lib/planilhaMadeireiras";
import { rtCompleto } from "@/lib/responsaveis";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { soDigitos, ufDoMapa } from "@/lib/util";

type Aba = "planilha" | "empresa" | "rt";

/** "2026-10-06" para o nome dos arquivos de backup. */
const hojeIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

interface Resumo {
  totalNaPlanilha: number;
  novas: string[];
  atualizadas: { apelido: string; campos: string[] }[];
  iguais: number;
  ignoradas: number;
  ausentesNaPlanilha: number;
  aplicado: boolean;
}

const NOME_CAMPO: Record<string, string> = {
  apelido: "empresa",
  rt: "RT",
  uf: "UF",
  modalidade: "modalidade",
  tratamentos: "tratamentos",
  razao_social: "razão social",
  cnpj: "CNPJ",
  crea: "CREA",
  telefone: "telefone",
  endereco: "endereço",
  reg_mapa: "registro MAPA",
  email: "e-mail",
  documento: "programação/comunicado",
  processo: "processo da programação",
  unidade_volumes: "unidade dos volumes",
  config: "configurações (lote, ciclo, tomador, DR…)",
};

function Madeireiras({ senha, sair }: { senha: string; sair: () => void }) {
  const [lista, setLista] = useState<MadeireiraSalva[] | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  // O arquivo é lido uma vez só: se o OneDrive sincronizar a planilha depois de escolhida, o
  // navegador não deixa ler de novo (a 2ª leitura falhava na aba ACESSO SEI).
  const bytes = useRef<ArrayBuffer | null>(null);
  const lerBytes = async () => (bytes.current ??= await arquivo!.arrayBuffer());
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [acessosMsg, setAcessosMsg] = useState<string | null>(null);
  const [arquivoSei, setArquivoSei] = useState<File | null>(null);
  const bytesSei = useRef<ArrayBuffer | null>(null);
  const [planilhaLida, setPlanilhaLida] = useState<Awaited<ReturnType<typeof lerPlanilhaMadeireiras>> | null>(null);
  // Cadastro pelo site: aba aberta, empresa/RT em edição, lista dos RTs.
  const [aba, setAba] = useState<Aba>("planilha");
  const [editEmpresa, setEditEmpresa] = useState<Record<string, string> | null>(null);
  const [editRt, setEditRt] = useState<Rt | null>(null);
  const [rts, setRts] = useState<Rt[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/madeireiras", { headers: cabecalhoSenha(senha), cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setLista(data.empresas);
        setErroLista(null);
      } else setErroLista(data.error ?? "Falha ao ler o cadastro.");
    } catch {
      setErroLista("Não foi possível conectar ao servidor.");
    }
  }, [senha]);

  const carregarRts = useCallback(async () => {
    try {
      const res = await fetch("/api/madeireiras/rts", { headers: cabecalhoSenha(senha), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      setRts(res.ok ? data.rts : []);
    } catch {
      setRts([]);
    }
  }, [senha]);

  useEffect(() => {
    void carregar();
    void carregarRts();
  }, [carregar, carregarRts]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function abrir(a: Aba) {
    setAba(a);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Backup da planilha de cadastro (o mesmo formato do upload: dá para editar e reenviar). */
  async function backupCadastro() {
    if (!lista) return;
    try {
      const ordenadas = [...lista].sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
      await baixarPlanilha(montarPlanilhaCadastro(ordenadas.map((e) => linhaDaEmpresa(e))), `Cadastro Madeireiras ${hojeIso()}.xlsx`);
    } catch {
      setToast("Não foi possível gerar o backup do cadastro.");
    }
  }

  /** Backup dos acessos do SEI dos RTs (aba ACESSO SEI, com as senhas: guardar em local seguro). */
  async function backupRts() {
    try {
      const res = await fetch("/api/madeireiras/rts?backup=1", { headers: cabecalhoSenha(senha), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setToast(data.error ?? "Não foi possível gerar o backup dos RTs.");
      await baixarPlanilha(montarPlanilhaRts(data.rts), `Acessos SEI ${hojeIso()}.xlsx`);
    } catch {
      setToast("Não foi possível gerar o backup dos RTs.");
    }
  }

  async function enviar(modo: "previa" | "aplicar") {
    if (!arquivo) return;
    setTrabalhando(true);
    setErro(null);
    try {
      // Lida aqui no navegador: a Planilha Geral passa do limite de envio da Vercel (4,5 MB).
      let lida = planilhaLida;
      if (!lida) {
        try {
          lida = await lerPlanilhaMadeireiras(await lerBytes());
          setPlanilhaLida(lida);
        } catch (e) {
          setErro(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
          return;
        }
      }
      const res = await fetch("/api/madeireiras/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ ...lida, modo }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) sair();
      else if (!res.ok) setErro(data.error ?? "Não foi possível processar a planilha.");
      else {
        setResumo(data as Resumo);
        if (modo === "aplicar") {
          void carregar();
          void enviarAcessosSei();
        }
      }
    } catch {
      setErro("Não foi possível conectar ao servidor.");
    } finally {
      setTrabalhando(false);
    }
  }

  /**
   * Logins e senhas do SEI dos RTs (cifrados no servidor): da aba ACESSO SEI da Planilha Geral
   * ou de uma planilha só com os acessos (campo próprio, mais leve).
   */
  async function enviarAcessosSei(origem?: ArrayBuffer | null) {
    const dados = origem ?? (arquivo ? await lerBytes().catch(() => null) : null);
    if (!dados) {
      setAcessosMsg("Escolha a planilha com os acessos do SEI.");
      return;
    }
    setAcessosMsg("Lendo os acessos do SEI…");
    try {
      const acessos = await lerAcessosSei(dados);
      if (!acessos) {
        setAcessosMsg("Não achei as colunas dos acessos (LOGIN RESP. ou NOME, LOGIN e SENHA) nesta planilha.");
        return;
      }
      const res = await fetch("/api/madeireiras/sei", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ acessos }),
      });
      const data = await res.json().catch(() => ({}));
      setAcessosMsg(res.ok ? `Acessos do SEI atualizados: ${data.gravados}.` : `Acessos do SEI: ${data.error ?? "falha ao gravar"}.`);
      if (res.ok) void carregarRts();
    } catch (e) {
      console.error("Acessos do SEI:", e);
      setAcessosMsg(`Não foi possível ler a aba ACESSO SEI (${e instanceof Error ? e.message : "erro"}).`);
    }
  }

  const mudancas = resumo ? resumo.novas.length + resumo.atualizadas.length : 0;
  const f = filtro.trim().toLowerCase();
  const visiveis = (lista ?? []).filter(
    (e) => !f || `${e.apelido} ${e.razaoSocial} ${e.regMapa} ${e.cnpj}`.toLowerCase().includes(f)
  );

  return (
    <div className="view">
      <div className="abas-cadastro">
        <button type="button" className={`btn${aba === "planilha" ? " primary" : ""}`} onClick={() => abrir("planilha")}>
          Atualizar por planilha
        </button>
        <button
          type="button"
          className={`btn${aba === "empresa" ? " primary" : ""}`}
          onClick={() => {
            setEditEmpresa(null);
            abrir("empresa");
          }}
        >
          Cadastrar empresa
        </button>
        <button
          type="button"
          className={`btn${aba === "rt" ? " primary" : ""}`}
          onClick={() => {
            setEditRt(null);
            abrir("rt");
          }}
        >
          Cadastrar RT
        </button>
        <div className="spacer" />
        <button type="button" className="btn" disabled={!lista} onClick={backupCadastro} title="Baixa a planilha de cadastro com todas as empresas (dá para editar e enviar de volta)">
          Backup do cadastro (.xlsx)
        </button>
        <button type="button" className="btn" onClick={backupRts} title="Baixa a planilha dos acessos do SEI dos RTs, com as senhas: guarde em local seguro">
          Backup dos RTs (.xlsx)
        </button>
      </div>

      {erroLista && (
        <div className="alert-box critical" role="alert">
          <h4>Cadastro indisponível</h4>
          <ul>
            <li>{erroLista}</li>
          </ul>
        </div>
      )}

      {aba === "empresa" && (
        <FormEmpresa
          key={editEmpresa?.CNPJ ?? "nova"}
          senha={senha}
          inicial={editEmpresa}
          cnpjsExistentes={(lista ?? []).map((e) => soDigitos(e.cnpj))}
          rts={[...new Set((rts ?? []).filter((r) => !/legal/i.test(r.funcao ?? "")).map((r) => rtCompleto(r.nome) ?? r.nome))]}
          onSalvo={(msg) => {
            setToast(msg);
            setEditEmpresa(null);
            setAba("planilha");
            void carregar();
          }}
          onCancelar={() => {
            setEditEmpresa(null);
            setAba("planilha");
          }}
        />
      )}

      {aba === "rt" && (
        <FormRt
          key={editRt?.id ?? "novo"}
          senha={senha}
          inicial={editRt}
          onSalvo={(msg) => {
            setToast(msg);
            setEditRt(null);
            void carregarRts();
          }}
          onCancelar={() => {
            setEditRt(null);
            setAba("planilha");
          }}
        />
      )}

      {aba === "planilha" && (
      <>
      <p className="lead">
        Envie a planilha <b>Cadastro Madeireiras</b> (aba <b>CADASTRO</b>): dados das empresas e as configurações de
        cada uma (programação/comunicado, formato do lote e do ciclo, tomador fixo, DR…). Também aceita a{" "}
        <b>Planilha Geral</b> antiga (abas DADOS CADASTRAIS e PROGRAMAÇÕES). A comparação é pelo <b>CNPJ</b>: cadastra as
        novas e atualiza as que mudaram. Nenhuma empresa é apagada — para tirar uma da lista, marque <b>Ativa: Não</b>.
        Para ter a versão mais recente no computador, use <b>Backup do cadastro</b>: o arquivo pode ser editado e enviado aqui.
      </p>

      <div className="drops" style={{ gridTemplateColumns: "1fr" }}>
        <FileDrop
          titulo="Planilha de cadastro"
          dica="Arraste a Cadastro Madeireiras.xlsx (ou a Planilha Geral) aqui ou clique para escolher"
          arquivo={arquivo}
          onArquivo={(x) => {
            setArquivo(x);
            bytes.current = null;
            // Já lê ao escolher, antes que o OneDrive mexa no arquivo.
            x?.arrayBuffer().then((b) => (bytes.current = b)).catch(() => undefined);
            setPlanilhaLida(null);
            setResumo(null);
            setErro(null);
          }}
          accept=".xlsx"
          aceita={(x) => /\.xlsx$/i.test(x.name)}
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

      <div className="actions" style={{ marginBottom: 18 }}>
        <button type="button" className="btn primary lg" disabled={!arquivo || trabalhando} onClick={() => enviar("previa")}>
          {trabalhando && !resumo ? "Lendo a planilha…" : "Ver o que vai mudar"}
        </button>
        <button type="button" className="btn" onClick={sair}>
          Sair
        </button>
      </div>

      {resumo && (
        <div className="view">
          <div className="grid kpis">
            <div className="card">
              <div className="kpi-label">Novas</div>
              <div className="kpi-value">{resumo.novas.length}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Atualizadas</div>
              <div className="kpi-value">{resumo.atualizadas.length}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Sem mudança</div>
              <div className="kpi-value">{resumo.iguais}</div>
            </div>
            <div className="card">
              <div className="kpi-label">Ignoradas (sem CNPJ válido)</div>
              <div className="kpi-value">{resumo.ignoradas}</div>
              <div className="kpi-sub">{resumo.ausentesNaPlanilha} do cadastro não estão nesta planilha (mantidas)</div>
            </div>
          </div>

          {resumo.novas.length > 0 && (
            <p className="lead">
              <b>Novas:</b> {resumo.novas.join(", ")}
            </p>
          )}
          {resumo.atualizadas.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table className="dados">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>O que mudou</th>
                  </tr>
                </thead>
                <tbody>
                  {resumo.atualizadas.map((c) => (
                    <tr key={c.apelido}>
                      <td>{c.apelido}</td>
                      <td>{c.campos.map((k) => NOME_CAMPO[k] ?? k).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {resumo.aplicado ? (
            <div className="alert-box" style={{ borderColor: "var(--good)", background: "var(--good-bg)" }}>
              <h4>Cadastro atualizado</h4>
              <ul>
                <li>
                  {resumo.novas.length} nova(s) e {resumo.atualizadas.length} atualizada(s).
                </li>
              </ul>
            </div>
          ) : mudancas === 0 ? (
            <div className="alert-box">
              <h4>Nada a fazer</h4>
              <ul>
                <li>O cadastro já está igual à planilha.</li>
              </ul>
            </div>
          ) : (
            <div className="actions">
              <button type="button" className="btn primary lg" disabled={trabalhando} onClick={() => enviar("aplicar")}>
                {trabalhando ? "Aplicando…" : `Aplicar ${mudancas} mudança(s)`}
              </button>
              <span className="hint">Confira a lista acima antes de aplicar.</span>
            </div>
          )}
          <div className="actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn" disabled={trabalhando} onClick={() => enviarAcessosSei()}>
              Atualizar acessos do SEI (aba ACESSO SEI)
            </button>
            <span className="hint">
              {acessosMsg ?? "Logins e senhas do SEI dos RTs: aparecem na emissão para copiar. Ao aplicar as mudanças eles também são atualizados."}
            </span>
          </div>
        </div>
      )}

      <div className="section-title">
        <h2>Acessos do SEI dos RTs</h2>
        <p>Planilha só com os acessos (ou a Planilha Geral, aba ACESSO SEI)</p>
      </div>
      <div className="card" style={{ marginBottom: 22 }}>
        <p className="hint" style={{ marginTop: 0 }}>
          Colunas: <b>LOGIN RESP.</b> (nome do RT), <b>RESPONSABILIDADE</b>, <b>EMPRESA</b>, <b>LOGIN</b> (e-mail do SEI) e{" "}
          <b>SENHA</b> — as mesmas da aba ACESSO SEI. As senhas ficam criptografadas. A planilha <b>substitui a lista toda</b>{" "}
          dos RTs: para alterar um só, use <b>Cadastrar RT</b> (ou baixe o backup, edite e envie).
        </p>
        <div className="drops" style={{ gridTemplateColumns: "1fr" }}>
          <FileDrop
            titulo="Acessos do SEI"
            dica="Arraste a planilha dos acessos do SEI (.xlsx) aqui ou clique para escolher"
            arquivo={arquivoSei}
            accept=".xlsx"
            aceita={(x) => /\.xlsx$/i.test(x.name)}
            onArquivo={(x) => {
              setArquivoSei(x);
              bytesSei.current = null;
              setAcessosMsg(null);
              x?.arrayBuffer().then((b) => (bytesSei.current = b)).catch(() => undefined);
            }}
          />
        </div>
        <div className="actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn primary"
            disabled={!arquivoSei}
            onClick={async () => enviarAcessosSei(bytesSei.current ?? (await arquivoSei!.arrayBuffer().catch(() => null)))}
          >
            Enviar acessos do SEI
          </button>
          {acessosMsg && <span className="hint">{acessosMsg}</span>}
        </div>
      </div>

      <ClientesPrestadora senha={senha} empresas={lista} onAplicado={carregar} />
      </>
      )}

      <div className="section-title">
        <h2>Madeireiras cadastradas {lista ? `(${lista.length})` : ""}</h2>
        <div className="field" style={{ minWidth: 240 }}>
          <input type="text" placeholder="Buscar empresa, CNPJ ou registro" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table className="dados">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Modalidade</th>
              <th>Trat.</th>
              <th>Documento</th>
              <th>Registro MAPA</th>
              <th>CNPJ</th>
              <th>RT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-row">
                  {lista ? "Nenhuma empresa." : "Carregando…"}
                </td>
              </tr>
            ) : (
              visiveis.map((e) => (
                <tr key={e.cnpj}>
                  <td>
                    {e.apelido} <span className="badge">{ufDoMapa(e.regMapa, e.uf) ?? "?"}</span>
                  </td>
                  <td>
                    <span className={`badge ${e.modalidade === "Credenciada" ? "pago" : "pendente"}`}>{e.modalidade}</span>
                  </td>
                  <td>{e.tratamentos.join("/")}</td>
                  <td>{e.documento === "comunicado" ? "Comunicado" : e.documento === "programacao" ? "Programação" : "—"}</td>
                  <td className="mono">{e.regMapa}</td>
                  <td className="mono">{e.cnpj}</td>
                  <td>{e.rt}</td>
                  <td>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        setEditEmpresa(linhaDaEmpresa(e));
                        abrir("empresa");
                      }}
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="section-title" style={{ marginTop: 26 }}>
        <h2>RTs cadastrados {rts ? `(${rts.length})` : ""}</h2>
        <p>Acessos do SEI — a senha fica oculta: clique em mostrar</p>
      </div>
      <ListaRts
        senha={senha}
        rts={rts}
        onEditar={(r) => {
          setEditRt(r);
          abrir("rt");
        }}
        onExcluido={() => void carregarRts()}
        onToast={setToast}
      />

      {toast && (
        <div id="toast-host" role="status">
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}

export default function PaginaMadeireiras() {
  return (
    <PortaoSenha titulo="Cadastros" pagina="madeireiras">
      {(senha, sair) => <Madeireiras senha={senha} sair={sair} />}
    </PortaoSenha>
  );
}
