const PASSOS = ["Enviar os PDFs", "Conferir os dados", "Copiar para o SEI"];

/** Indicador de progresso: `atual` é 1, 2 ou 3; passos anteriores ficam "feitos". */
export function Steps({ atual }: { atual: 1 | 2 | 3 }) {
  return (
    <ol className="steps" aria-label="Etapas">
      {PASSOS.map((nome, i) => {
        const n = i + 1;
        const estado = n < atual ? "done" : n === atual ? "active" : "";
        return (
          <li key={nome} className={`step ${estado}`} aria-current={n === atual ? "step" : undefined}>
            <span className="n">{n < atual ? "✓" : n}</span>
            {nome}
          </li>
        );
      })}
    </ol>
  );
}
