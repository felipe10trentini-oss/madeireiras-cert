"use client";
/* eslint-disable @next/next/no-img-element -- imagens em data URL do modelo enviado (nada para otimizar) */

import { useState } from "react";
import { OPCOES_SUJEITO, type Sujeito } from "@/lib/declaracao";
import { aprenderDoTexto, CAMPOS_PADRAO, lerModeloWord, type PadraoDeclaracao } from "@/lib/modeloDeclaracao";
import { cabecalhoSenha } from "@/lib/senhaEquipe";

export interface ModeloSalvo {
  logo: string | null;
  assinatura: string | null;
  rt: string[];
  padrao: PadraoDeclaracao;
  salvo?: boolean;
}

// ---------- imagens (canvas, no navegador) ----------

function carregar(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => falha(new Error("Imagem inválida."));
    im.src = src;
  });
}

/** Redesenha em PNG (o PDF só aceita PNG), girando 90° se pedido. */
async function emPng(src: string, girar = false): Promise<string> {
  const im = await carregar(src);
  const c = document.createElement("canvas");
  c.width = girar ? im.height : im.width;
  c.height = girar ? im.width : im.height;
  const g = c.getContext("2d")!;
  if (girar) {
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
  }
  g.drawImage(im, 0, 0);
  return c.toDataURL("image/png");
}

/** Fundo branco vira transparente e corta as bordas vazias (assinatura escaneada). */
async function semFundo(src: string): Promise<string> {
  const im = await carregar(src);
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const g = c.getContext("2d")!;
  g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d.data[i] > 225 && d.data[i + 1] > 225 && d.data[i + 2] > 225) d.data[i + 3] = 0;
      if (d.data[i + 3] > 20) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  g.putImageData(d, 0, 0);
  if (x1 < 0) return c.toDataURL("image/png");
  const r = document.createElement("canvas");
  r.width = x1 - x0 + 1;
  r.height = y1 - y0 + 1;
  r.getContext("2d")!.drawImage(c, x0, y0, r.width, r.height, 0, 0, r.width, r.height);
  return r.toDataURL("image/png");
}

const lerArquivo = (f: File) =>
  new Promise<string>((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result));
    fr.onerror = () => falha(fr.error);
    fr.readAsDataURL(f);
  });

function Imagem({ titulo, src, onTroca }: { titulo: string; src: string | null; onTroca: (s: string | null) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const fazer = async (fn: () => Promise<string>) => {
    setOcupado(true);
    try {
      onTroca(await fn());
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="card modelo-img">
      <div className="kpi-label">{titulo}</div>
      <div className="modelo-img-caixa">{src ? <img src={src} alt={titulo} /> : <span className="hint">nenhuma</span>}</div>
      <div className="toolbar" style={{ gap: 6, flexWrap: "wrap" }}>
        {src && (
          <>
            <button type="button" className="btn btn-sm" disabled={ocupado} onClick={() => void fazer(() => emPng(src, true))}>
              Girar 90°
            </button>
            <button type="button" className="btn btn-sm" disabled={ocupado} onClick={() => void fazer(() => semFundo(src))}>
              Tirar fundo branco
            </button>
            <button type="button" className="btn btn-sm danger" onClick={() => onTroca(null)}>
              Tirar
            </button>
          </>
        )}
        <label className="btn btn-sm" style={{ cursor: "pointer" }}>
          Enviar imagem
          <input
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void fazer(async () => emPng(await lerArquivo(f)));
            }}
          />
        </label>
      </div>
    </div>
  );
}

/**
 * Edição do modelo da declaração de uma empresa: envia uma declaração que ela já usa (PDF ou
 * Word), o site tira as imagens e os campos fixos, o operador confere e salva.
 */
export function ModeloDeclaracao({
  senha,
  cnpj,
  nome,
  atual,
  onSalvo,
  onFechar,
}: {
  senha: string;
  cnpj: string;
  nome: string;
  atual: ModeloSalvo | null;
  onSalvo: () => void;
  onFechar: () => void;
}) {
  const [logo, setLogo] = useState<string | null>(atual?.logo ?? null);
  const [assinatura, setAssinatura] = useState<string | null>(atual?.assinatura ?? null);
  const [rt, setRt] = useState((atual?.rt ?? []).join("\n"));
  const [padrao, setPadrao] = useState<PadraoDeclaracao>(atual?.padrao ?? {});
  const [imagens, setImagens] = useState<string[]>([]);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function lerModelo(f: File | null) {
    if (!f) return;
    setLendo(true);
    setMsg(null);
    try {
      let texto = "";
      let imgs: string[] = [];
      if (/\.docx$/i.test(f.name)) {
        ({ texto, imagens: imgs } = await lerModeloWord(await f.arrayBuffer()));
      } else if (/\.pdf$/i.test(f.name)) {
        const form = new FormData();
        form.append("arquivo", f);
        const r = await fetch("/api/declaracoes/modelo", { method: "POST", headers: cabecalhoSenha(senha), body: form });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "Não foi possível ler o PDF.");
        texto = j.texto ?? "";
        imgs = j.imagens ?? [];
      } else throw new Error("Envie a declaração em PDF ou Word (.docx). Arquivo .doc antigo: salve como .docx.");
      const aprendido = aprenderDoTexto(texto);
      setPadrao((p) => ({ ...aprendido.padrao, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) }));
      if (aprendido.rt.length && !rt.trim()) setRt(aprendido.rt.join("\n"));
      setImagens(imgs);
      setMsg(
        `Li ${imgs.length} imagem(ns) e ${Object.keys(aprendido.padrao).length} campo(s) de “${f.name}”. Clique em qual imagem é o logo e qual é a assinatura e confira os campos.`
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setLendo(false);
    }
  }

  async function usar(src: string, como: "logo" | "assinatura") {
    const png = await emPng(src);
    if (como === "logo") setLogo(png);
    else setAssinatura(png);
  }

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/declaracoes/ativos", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...cabecalhoSenha(senha) },
        body: JSON.stringify({ cnpj, logo, assinatura, rt: rt.split("\n"), padrao }),
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

  return (
    <div className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--accent)" }}>
      <div className="kpi-label">Modelo da declaração · {nome}</div>
      <p className="hint" style={{ marginTop: 4 }}>
        Envie uma declaração que vocês já fazem para esta empresa (PDF ou Word). O site tira o logo, a assinatura, as linhas do RT e os campos que
        se repetem em toda declaração; você confere e salva. Fica guardado só no banco (pasta privada), não no código.
      </p>
      <div className="actions" style={{ marginTop: 8 }}>
        <label className="btn primary" style={{ cursor: "pointer" }}>
          {lendo ? "Lendo…" : "Enviar declaração (PDF ou Word)"}
          <input type="file" accept=".pdf,.docx" hidden disabled={lendo} onChange={(e) => void lerModelo(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      {msg && <p className="hint">{msg}</p>}

      {imagens.length > 0 && (
        <div className="modelo-galeria">
          {imagens.map((src, i) => (
            <div key={i} className="modelo-miniatura">
              <img src={src} alt={`Imagem ${i + 1} do modelo`} />
              <div className="toolbar" style={{ gap: 4 }}>
                <button type="button" className="btn btn-sm" onClick={() => void usar(src, "logo")}>
                  Logo
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void usar(src, "assinatura")}>
                  Assinatura
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid kpis" style={{ marginTop: 12 }}>
        <Imagem titulo="Logo" src={logo} onTroca={setLogo} />
        <Imagem titulo="Assinatura do RT" src={assinatura} onTroca={setAssinatura} />
        <div className="card">
          <div className="kpi-label">Linhas abaixo da assinatura</div>
          <textarea rows={4} value={rt} onChange={(e) => setRt(e.target.value)} placeholder={"Nome do RT\nResponsável Técnico\nCREA …"} aria-label="Linhas do RT" style={{ width: "100%" }} />
          <div className="kpi-sub">uma por linha (nome, título, CREA)</div>
        </div>
      </div>

      <div className="form-grid tres" style={{ marginTop: 12 }}>
        {CAMPOS_PADRAO.map((c) => (
          <div className={`field${c.k === "localTratamento" ? " full" : ""}`} key={c.k}>
            <label htmlFor={`m-${c.k}`}>{c.rotulo}</label>
            <input id={`m-${c.k}`} value={padrao[c.k] ?? ""} onChange={(e) => setPadrao((p) => ({ ...p, [c.k]: e.target.value }))} />
          </div>
        ))}
        <div className="field">
          <label htmlFor="m-suj">Material tratado</label>
          <select id="m-suj" value={padrao.sujeito ?? "paletes"} onChange={(e) => setPadrao((p) => ({ ...p, sujeito: e.target.value as Sujeito }))}>
            {OPCOES_SUJEITO.map((o) => (
              <option key={o.k} value={o.k}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="hint">Estes campos já vêm preenchidos em toda declaração nova da empresa (dá para mudar em cada uma).</p>

      <div className="toolbar">
        <div className="spacer" />
        <button type="button" className="btn" onClick={onFechar}>
          Fechar
        </button>
        <button type="button" className="btn primary" disabled={salvando} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar modelo"}
        </button>
      </div>
    </div>
  );
}
