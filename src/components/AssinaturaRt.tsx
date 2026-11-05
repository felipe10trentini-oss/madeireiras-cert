"use client";

import { useState } from "react";
import type { AssinaturaRt } from "@/lib/declaracaoLgPdf";
import { cabecalhoSenha } from "@/lib/senhaEquipe";

/** Imagem da assinatura -> PNG recortado no rabisco, com o fundo branco transparente. */
async function paraPng(arquivo: File): Promise<Uint8Array> {
  const bmp = await createImageBitmap(arquivo);
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const cx = cv.getContext("2d")!;
  cx.drawImage(bmp, 0, 0);
  const img = cx.getImageData(0, 0, cv.width, cv.height);
  const px = img.data;
  let [x0, y0, x1, y1] = [cv.width, cv.height, -1, -1];
  for (let y = 0; y < cv.height; y++)
    for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      if (px[i + 3] < 30 || (px[i] + px[i + 1] + px[i + 2]) / 3 > 235) {
        px[i + 3] = 0;
        continue;
      }
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) throw new Error("A imagem está em branco.");
  cx.putImageData(img, 0, 0);
  const m = 4;
  [x0, y0] = [Math.max(0, x0 - m), Math.max(0, y0 - m)];
  [x1, y1] = [Math.min(cv.width - 1, x1 + m), Math.min(cv.height - 1, y1 + m)];
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, "image/png"));
  if (!blob) throw new Error("Não foi possível ler a imagem.");
  return new Uint8Array(await blob.arrayBuffer());
}

function paraBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Assinatura do RT da empresa nas declarações em PDF (quando o Word modelo não traz assinatura).
 * Guardada uma vez por RT: vale para todas as empresas dele.
 */
export function AssinaturaRtBarra({
  senha,
  rt,
  atual,
  usadaNoPdf,
  onSalva,
  onToast,
}: {
  senha: string;
  rt: string;
  atual: AssinaturaRt | null;
  usadaNoPdf: boolean;
  onSalva: () => void;
  onToast: (m: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [nome, setNome] = useState(atual?.nome ?? rt);
  const [crea, setCrea] = useState(atual?.crea ?? "");
  const [salvando, setSalvando] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  async function escolher(f: File | undefined) {
    if (!f) return;
    try {
      const b = await paraPng(f);
      setPng(b);
      setUrl(URL.createObjectURL(new Blob([b as BlobPart], { type: "image/png" })));
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Não foi possível ler a imagem.");
    }
  }

  async function salvar() {
    setSalvando(true);
    try {
      const r = await fetch("/api/declaracoes/assinatura", {
        method: "PUT",
        headers: { ...cabecalhoSenha(senha), "Content-Type": "application/json" },
        body: JSON.stringify({ rt, nome, crea, ...(png ? { imagem: paraBase64(png) } : {}) }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error ?? "Não foi possível salvar a assinatura.");
      setEditando(false);
      setPng(null);
      onSalva();
      onToast(`Assinatura de ${nome} salva: vale para as declarações de todas as empresas dele(a).`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Não foi possível salvar a assinatura.");
    } finally {
      setSalvando(false);
    }
  }

  if (!editando)
    return (
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <span className="hint">
          Assinatura do RT ({atual?.nome ?? rt}):{" "}
          {atual ? `${atual.crea || "sem CREA"}${usadaNoPdf ? "" : " · o Word modelo já tem assinatura, ela é a que vale"}` : "não carregada"}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setNome(atual?.nome ?? rt);
            setCrea(atual?.crea ?? "");
            setEditando(true);
          }}
        >
          {atual ? "Trocar assinatura" : "Carregar assinatura"}
        </button>
      </div>
    );

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="kpi-label">Assinatura do RT nas declarações em PDF</div>
      <p className="hint" style={{ margin: "6px 0 10px" }}>
        Imagem só do rabisco (PNG ou JPG; o fundo branco some). O nome e o CREA saem como texto embaixo da linha. Vale para todas as
        empresas com este RT cujo Word modelo não traz assinatura.
      </p>
      <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <input type="file" accept="image/png,image/jpeg" onChange={(e) => void escolher(e.target.files?.[0])} aria-label="Imagem da assinatura" />
        {url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="Prévia da assinatura" style={{ maxHeight: 80, maxWidth: 200, border: "1px dashed #ccc", padding: 4 }} />
        )}
        <label>
          Nome embaixo da linha
          <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label>
          CREA
          <input type="text" value={crea} placeholder="CREA-SC S1 115821-8" onChange={(e) => setCrea(e.target.value)} />
        </label>
      </div>
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={salvando || (!png && !atual)} onClick={() => void salvar()}>
          {salvando ? "Salvando…" : "Salvar assinatura"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setEditando(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
