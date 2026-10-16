"use client";

import { useState, type DragEvent, type ReactNode } from "react";

/** Área de arrastar e soltar (ou clicar) para vários arquivos de uma vez. */
export function SoltarArquivos({
  titulo,
  dica,
  accept,
  multiplos = true,
  ocupado = false,
  onArquivos,
  children,
}: {
  titulo: string;
  dica: ReactNode;
  accept: string;
  multiplos?: boolean;
  ocupado?: boolean;
  onArquivos: (files: File[]) => void;
  children?: ReactNode;
}) {
  const [sobre, setSobre] = useState(false);
  const aceitos = accept.split(",").map((s) => s.trim().toLowerCase());
  const aceita = (f: File) => aceitos.some((a) => (a.startsWith(".") ? f.name.toLowerCase().endsWith(a) : f.type === a));

  function aoSoltar(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setSobre(false);
    const fs = [...(e.dataTransfer.files ?? [])].filter(aceita);
    if (fs.length) onArquivos(multiplos ? fs : fs.slice(0, 1));
  }

  return (
    <label
      className={`dropzone${sobre ? " over" : ""}`}
      style={{ marginBottom: 12, opacity: ocupado ? 0.6 : 1 }}
      onDragOver={(e) => {
        e.preventDefault();
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={aoSoltar}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiplos}
        disabled={ocupado}
        onChange={(e) => {
          const fs = [...(e.target.files ?? [])];
          e.target.value = "";
          if (fs.length) onArquivos(fs);
        }}
      />
      <svg className="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M12 17v-6m0 0-2.5 2.5M12 11l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="dz-title">{titulo}</span>
      <span className="dz-hint">{dica}</span>
      {children}
    </label>
  );
}
