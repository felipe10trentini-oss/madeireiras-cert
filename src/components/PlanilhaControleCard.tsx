"use client";

import { useState } from "react";
import type { Curva } from "@/lib/curvas/tipos";
import { acharLinhaControle, lerPlanilhaControle, produtoDaLinha } from "@/lib/planilhaControle";
import { FileDrop } from "./FileDrop";

interface Props {
  curva: Curva;
  onPreencher: (v: { produto: string; volumes: string; quantidade: string }) => void;
}

/**
 * Curvas SV520 e Mahild não trazem bitola, fardos nem m³: vêm da planilha de
 * controle da secagem do cliente. A planilha é lida aqui no navegador e a linha
 * do tratamento é achada pela estufa + nº da secagem (ou data de início).
 */
export function PlanilhaControleCard({ curva, onPreencher }: Props) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  async function ler(f: File | null) {
    setArquivo(f);
    setStatus(null);
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setStatus({ ok: false, msg: "Envie a planilha em .xlsx (no Excel: Salvar como > Pasta de Trabalho do Excel)." });
      return;
    }
    try {
      const linhas = await lerPlanilhaControle(await f.arrayBuffer());
      if (!linhas.length) {
        setStatus({ ok: false, msg: 'Não achei as colunas de FARDOS e BITOLA/VOLUME nesta planilha.' });
        return;
      }
      const l = acharLinhaControle(linhas, curva);
      if (!l) {
        setStatus({ ok: false, msg: `Não achei este tratamento na planilha (${curva.ciclo ?? "ciclo ?"}, início ${curva.cicloInicio?.data ?? "?"}). Preencha à mão.` });
        return;
      }
      onPreencher(produtoDaLinha(l));
      setStatus({
        ok: true,
        msg: `Preenchido pela linha ${l.linha} da aba "${l.aba}": estufa ${l.estufa ?? "?"}, secagem ${l.secagem ?? "?"}, ${l.data ?? ""} — ${l.fardos ?? "?"} fardos, ${l.bitola ?? "bitola ?"}, ${l.volume ?? "?"} m³.`,
      });
    } catch {
      setStatus({ ok: false, msg: "Não foi possível ler a planilha." });
    }
  }

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="kpi-label">Planilha de controle da secagem (bitola, fardos e m³)</div>
      <p className="hint" style={{ marginTop: 0 }}>
        Esta curva ({curva.sistema}) não traz o produto. Envie a planilha de controle do cliente para preencher
        descrição, volumes e quantidade; sem ela, preencha esses campos à mão em “Editar campos”.
      </p>
      <div className="drops" style={{ gridTemplateColumns: "1fr", marginBottom: 8 }}>
        <FileDrop
          titulo="Planilha de controle (.xlsx)"
          dica="Arraste a planilha do cliente aqui"
          arquivo={arquivo}
          onArquivo={(f) => void ler(f)}
          accept=".xlsx"
          aceita={(f) => /\.xlsx?$/i.test(f.name)}
        />
      </div>
      {status && (
        <p className="hint" style={{ color: status.ok ? "var(--good)" : "var(--bad)", fontSize: 13 }}>
          {status.msg}
        </p>
      )}
    </div>
  );
}
