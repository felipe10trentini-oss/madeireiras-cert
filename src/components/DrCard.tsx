"use client";

import type { TipoTratamento } from "@/lib/certificado";
import type { Curva } from "@/lib/curvas/tipos";
import type { MadeireiraSalva } from "@/lib/madeireirasDb";
import type { ValoresCertificado } from "@/lib/modelos";
import { horaFmt } from "@/lib/util";

interface Props {
  empresa: MadeireiraSalva;
  valores: ValoresCertificado;
  tipo: TipoTratamento;
  curva: Curva | null;
  onToast: (msg: string) => void;
}

interface Bloco {
  titulo: string;
  onde: string;
  celulas: [string, string][];
}

/**
 * DR (Demonstrativo de Rastreabilidade): o resto da linha vem do relatório por fórmula; aqui
 * vai só o que se digita — a data e o horário do fim (o mesmo do certificado). Pinustan tem
 * duas abas: DADOS KD (fim da secagem) e DADOS HT (início e fim da janela HT, "#" no SV580).
 */
export function DrCard({ empresa, valores, tipo, curva, onToast }: Props) {
  const dr = empresa.estilo?.dr;
  const temDR = empresa.config?.temDR ?? !!dr;
  if (!temDR) return null;

  const aba = (nome: RegExp) => dr?.abas.find((a) => nome.test(a.aba));
  const kdHt = empresa.config?.drKdHt ?? (!!aba(/KD/i) && !!aba(/HT/i));
  const blocos: Bloco[] = [];
  if (kdHt) {
    if (tipo === "KD") {
      blocos.push({
        titulo: "Fim da secagem (KD)",
        onde: `aba ${aba(/KD/i)?.aba ?? "DADOS KD"}, coluna ${aba(/KD/i)?.colunaFim ?? "F"}`,
        celulas: [["Data", valores.dataFim ?? ""], ["Horário", valores.horaFim ?? ""]],
      });
    }
    // Janela HT: a do certificado quando ele é HT/AQF; na secagem KD, a marcada com # na curva.
    const ini = tipo === "KD" ? curva?.htInicio : valores.dataInicio ? { data: valores.dataInicio, hora: valores.horaInicio ?? "" } : null;
    const fim = tipo === "KD" ? curva?.htFim : valores.dataFim ? { data: valores.dataFim, hora: valores.horaFim ?? "" } : null;
    const h = (x: { hora: string } | null | undefined) => (x?.hora ? (x.hora.includes(":") ? horaFmt(x.hora) : x.hora) : "");
    blocos.push({
      titulo: "Tratamento HT (início e fim)",
      onde: `aba ${aba(/HT/i)?.aba ?? "DADOS HT"}, coluna ${aba(/HT/i)?.colunaInicio ?? "D"}`,
      celulas: [["Data início", ini?.data ?? ""], ["Horário início", h(ini)], ["Data fim", fim?.data ?? ""], ["Horário fim", h(fim)]],
    });
  } else {
    const a = dr?.abas[0];
    blocos.push({
      titulo: "Fim do tratamento",
      onde: `aba ${a?.aba ?? "DADOS"}, coluna ${a?.colunaFim ?? "F"}`,
      celulas: [["Data", valores.dataFim ?? ""], ["Horário", valores.horaFim ?? ""]],
    });
  }

  async function copiar(b: Bloco) {
    if (b.celulas.some(([, v]) => !v)) {
      onToast("Falta data ou horário: confira o certificado antes de copiar para a DR.");
      return;
    }
    try {
      await navigator.clipboard.writeText(b.celulas.map(([, v]) => v).join("\t"));
      onToast(`Copiado! Cole na DR: ${b.onde}, na linha do certificado ${valores.numero}.`);
    } catch {
      onToast("Não foi possível copiar. Permita o acesso à área de transferência e tente de novo.");
    }
  }

  return (
    <section style={{ marginTop: 22 }}>
      <div className="section-title">
        <h2>DR — Demonstrativo de Rastreabilidade</h2>
        <p>{dr?.arquivo ?? "Planilha DR da empresa"} · o resto da linha vem do relatório por fórmula</p>
      </div>
      <div className="grid kpis">
        {blocos.map((b) => (
          <div className="card" key={b.titulo}>
            <div className="kpi-label">{b.titulo}</div>
            <div className="mono" style={{ fontSize: 15, margin: "4px 0 6px" }}>
              {b.celulas.map(([rot, v]) => (
                <div key={rot}>
                  <span className="kpi-sub">{rot}: </span>
                  {v || "—"}
                </div>
              ))}
            </div>
            <div className="kpi-sub" style={{ marginBottom: 8 }}>Colar em: {b.onde}</div>
            <button type="button" className="btn primary" onClick={() => copiar(b)}>
              Copiar para DR
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
