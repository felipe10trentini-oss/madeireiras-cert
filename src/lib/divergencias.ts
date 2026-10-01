// Trava de divergência entre o comunicado e a curva (a mesma ideia da Mann móvel):
// dia, horário (mais de 2 h do agendado), material e quantidade. Divergência de nível
// "erro" bloqueia a cópia até o usuário marcar que conferiu.
import type { TipoTratamento } from "./certificado";
import type { Comunicado } from "./comunicado";
import type { Curva } from "./curvas/tipos";
import type { ValoresCertificado } from "./modelos";
import { somaDeItens } from "./produtoTexto";
import { semAcento } from "./util";

export interface Divergencia {
  /** "erro" trava a cópia até o usuário confirmar; "atencao" só informa. */
  nivel: "erro" | "atencao";
  campo: string;
  comunicado: string;
  curva: string;
  detalhe: string;
}

/** Tolerância do horário: começar mais de 2 h antes ou depois do agendado é divergência. */
export const TOLERANCIA_HORARIO_MIN = 120;

/** "29/09/2026" + "07h51m" (ou "07:51") -> minutos desde 1970, para comparar dia e hora juntos. */
function instante(data: string | null | undefined, hora: string | null | undefined): number | null {
  const d = (data ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const h = (hora ?? "").match(/(\d{1,2})\s*[h:]\s*(\d{2})/i);
  if (!d || !h) return null;
  return Date.UTC(+d[3], +d[2] - 1, +d[1], +h[1], +h[2]) / 60000;
}

const numeroBR = (s: string) => Number(s.replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", "."));

// Categorias de material: o nome exato varia ("Paletes de madeira", "PALETE PBR", "KIT PALETE PZ-03"),
// então compara o que foi tratado, não o texto.
const CATEGORIAS: [string, RegExp][] = [
  ["paletes", /palet|pallet/],
  ["caixas", /caixa/],
  ["skids/suportes", /skid|suporte/],
  ["tampas", /tampa/],
  ["engradados", /engradado/],
  ["bobinas/carretéis", /bobina|carretel|carreteis/],
  ["madeira serrada", /serrad|tabua|fardo|sarrafo|ripa|viga|caibro|prancha/],
];

function categorias(texto: string): Set<string> {
  const t = semAcento(texto ?? "")
    .toLowerCase()
    .replace(/palete\s*\/\s*tabua/g, " ") // rótulo genérico do SV580
    .replace(/para\s+embalage\w*/g, " "); // "madeira serrada para embalagens" é madeira
  return new Set(CATEGORIAS.filter(([, re]) => re.test(t)).map(([n]) => n));
}

/** Quantidade do comunicado: número único ou soma de itens ("135 paletes, 1.000 ripas"). */
function quantidadeComunicado(c: Comunicado): { valor: number; m3: boolean } | null {
  const q = (c.quantidade ?? "").trim();
  if (!q) return null;
  // "64 fardos - 85,000 m³": vale o número colado ao m³.
  // Vários volumes ("14 m³ de eucalipto e 10 m³ de pinus") somam.
  const m3 = [...q.matchAll(/(\d[\d.]*(?:,\d+)?)\s*m[³3]/gi)];
  if (m3.length) return { valor: m3.reduce((s, m) => s + numeroBR(m[1]), 0), m3: true };
  if (/^\d[\d.]*(?:,\d+)?$/.test(q)) {
    return { valor: numeroBR(q), m3: /m[³3]|metro/i.test(c.volumes ?? "") || /,\d/.test(q) };
  }
  // Itens ("60 Paletes 1000x1200 mm", "40 Kit caixas…"): o número que abre cada item, não as medidas.
  const soma = somaDeItens(q);
  return soma != null ? { valor: soma, m3: false } : null;
}

const fmt = (n: number, m3: boolean) =>
  m3 ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m³` : `${n.toLocaleString("pt-BR")} unidades`;

export function validarComunicado(args: {
  curva: Curva;
  comunicado: Comunicado;
  valores: ValoresCertificado;
  tipo: TipoTratamento;
}): Divergencia[] {
  const { curva, comunicado: c, valores: v } = args;
  const d: Divergencia[] = [];

  // 1) Dia do tratamento
  const diaCom = c.dataInicio?.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] ?? null;
  const diaCurva = v.dataInicio ?? null;
  // Vale o dia do início do ciclo ou o do tratamento que vai no certificado.
  if (diaCom && diaCurva && diaCom !== diaCurva && diaCom !== curva.cicloInicio?.data) {
    d.push({
      nivel: "erro",
      campo: "Dia do tratamento",
      comunicado: diaCom,
      curva: diaCurva,
      detalhe: "O tratamento não foi feito no dia agendado no comunicado.",
    });
  } else if (!diaCom) {
    d.push({
      nivel: "atencao",
      campo: "Dia do tratamento",
      comunicado: "não encontrado",
      curva: diaCurva ?? "—",
      detalhe: "Não consegui ler a data no comunicado para comparar.",
    });
  }

  // 2) Horário: mais de 2 h de diferença do agendado (no mesmo dia ou não)
  const tCom = instante(diaCom, c.horarioInicio);
  // Início na curva: o do ciclo (quando o equipamento começou) ou o do tratamento HT — vale o mais próximo.
  const inicios = [
    curva.cicloInicio ? instante(curva.cicloInicio.data, curva.cicloInicio.hora) : null,
    instante(diaCurva, v.horaInicio),
  ].filter((x): x is number => x != null);
  const tCurva = tCom == null || !inicios.length ? null : inicios.sort((a, b) => Math.abs(a - tCom) - Math.abs(b - tCom))[0];
  if (tCom != null && tCurva != null) {
    const dif = tCurva - tCom;
    if (Math.abs(dif) > TOLERANCIA_HORARIO_MIN) {
      const h = Math.floor(Math.abs(dif) / 60);
      const m = Math.abs(dif) % 60;
      d.push({
        nivel: "erro",
        campo: "Horário do início",
        comunicado: `${diaCom} ${c.horarioInicio}`,
        curva: `${diaCurva} ${v.horaInicio}${curva.cicloInicio ? ` (ciclo: ${curva.cicloInicio.data} ${curva.cicloInicio.hora})` : ""}`,
        detalhe: `O tratamento começou ${h}h${String(m).padStart(2, "0")} ${dif > 0 ? "depois" : "antes"} do horário agendado (limite: 2 horas).`,
      });
    }
  }

  // 3) Material tratado
  // " - Pallet do Brasil Ind…", " - MRP": depois do traço vem o cliente, não o material.
  const textoCurva = [curva.descricao, ...curva.produtos.map((p) => p.descricao), curva.textoProduto]
    .filter(Boolean)
    .join("\n")
    .replace(/\s-\s.*?(?=\s\S+\s+com\s+[\d.,]+|\n|$)/g, " ");
  const catCom = categorias(`${c.produto ?? ""} ${c.quantidade ?? ""}`);
  let catCurva = categorias(textoCurva);
  if (!catCurva.size && curva.produtos.some((p) => p.m3 != null)) catCurva = new Set(["madeira serrada"]);
  if (catCom.size && catCurva.size) {
    const soCom = [...catCom].filter((x) => !catCurva.has(x));
    const soCurva = [...catCurva].filter((x) => !catCom.has(x));
    if (soCom.length || soCurva.length) {
      d.push({
        nivel: "erro",
        campo: "Material tratado",
        comunicado: c.produto ?? "",
        curva: textoCurva.slice(0, 160),
        detalhe: `O material é diferente — só no comunicado: ${soCom.join(", ") || "nada"}; só na curva: ${soCurva.join(", ") || "nada"}.`,
      });
    }
  }

  // 4) Quantidade tratada
  const qCom = quantidadeComunicado(c);
  if (qCom) {
    const unidadesCurva = curva.produtos.filter((p) => p.m3 == null).reduce((s, p) => s + p.quantidade, 0);
    const m3Curva = curva.totalM3 ?? (curva.produtos.some((p) => p.m3 != null) ? curva.produtos.reduce((s, p) => s + (p.m3 ?? 0), 0) : null);
    if (qCom.m3 && m3Curva != null && Math.abs(qCom.valor - m3Curva) > 0.01) {
      d.push({
        nivel: "erro",
        campo: "Quantidade tratada",
        comunicado: fmt(qCom.valor, true),
        curva: fmt(m3Curva, true),
        detalhe: "O volume do comunicado não bate com o da curva.",
      });
    } else if (!qCom.m3) {
      // Contagem (paletes, kits…): curva com contagem, ou com tabela de peças (SV580).
      const pecasCurva = unidadesCurva || curva.produtos.reduce((s, p) => s + p.quantidade, 0);
      if (pecasCurva && pecasCurva !== qCom.valor) {
        d.push({
          nivel: "erro",
          campo: "Quantidade tratada",
          comunicado: fmt(qCom.valor, false),
          curva: fmt(pecasCurva, false),
          detalhe: "A quantidade do comunicado não bate com a da curva.",
        });
      }
    }
  }

  return d.sort((a, b) => Number(b.nivel === "erro") - Number(a.nivel === "erro"));
}
