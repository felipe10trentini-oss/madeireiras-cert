"use client";

import { useState, type DragEvent } from "react";

interface Props {
  titulo: string;
  dica: string;
  arquivo: File | null;
  onArquivo: (file: File | null) => void;
  accept?: string;
  aceita?: (file: File) => boolean;
}

function tamanho(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function FileDrop({ titulo, dica, arquivo, onArquivo, accept = "application/pdf", aceita }: Props) {
  const [sobre, setSobre] = useState(false);

  function aoSoltar(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setSobre(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (aceita ? aceita(file) : file.type === "application/pdf")) onArquivo(file);
  }

  return (
    <label
      className={`dropzone${sobre ? " over" : ""}${arquivo ? " filled" : ""}`}
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
        onChange={(e) => onArquivo(e.target.files?.[0] ?? null)}
      />
      <svg className="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {arquivo ? (
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M12 17v-6m0 0-2.5 2.5M12 11l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      <span className="dz-title">{titulo}</span>
      {arquivo ? (
        <>
          <span className="dz-file">
            {arquivo.name} · {tamanho(arquivo.size)}
          </span>
          <span className="dz-change">Clique para trocar o arquivo</span>
        </>
      ) : (
        <span className="dz-hint">{dica}</span>
      )}
    </label>
  );
}
