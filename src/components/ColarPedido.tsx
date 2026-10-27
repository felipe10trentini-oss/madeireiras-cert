"use client";

import { useEffect, useState } from "react";

/**
 * Pedido sem arquivo: print colado (Ctrl+V em qualquer lugar da página) ou texto escrito/colado na
 * caixa. Vira o mesmo arquivo que se soltaria na área de arrastar: a imagem como PNG e o texto como .txt.
 */
export function ColarPedido({ texto = true, ocupado = false, onArquivos }: { texto?: boolean; ocupado?: boolean; onArquivos: (files: File[]) => void }) {
  const [escrito, setEscrito] = useState("");
  const hora = () => new Date().toLocaleTimeString("pt-BR").replace(/:/g, "-");

  // Print colado: a imagem da área de transferência (o texto colado fica onde o cursor está).
  useEffect(() => {
    function aoColar(e: ClipboardEvent) {
      if (ocupado) return;
      const imagens = [...(e.clipboardData?.items ?? [])]
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (!imagens.length) return;
      e.preventDefault();
      onArquivos(imagens.map((f, k) => new File([f], `print colado ${hora()}${imagens.length > 1 ? ` (${k + 1})` : ""}.png`, { type: f.type || "image/png" })));
    }
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
  }, [ocupado, onArquivos]);

  function lerTexto() {
    const t = escrito.trim();
    if (!t) return;
    onArquivos([new File([t], `pedido digitado ${hora()}.txt`, { type: "text/plain" })]);
    setEscrito("");
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="field">
        <label htmlFor="colar-pedido">{texto ? "Escreva ou cole aqui o pedido — ou cole um print (Ctrl+V) em qualquer lugar da página" : "Cole um print (Ctrl+V) em qualquer lugar da página"}</label>
        {texto && (
          <textarea
            id="colar-pedido"
            rows={4}
            value={escrito}
            disabled={ocupado}
            placeholder={"ex.: Boa tarde, solicito declaração\nCompanhia Providência\nNFE 7399\n90 - Pallet 1000x1200 Ciclo Mann 0252"}
            onChange={(e) => setEscrito(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && lerTexto()}
          />
        )}
      </div>
      {texto && (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-sm" disabled={ocupado || !escrito.trim()} onClick={lerTexto}>
            Ler pedido
          </button>
          <span className="hint">Ctrl+Enter também lê.</span>
        </div>
      )}
    </div>
  );
}
