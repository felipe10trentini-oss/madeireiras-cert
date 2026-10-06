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

/** Remove a composição do kit: "(composto por 20 bases, 20 tampas e 80 laterais)". */
const semComposicao = (s: string | null | undefined) => (s ?? "").replace(/\([^)]*\)/g, " ");

const singular = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

/** "135 paletes, 1.000 ripas de fechamento e 20 kits caixas" -> itens com quantidade (chave sem plural). */
export function extrairItens(texto: string): Map<string, { qtd: number; rotulo: string }> {
  const t = semAcento(semComposicao(texto))
    .toLowerCase()
    .replace(/\*+/g, " ")
    .replace(/pallet/g, "palete")
    .replace(/\s+/g, " ")
    .trim();
  const itens = new Map<string, { qtd: number; rotulo: string }>();
  for (const m of t.matchAll(/(\d[\d.]*(?:,\d+)?)\s+([a-z][a-z ]*?)(?=\s*(?:,|;|\se\s+\d|$))/g)) {
    const chave = m[2].split(" ").filter(Boolean).map(singular).join(" ");
    const atual = itens.get(chave);
    itens.set(chave, { qtd: (atual?.qtd ?? 0) + numeroBR(m[1]), rotulo: atual?.rotulo ?? m[2].trim() });
  }
  return itens;
}

const diaParaMs = (d: string | null | undefined) => {
  const m = (d ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
};

export function validarComunicado(args: {
  curva: Curva;
  comunicado: Comunicado;
  valores: ValoresCertificado;
  tipo: TipoTratamento;
  /** Prestadora de serviço (Mann móvel, Exata): liga as conferências extras abaixo. */
  prestadora?: boolean;
  nomeArquivo?: string;
  /** Data de criação do PDF do comunicado (dd/mm/aaaa). */
  dataComunicado?: string | null;
}): Divergencia[] {
  const { curva, comunicado: c, valores: v, prestadora, nomeArquivo, dataComunicado } = args;
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
  // A composição do kit ("(composto por … tampas)") só aparece no comunicado: não conta como material.
  const catCom = categorias(`${c.produto ?? ""} ${semComposicao(c.quantidade)}`);
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

  // 5) Item a item: "60 kits embalagens" no comunicado e "50" na descrição digitada na curva.
  const itensCom = extrairItens(c.quantidade ?? "");
  const textoDigitado = curva.descricao ?? curva.descricaoPrograma ?? "";
  const itensCurva = extrairItens(textoDigitado);
  if (itensCom.size && itensCurva.size) {
    const dif: string[] = [];
    for (const chave of new Set([...itensCom.keys(), ...itensCurva.keys()])) {
      const a = itensCom.get(chave);
      const b = itensCurva.get(chave);
      if (a && !b) dif.push(`“${a.rotulo}” só aparece no comunicado (${a.qtd})`);
      else if (!a && b) dif.push(`“${b.rotulo}” só aparece na curva (${b.qtd})`);
      else if (a && b && a.qtd !== b.qtd) dif.push(`“${a.rotulo}”: comunicado ${a.qtd}, curva ${b.qtd}`);
    }
    if (dif.length) {
      d.push({
        nivel: "erro",
        campo: "Itens do material",
        comunicado: c.quantidade ?? "",
        curva: textoDigitado.replace(/\s+/g, " ").slice(0, 160),
        detalhe: `Itens diferentes — ${dif.join("; ")}.`,
      });
    }
  }

  // 6) Prestadora (Mann móvel): temperatura, duração e arquivo da curva conferidos com o comunicado.
  if (prestadora) {
    const tempCom = parseInt(c.temperatura ?? "", 10);
    if (!Number.isNaN(tempCom) && curva.temperatura != null && tempCom !== curva.temperatura) {
      d.push({
        nivel: "erro",
        campo: "Temperatura do tratamento",
        comunicado: `${tempCom} °C`,
        curva: `${curva.temperatura} °C`,
        detalhe: "A temperatura do comunicado é diferente da programada no equipamento.",
      });
    }
    const durCom = parseInt(c.duracao ?? "", 10);
    if (!Number.isNaN(durCom) && curva.htDuracaoMin != null && durCom !== curva.htDuracaoMin) {
      d.push({
        nivel: "erro",
        campo: "Duração do tratamento",
        comunicado: `${durCom} min`,
        curva: `${curva.htDuracaoMin} min`,
        detalhe: "A duração do comunicado é diferente da programada no equipamento.",
      });
    }
    // "1489 MANN 929.pdf": o lote no nome do arquivo precisa ser o lido dentro da curva (arquivo trocado).
    const loteArquivo = nomeArquivo?.match(/^\d+\s+\S+\s+(\d+)(?:\D|$)/)?.[1];
    const loteCurva = curva.ciclo?.match(/^\d+$/) ? curva.ciclo : null;
    if (loteArquivo && loteCurva && parseInt(loteArquivo, 10) !== parseInt(loteCurva, 10)) {
      d.push({
        nivel: "erro",
        campo: "Lote da curva",
        comunicado: `nome do arquivo: ${parseInt(loteArquivo, 10)}`,
        curva: `lido no PDF: ${parseInt(loteCurva, 10)}`,
        detalhe: "O lote no nome do arquivo não é o que consta dentro da curva — confira se enviou o arquivo certo.",
      });
    }
  }

  // 7) Avisos (não travam): curva sem "(concluído)" e comunicado gerado depois do dia do tratamento.
  if (curva.sistema.startsWith("CRG08") && curva.concluido === false) {
    d.push({
      nivel: "atencao",
      campo: "Tratamento concluído",
      comunicado: "—",
      curva: "sem “(concluído)”",
      detalhe: "A curva não indica que o tratamento foi concluído.",
    });
  }
  const criado = diaParaMs(dataComunicado);
  const dia = diaParaMs(v.dataInicio);
  if (prestadora && criado != null && dia != null && criado > dia) {
    d.push({
      nivel: "atencao",
      campo: "Data do comunicado",
      comunicado: `PDF criado em ${dataComunicado}`,
      curva: `tratamento em ${v.dataInicio}`,
      detalhe: "O PDF do comunicado foi gerado depois do dia do tratamento.",
    });
  }

  return d.sort((a, b) => Number(b.nivel === "erro") - Number(a.nivel === "erro"));
}
