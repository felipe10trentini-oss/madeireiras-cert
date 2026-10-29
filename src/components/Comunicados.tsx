"use client";

// Emissão do comunicado de tratamento: escolhe a empresa, cola o texto (mensagem do cliente, e-mail,
// lista) e o site preenche o Excel modelo da empresa (timbre e logo dela) com o número seguinte.
import JSZip from "jszip";
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
import { interpretarPedido } from "@/lib/comunicadoTexto";
import { baixarFontes } from "@/lib/declaracaoLgPdf";
import { excelParaPdf } from "@/lib/excelPdf";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import { escolherPasta, maiorNumero, pastaLembrada, pastaSuportada, permissao, salvarNaPasta, ultimoDaPasta, type Pasta, type UltimoDaPasta } from "@/lib/pastaComunicados";
import { cabecalhoSenha } from "@/lib/senhaEquipe";
import { textoDaPlanilha, textoDoWord } from "@/lib/textoDeArquivo";
import { soDigitos } from "@/lib/util";
import { SeiCard } from "./SeiCard";
import { SoltarArquivos } from "./SoltarArquivos";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Empresas se descredenciando (26/10/2026): não emitem mais comunicado pelo site.
const SEM_COMUNICADO = new Set(["Flavia", "JJR", "Megga", "Vale Norte"]);

// Duração padrão de todos os comunicados (28/10/2026).
const DURACAO = "32 min";

// Mistas: emitem comunicado e programação (MART: 3º tratamento do dia, fim de semana e feriado; Madeval:
// HT de embalagem como prestadora). Ficam na aba mesmo marcadas como "programação" no cadastro.
const MISTAS = new Set(["Madeval", "MART"]);

// Horários de sempre, quando o pedido diz "mesmos horários" e o site ainda não tem o histórico (29/10/2026).
const HORARIOS_PADRAO: Record<string, string[]> = { "33039086000115": ["07h00m", "11h00m", "15h00m"] }; // DM

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
  historico: { numero: string; data: string; horario: string }[];
}

const deBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const paraBase64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

interface Pedido {
  valores: Partial<Record<CampoComunicado, string>>;
  achados: CampoComunicado[];
  avisos: string[];
}

function baixar(bytes: Uint8Array, nome: string, tipo = XLSX) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
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
  // Um pedido pode ter vários comunicados (um por tratamento).
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [sel, setSel] = useState(0);
  const [ultimoExcel, setUltimoExcel] = useState<{ bytes: Uint8Array; nome: string } | null>(null);
  const atual = pedidos[sel] ?? pedidos[0] ?? null;
  const valores = atual?.valores ?? {};
  const achados = atual?.achados ?? [];
  const avisos = atual?.avisos ?? [];
  const setValores = (f: (v: Partial<Record<CampoComunicado, string>>) => Partial<Record<CampoComunicado, string>>) =>
    setPedidos((ps) => ps.map((x, i) => (i === Math.min(sel, ps.length - 1) ? { ...x, valores: f(x.valores) } : x)));
  const [erro, setErro] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [versao, setVersao] = useState(0);
  // Pasta "Madeireiras 2" do computador: o último comunicado emitido (PDF/Excel) da empresa.
  const [pasta, setPasta] = useState<{ p: Pasta; ok: boolean } | null>(null);
  const [daPasta, setDaPasta] = useState<UltimoDaPasta | null | "lendo">(null);

  useEffect(() => {
    if (!pastaSuportada()) return;
    void pastaLembrada().then(async (p) => p && setPasta({ p, ok: (await permissao(p)) === "granted" }));
  }, []);

  // Ao escolher a empresa (com a pasta liberada): o maior número da pasta dela.
  useEffect(() => {
    if (!cnpj || !pasta?.ok) return;
    const e = (empresas ?? []).find((x) => x.cnpj === cnpj);
    if (!e) return;
    let vivo = true;
    setDaPasta("lendo");
    ultimoDaPasta(pasta.p, e)
      .then((r) => vivo && setDaPasta(r))
      .catch(() => vivo && setDaPasta(null));
    return () => {
      vivo = false;
    };
  }, [cnpj, pasta, empresas]);

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
        .filter((e) => (e.documento === "comunicado" || MISTAS.has(e.apelido)) && !e.config?.inativa && !SEM_COMUNICADO.has(e.apelido))
        .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR")),
    [empresas]
  );
  const empresa = lista.find((e) => e.cnpj === cnpj) ?? null;
  const numeroDaPasta = daPasta && daPasta !== "lendo" ? daPasta.numero : null;
  // Último emitido = o maior entre o site, o Excel do modelo e a pasta (PDF/Excel).
  const ultimoEmitido = maiorNumero(maiorNumero(salvo?.ultimoNumero, modelo?.campos.numero?.valor), numeroDaPasta);
  const numeroEhAviso = !!modelo?.campos.aviso && modelo.campos.aviso.valor === modelo.campos.numero?.valor;
  // Os terceiros cadastrados e a própria empresa (a Madepallete/TLP também tratam o material delas).
  const tomadores = useMemo(() => {
    if (!empresa) return [];
    const terceiros = Object.values(empresa.relatorio?.tomadores ?? {});
    const propria = { razao: empresa.razaoSocial, cnpj: empresa.cnpj, endereco: empresa.endereco ?? "", telefone: empresa.telefone ?? "", email: empresa.email ?? "" };
    return [...terceiros.filter((t) => soDigitos(t.cnpj) !== soDigitos(empresa.cnpj)), propria].sort((a, b) => a.razao.localeCompare(b.razao, "pt-BR"));
  }, [empresa]);

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
        setSalvo({ salvo: !!j.salvo, nomeModelo: j.nomeModelo, ultimoNumero: j.ultimoNumero, bytes, historico: j.historico ?? [] });
        if (!bytes) {
          setModelo(null);
          return;
        }
        try {
          const m = await lerModeloComunicado(bytes);
          if (!vivo) return;
          setModelo(m);
          const base = Object.fromEntries(Object.values(m.campos).map((c) => [c!.campo, c!.valor])) as Partial<Record<CampoComunicado, string>>;
          base.numero = proximoNumero(maiorNumero(j.ultimoNumero, m.campos.numero?.valor), new Date().getFullYear());
          if (m.campos.duracao) base.duracao = DURACAO;
          setPedidos([{ valores: completarTabela(m, base), achados: [], avisos: [] }]);
          setSel(0);
        } catch (e) {
          setErro(e instanceof Error ? e.message : "Não consegui ler o modelo.");
        }
      })
      .catch(() => vivo && setErro("Não foi possível carregar o modelo do comunicado."));
    return () => {
      vivo = false;
    };
  }, [cnpj, senha, sair, versao]);

  // A pasta achou um número maior que o do site (emitido pelo Excel ou no outro computador): a numeração
  // dos comunicados em edição segue a partir dele.
  useEffect(() => {
    if (!numeroDaPasta || numeroEhAviso) return;
    const ano = new Date().getFullYear();
    setPedidos((ps) => {
      let n = ultimoEmitido;
      return ps.map((x) => {
        n = proximoNumero(n, ano);
        return { ...x, valores: { ...x.valores, numero: n } };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeroDaPasta]);

  function escolher(c: string) {
    setCnpj(c);
    setSalvo(null);
    setModelo(null);
    setPedidos([]);
    setSel(0);
    setUltimoExcel(null);
    setTexto("");
    setErro(null);
    setDaPasta(null);
  }

  async function ligarPasta() {
    try {
      if (pasta && !pasta.ok) {
        const ok = (await permissao(pasta.p, true)) === "granted";
        setPasta({ p: pasta.p, ok });
        if (!ok) setToast("Sem permissão para ler a pasta.");
        return;
      }
      const p = await escolherPasta();
      if (p) setPasta({ p, ok: true });
    } catch {
      // cancelou a escolha
    }
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

  /**
   * Pedido em arquivo: planilha (.xlsx) e Word (.docx) lidos aqui; imagem (print do WhatsApp, foto) e PDF
   * no servidor (OCR). O texto vai para a caixa (dá para conferir) e já é identificado.
   */
  async function lerArquivos(files: File[]) {
    setOcupado(true);
    const partes: string[] = [];
    try {
      for (const f of files) {
        const n = f.name.toLowerCase();
        if (/\.xls$|\.doc$/.test(n)) {
          setToast(`${f.name}: formato antigo do Office — abra e salve como .xlsx/.docx, ou copie o texto.`);
          continue;
        }
        if (/\.xlsx$/.test(n)) partes.push(await textoDaPlanilha(await f.arrayBuffer()));
        else if (/\.docx$/.test(n)) partes.push(await textoDoWord(await f.arrayBuffer()));
        else if (/\.(txt|csv)$/.test(n)) partes.push((await f.text()).replace(/;/g, " | "));
        else {
          const form = new FormData();
          form.append("arquivo", f);
          const res = await fetch("/api/comunicados/ler", { method: "POST", headers: cabecalhoSenha(senha), body: form });
          if (res.status === 401) return sair();
          const j = await res.json().catch(() => ({}));
          if (!res.ok) setToast(j.error ?? `Não consegui ler ${f.name}.`);
          else partes.push(j.texto ?? "");
        }
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
    } finally {
      setOcupado(false);
    }
    // Um pedido por arquivo: a linha separadora fica na caixa e o separarPedidos corta nela.
    const lido = partes.map((x) => x.trim()).filter(Boolean).join("\n--- próximo arquivo ---\n");
    if (!lido) return;
    const novo = [texto.trim(), lido].filter(Boolean).join("\n--- próximo arquivo ---\n");
    setTexto(novo);
    identificar(novo);
  }

  function identificar(textoUsado = texto) {
    if (!modelo || !empresa) return;
    const doModelo = Object.fromEntries(Object.values(modelo.campos).map((c) => [c!.campo, c!.valor])) as Partial<Record<CampoComunicado, string>>;
    // Um comunicado por tratamento; números em sequência (na Mann/Exata, o número do aviso).
    let numero = ultimoEmitido ?? "";
    const lidos = interpretarPedido(textoUsado, {
      tomadores,
      prestadora: !!regraDe(empresa).prestadora,
      credenciada: empresa.modalidade === "Credenciada",
      empresa,
      modelo: doModelo,
      historico: salvo?.historico ?? [],
      horariosPadrao: HORARIOS_PADRAO[soDigitos(empresa.cnpj)],
    }).map((r) => {
      if (numeroEhAviso && r.achados.includes("aviso")) r.valores.numero = r.valores.aviso!;
      else {
        numero = proximoNumero(numero, new Date().getFullYear());
        r.valores.numero = numero;
      }
      if (modelo.campos.duracao) r.valores.duracao = DURACAO;
      return { valores: completarTabela(modelo, r.valores), achados: r.achados, avisos: r.avisos };
    });
    setPedidos(lidos);
    setSel(0);
    setUltimoExcel(null);
    if (lidos.length > 1) setToast(`${lidos.length} comunicados identificados no pedido: confira cada um.`);
  }

  function trocarTomador(razaoCnpj: string) {
    const t = tomadores.find((x) => `${x.razao} - CNPJ ${x.cnpj}` === razaoCnpj);
    setValores((v) => {
      const novo = { ...v, tomador: razaoCnpj, ...(t && empresa && regraDe(empresa).prestadora && t.endereco ? { local: t.endereco } : {}) };
      return modelo ? completarTabela(modelo, novo) : novo;
    });
  }

  /**
   * Gera o PDF de todos os comunicados (um só: baixa o PDF; vários: um .zip com os PDFs) e guarda o Excel
   * preenchido do último como o modelo da empresa (a planilha fica sempre com o último emitido).
   */
  async function gerar() {
    if (!salvo?.bytes || !modelo || !empresa || !pedidos.length) return;
    const semNumero = pedidos.findIndex((x) => !(x.valores.numero ?? "").trim());
    if (semNumero >= 0) {
      setSel(semNumero);
      return setToast("Informe o número de todos os comunicados.");
    }
    setOcupado(true);
    try {
      const fontes = await baixarFontes();
      const pdfs: { nome: string; bytes: Uint8Array }[] = [];
      // O PDF é o próprio Excel do modelo preenchido, desenhado como o Excel imprime (idêntico ao Excel).
      // Todos os campos são escritos (os modelos da Mann/Exata têm fórmulas que puxariam o anterior).
      const celulas = Object.values(modelo.campos).map((c) => c!.celula);
      const preenchido = (v: Partial<Record<CampoComunicado, string>>) =>
        preencherComunicado(salvo.bytes!, modelo, Object.fromEntries(Object.keys(modelo.campos).map((k) => [k, v[k as CampoComunicado] ?? ""])));
      for (const x of pedidos) {
        const numero = x.valores.numero!.trim();
        const bytes = await excelParaPdf(await preenchido(x.valores), fontes, { aba: modelo.aba, ajustar: celulas });
        pdfs.push({ nome: nomeDoArquivo(salvo.nomeModelo, numero, empresa.apelido).replace(/\.xlsx$/i, ".pdf"), bytes });
      }
      // Pasta da empresa ligada: cada PDF vai direto para lá (o OneDrive leva ao outro computador e a
      // numeração segue certa). Sem a pasta: baixa (um PDF ou um .zip).
      let ondeFoi = "";
      const destino = pasta?.ok && daPasta && daPasta !== "lendo" ? daPasta : null;
      const salvosNaPasta: string[] = [];
      const jaExistiam: string[] = [];
      if (destino) {
        for (const p of pdfs) {
          try {
            ((await salvarNaPasta(destino.destino, p.nome, p.bytes)) === "salvo" ? salvosNaPasta : jaExistiam).push(p.nome);
          } catch {
            jaExistiam.length = 0;
            salvosNaPasta.length = 0;
            break;
          }
        }
      }
      const faltam = pdfs.filter((p) => !salvosNaPasta.includes(p.nome));
      if (salvosNaPasta.length) ondeFoi = ` na pasta “${destino!.caminhoDestino}”`;
      if (faltam.length === 1) baixar(faltam[0].bytes, faltam[0].nome, "application/pdf");
      else if (faltam.length > 1) {
        const zip = new JSZip();
        for (const p of faltam) zip.file(p.nome, p.bytes);
        baixar(await zip.generateAsync({ type: "uint8array" }), `Comunicados ${empresa.apelido} ${pedidos[0].valores.numero!.replace(/\//g, "-")} a ${pedidos[pedidos.length - 1].valores.numero!.replace(/\//g, "-")}.zip`, "application/zip");
      }
      if (jaExistiam.length) ondeFoi += ` — já existia na pasta (não sobrescrevi, baixei): ${jaExistiam.join(", ")}`;
      else if (destino && !salvosNaPasta.length) ondeFoi = " (não consegui gravar na pasta: baixei o arquivo)";
      // Excel do último emitido: fica como o modelo da empresa.
      const ultimo = pedidos[pedidos.length - 1];
      const excel = await preenchido(ultimo.valores);
      const numeroUltimo = ultimo.valores.numero!.trim();
      setUltimoExcel({ bytes: excel, nome: nomeDoArquivo(salvo.nomeModelo, numeroUltimo, empresa.apelido) });
      const res = await fetch("/api/comunicados/modelo", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({
          cnpj: empresa.cnpj,
          ultimoNumero: numeroUltimo,
          emitido: paraBase64(excel),
          emitidos: pedidos.map((x) => ({ numero: x.valores.numero ?? "", data: x.valores.data ?? "", horario: x.valores.horario ?? "" })),
        }),
      });
      setSalvo((s) =>
        s
          ? {
              ...s,
              ultimoNumero: numeroUltimo,
              bytes: excel,
              historico: [...s.historico, ...pedidos.map((x) => ({ numero: x.valores.numero ?? "", data: x.valores.data ?? "", horario: x.valores.horario ?? "" }))].slice(-60),
            }
          : s
      );
      if (salvosNaPasta.length && destino) setDaPasta({ ...destino, numero: maiorNumero(destino.numero, numeroUltimo), arquivo: salvosNaPasta[salvosNaPasta.length - 1] });
      setToast(
        res.ok
          ? `${pdfs.length === 1 ? `Comunicado ${numeroUltimo} salvo em PDF` : `${pdfs.length} comunicados salvos em PDF${salvosNaPasta.length ? "" : " (.zip)"}`}${ondeFoi}. A planilha ficou com o último (${numeroUltimo}).`
          : `PDF gerado${ondeFoi}, mas não consegui guardar o último emitido: confira a numeração na próxima vez.`
      );
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

      {/* Login e senha do SEI do RT da empresa, para peticionar o comunicado com o RT certo. */}
      {empresa && <SeiCard key={empresa.cnpj} senha={senha} empresa={empresa} valores={null} onToast={setToast} comRelatorio />}

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
            {ultimoEmitido ? ` · último comunicado: ${ultimoEmitido}` : ""}
          </span>
        </div>
      )}

      {empresa && salvo && !numeroEhAviso && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="kpi-label">Último comunicado na pasta da empresa</div>
          {!pastaSuportada() ? (
            <p className="hint">Para conferir pela pasta do OneDrive, abra o site no Chrome ou no Edge.</p>
          ) : !pasta?.ok ? (
            <div className="actions">
              <button type="button" className="btn" onClick={() => void ligarPasta()}>
                {pasta ? "Liberar a pasta" : "Escolher a pasta “Madeireiras 2”"}
              </button>
              <span className="hint">
                O site lê os PDFs “COMUNICADO 363-2026…” e o Excel da pasta da empresa para seguir do último emitido, e salva o PDF novo direto
                lá. Nada sai do computador.
              </span>
            </div>
          ) : daPasta === "lendo" ? (
            <p className="hint">Lendo a pasta…</p>
          ) : !daPasta ? (
            <p className="hint">
              Não achei a pasta de {empresa.apelido} dentro de “{pasta.p.name}”.{" "}
              <button type="button" className="link" onClick={() => void ligarPasta()}>
                Escolher outra pasta
              </button>
            </p>
          ) : (
            <p className="hint">
              Pasta “{daPasta.pasta}”: {daPasta.numero ? <b>{daPasta.numero}</b> : "nenhum comunicado deste ano"}
              {daPasta.arquivo ? ` (${daPasta.arquivo})` : ""}
              {daPasta.numero && maiorNumero(salvo.ultimoNumero, daPasta.numero) === daPasta.numero && daPasta.numero !== salvo.ultimoNumero
                ? " — mais novo que o do site: a numeração segue a pasta."
                : salvo.ultimoNumero && daPasta.numero !== salvo.ultimoNumero
                  ? ` — o site já está no ${salvo.ultimoNumero} (o PDF dele ainda não foi salvo na pasta?).`
                  : " — confere com o site."}
              <br />O PDF gerado é salvo em “{daPasta.caminhoDestino}”.
            </p>
          )}
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
              Cole aqui o pedido do tratamento (texto do WhatsApp ou Ctrl+V do print)
            </label>
            <textarea
              id="com-texto"
              rows={7}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onPaste={(e) => {
                // Print copiado (WhatsApp): Ctrl+V da imagem lê pelo OCR.
                const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                if (imgs.length) {
                  e.preventDefault();
                  void lerArquivos(imgs);
                }
              }}
              placeholder={"Ex.: Tratamento amanhã às 13:30 para a MRP Comercio\n50 kit caixas 1000x1200x680\n8 paletes 1300x1300"}
              style={{ width: "100%" }}
            />
            <div className="actions" style={{ marginTop: 8 }}>
              <button type="button" className="btn primary" disabled={!texto.trim() || ocupado} onClick={() => identificar()}>
                {ocupado ? "Lendo…" : "Identificar"}
              </button>
              <span className="hint">O que não estiver no texto fica como no último comunicado; confira antes de gerar.</span>
            </div>
          </div>

          <SoltarArquivos
            titulo={ocupado ? "Lendo o arquivo…" : "Ou arraste o arquivo do pedido"}
            dica={
              <>
                <b>Planilha do Excel</b> (.xlsx), <b>Word</b> (.docx), <b>imagem</b> (print do WhatsApp, foto) ou <b>PDF</b>: o texto aparece na caixa
                acima e o site identifica os campos. Imagem é lida por OCR (alguns segundos) — confira os números.
              </>
            }
            accept=".xlsx,.xls,.docx,.doc,.pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,image/*"
            ocupado={ocupado}
            onArquivos={(fs) => void lerArquivos(fs)}
          />

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

          {pedidos.length > 1 && (
            <div className="toolbar" style={{ marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
              {pedidos.map((x, i) => (
                <button key={i} type="button" className={`btn btn-sm${i === sel ? " primary" : ""}`} onClick={() => setSel(i)}>
                  {x.valores.numero || `#${i + 1}`} · {x.valores.data ?? ""} {x.valores.horario ?? ""}
                </button>
              ))}
            </div>
          )}
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="toolbar" style={{ marginBottom: 6 }}>
              <div className="kpi-label" style={{ margin: 0 }}>
                Comunicado {pedidos.length > 1 ? `${sel + 1} de ${pedidos.length}` : ""}
              </div>
              <div className="spacer" />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  const ult = pedidos[pedidos.length - 1];
                  setPedidos((ps) => [...ps, { valores: { ...ult.valores, numero: proximoNumero(ult.valores.numero, new Date().getFullYear()) }, achados: [], avisos: [] }]);
                  setSel(pedidos.length);
                }}
              >
                + Comunicado
              </button>
              {pedidos.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm danger"
                  onClick={() => {
                    setPedidos((ps) => ps.filter((_, i) => i !== sel));
                    setSel((s2) => Math.max(0, s2 - 1));
                  }}
                >
                  Remover este
                </button>
              )}
            </div>
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
                  ) : c === "quantidade" ? (
                    // Um item por linha (como no Excel da Madepallete); Enter quebra a linha.
                    <textarea
                      id={`com-${c}`}
                      rows={Math.max(1, (valores[c] ?? "").split("\n").length)}
                      value={valores[c] ?? ""}
                      onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))}
                      style={{ width: "100%", resize: "vertical" }}
                    />
                  ) : (
                    <input id={`com-${c}`} value={valores[c] ?? ""} onChange={(e) => setValores((v) => ({ ...v, [c]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <div className="actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn primary lg" disabled={ocupado} onClick={() => void gerar()}>
                {ocupado ? "Gerando…" : pedidos.length > 1 ? `Gerar os ${pedidos.length} comunicados (PDF)` : "Gerar comunicado (PDF)"}
              </button>
              {ultimoExcel && (
                <button type="button" className="btn" onClick={() => baixar(ultimoExcel.bytes, ultimoExcel.nome)}>
                  Baixar o Excel do último
                </button>
              )}
              <span className="hint">
                Sai em PDF, com o logo da empresa; vários de uma vez vêm num .zip. A planilha da empresa fica com o último emitido.
              </span>
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
