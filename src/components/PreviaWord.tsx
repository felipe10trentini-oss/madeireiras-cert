"use client";

import { useEffect, useRef, useState } from "react";

/** Mostra um .docx na tela (docx-preview). Prévia aproximada: o Word baixado é o fiel. */
export function PreviaWord({ bytes }: { bytes: Uint8Array | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !bytes) return;
    let vivo = true;
    void import("docx-preview")
      .then(({ renderAsync }) => {
        if (!vivo) return;
        el.innerHTML = "";
        return renderAsync(new Blob([bytes as BlobPart]), el, undefined, { inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, experimental: true });
      })
      .then(() => vivo && setErro(false))
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [bytes]);

  return (
    <div className="paper-wrap previa-word">
      {erro && <p className="hint">Não foi possível mostrar a prévia; baixe o Word para conferir.</p>}
      <div ref={ref} />
    </div>
  );
}
