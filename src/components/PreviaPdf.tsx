"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mostra um PDF na tela desenhando as páginas com o pdf.js. Não usa o leitor de PDF do
 * navegador: no Chrome com "baixar PDFs em vez de abrir" o <iframe> só mostrava o botão "Abrir".
 */
export function PreviaPdf({ bytes }: { bytes: Uint8Array | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !bytes) return;
    let vivo = true;
    let cancelar: (() => void) | undefined;
    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      // O pdf.js transfere o buffer para o worker: passa uma cópia.
      const tarefa = pdfjs.getDocument({ data: bytes.slice() });
      cancelar = () => void tarefa.destroy();
      const doc = await tarefa.promise;
      const largura = el.clientWidth || 800;
      const dpr = window.devicePixelRatio || 1;
      const telas: HTMLCanvasElement[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const pagina = await doc.getPage(n);
        if (!vivo) return;
        const escala = largura / pagina.getViewport({ scale: 1 }).width;
        const vp = pagina.getViewport({ scale: escala * dpr });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        canvas.style.width = "100%";
        canvas.style.display = "block";
        canvas.style.background = "#fff";
        canvas.style.border = "1px solid var(--border)";
        canvas.style.borderRadius = "8px";
        canvas.style.marginBottom = "12px";
        await pagina.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
        telas.push(canvas);
      }
      if (!vivo) return;
      el.replaceChildren(...telas);
      setErro(false);
    })().catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
      cancelar?.();
    };
  }, [bytes]);

  return (
    <div>
      {erro && <p className="hint">Não foi possível mostrar a prévia; baixe o PDF para conferir.</p>}
      <div ref={ref} />
    </div>
  );
}
