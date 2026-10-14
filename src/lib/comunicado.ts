export interface Comunicado {
  numero: string | null; // "099/2026"
  tomadorNome: string | null;
  tomadorCnpj: string | null;
  endereco: string | null;
  destino: string | null;
  produto: string | null; // "Paletes de madeira"
  volumes: string | null; // "Unidades"
  quantidade: string | null; // "720"
  modalidade: string | null;
  dataInicio: string | null;
  horarioInicio: string | null;
  duracao: string | null;
  temperatura: string | null;
  /** "Unidade 2" (comunicados da Mann móvel): define a placa do veículo no relatório. */
  unidadeVolante: string | null;
}

// Os comunicados das madeireiras variam maiúsculas/minúsculas e espaços
// ("Comunicado De Tratamento N°:", "Razão Social / CNPJ (Tomador De Serviço):").
const ROTULOS: { campo: keyof Comunicado | "razaoCnpj" | "marcas" | "observacao"; re: RegExp }[] = [
  // "Comunicado de tratamento n°:" ou "N° do comunicado de tratamento:" (DM)
  { campo: "numero", re: /^(?:comunicado de tratamento n\s*[°º]?|n\s*[°º]?\s*do comunicado de tratamento)\s*:/i },
  { campo: "razaoCnpj", re: /^raz[ãa]o social\s*\/\s*cnpj\s*\(tomador de servi[çc]o\)\s*:/i },
  { campo: "endereco", re: /^endere[çc]o (?:do local )?de realiza[çc][ãa]o do tratamento\s*:/i },
  // Rótulos que existem no comunicado mas não vão para o certificado: sem eles, o valor do campo
  // anterior engole a linha ("Rua X, 4226 - Cambé - PR Unidade volante: Unidade 3").
  { campo: "unidadeVolante", re: /^unidade volante\s*:/i },
  { campo: "destino", re: /^destino\s*:/i },
  { campo: "produto", re: /^produto a ser tratado\s*:/i },
  { campo: "volumes", re: /^n\s*[°º]?\s*e descri[çc][ãa]o dos volumes\s*:/i },
  { campo: "quantidade", re: /^quantidade\s*:/i },
  { campo: "marcas", re: /^marcas distintivas\s*:/i },
  { campo: "modalidade", re: /^modalidade de tratamento\s*:/i },
  { campo: "dataInicio", re: /^data do in[íi]cio do tratamento\s*:/i },
  { campo: "horarioInicio", re: /^hor[áa]rio do in[íi]cio do tratamento\s*:/i },
  { campo: "duracao", re: /^dura[çc][ãa]o do tratamento\s*:/i },
  { campo: "temperatura", re: /^temperatura\s*:/i },
  { campo: "observacao", re: /^observa[çc][ãa]o\s*:/i },
];

/** Rodapé com os dados da própria empresa: encerra o último campo. */
const FIM = /^(COMUNICADO DE TRATAMENTO|CNPJ:|CEP:|--\s*\d+ of)/i;

/** "PALETES DE MADEIRA" -> "Paletes de madeira". */
const frase = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Aviso da CJ Tedeski (planilha exportada em PDF), em tabela:
 *   103/2026
 *   Tomador de serviço: Elopack Ind. e Com. ... Ltda - CNPJ: 16.774.577/0002-71
 *   Local de Tratamento: Eucatex - Rua Ribeirão Preto 811 - Salto - SP
 *   Nº LOCAL  INTERESSADO  MERCADORIA A SER TRATADA  UNIDADE DE TRATAMENTO  IDENTIFICAÇÃO QUANTIDADE DATA HORA TEMPO DE EXPOSIÇÃO TEMPERATURA
 *   1 SALTO ELOPACK FILIAL \tPALETES DE MADEIRA \tCAMERA FIXA SALTO \tBR-SP1024 \t200 \t13/10/2026 7:30 32 min \t56°C
 * Mais de uma linha na tabela: as mercadorias e quantidades vão juntas ("200 paletes e 50 tampas").
 */
function lerAvisoEmTabela(texto: string): Comunicado | null {
  const tomador = texto.match(/Tomador de servi[çc]o:\s*(.+?)\s*[-–]\s*CNPJ:?\s*(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\s*\d{2})/i);
  const local = texto.match(/Local de Tratamento:\s*(.+)/i);
  if (!tomador || !local) return null;
  // Linhas da tabela: as células vêm separadas por tab, mas o nº de tabs antes da mercadoria varia
  // (Salto "1 SALTO ELOPACK FILIAL \tPALETES…", Botucatu "1 BOTUCATU \tEUCATEX \tRIPAS…"): a referência é a
  // identificação (BR-SP1024) — mercadoria 2 células antes, unidade 1 antes; depois dela, quantidade, data,
  // hora, tempo e temperatura.
  const linhas: { mercadoria: string; unidade: string; qtd: string; data: string; h: string; m: string; min: string; temp: string }[] = [];
  for (const bruta of texto.split("\n")) {
    if (!/^\s*\d+\s/.test(bruta)) continue;
    const celulas = bruta.split("\t").map((c) => c.trim());
    const i = celulas.findIndex((c) => /^BR-?\s*[A-Z]{2}-?\s*\d+$/i.test(c));
    if (i < 2) continue;
    const resto = celulas.slice(i + 1).join(" ");
    const r = resto.match(/^(\d[\d.,]*)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}):(\d{2})\s+(\d+)\s*min\s+([\d,.]+)\s*°?\s*C/i);
    if (!r) continue;
    linhas.push({ mercadoria: celulas[i - 2], unidade: celulas[i - 1], qtd: r[1], data: r[2], h: r[3], m: r[4], min: r[5], temp: r[6] });
  }
  const itens = linhas.map((l) => ({ produto: frase(l.mercadoria), qtd: l.qtd }));
  const um = itens.length === 1;
  const primeira = linhas[0];
  return {
    numero: texto.match(/^\s*(\d{1,4}\/\d{4}(?:-[A-Z]+)?)\s*$/m)?.[1] ?? null,
    tomadorNome: tomador[1].trim(),
    tomadorCnpj: tomador[2].replace(/\s+/g, ""),
    endereco: local[1].trim(),
    destino: null,
    produto: itens.length ? [...new Set(itens.map((i) => i.produto))].join(" e ") : null,
    volumes: null,
    // Uma mercadoria: só o número (vira "200 paletes"); várias: "200 Paletes de madeira e 50 Tampas de madeira".
    quantidade: !itens.length ? null : um ? itens[0].qtd : itens.map((i) => `${i.qtd} ${i.produto}`).join(" e "),
    modalidade: null,
    dataInicio: primeira?.data ?? null,
    horarioInicio: primeira ? `${primeira.h.padStart(2, "0")}h${primeira.m}m` : null,
    duracao: primeira ? `${primeira.min} min` : null,
    temperatura: primeira ? `${primeira.temp}°C` : null,
    unidadeVolante: primeira ? frase(primeira.unidade) : null,
  };
}

export function lerComunicado(texto: string): Comunicado {
  // Aviso em tabela (CJ Tedeski): formato próprio, sem os rótulos "Comunicado de tratamento nº:".
  if (!/comunicado de tratamento n\s*[°º]?\s*:/i.test(texto)) {
    const aviso = lerAvisoEmTabela(texto);
    if (aviso) return aviso;
  }
  const valores: Record<string, string> = {};
  let atual: string | null = null;
  for (const bruta of texto.split("\n")) {
    const linha = bruta.trim();
    if (!linha) continue;
    const rot = ROTULOS.find((r) => r.re.test(linha));
    if (rot) {
      atual = rot.campo;
      valores[atual] = linha.replace(rot.re, "").trim();
    } else if (FIM.test(linha)) {
      atual = null;
    } else if (atual && atual !== "temperatura" && atual !== "duracao" && atual !== "observacao") {
      valores[atual] = `${valores[atual]} ${linha}`.trim();
    }
  }

  const rc = valores.razaoCnpj ?? "";
  const m = rc.match(/^(.*?)[;\-–,]?\s*CNPJ:?\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\s*\d{2})/i);
  return {
    numero: valores.numero || null,
    tomadorNome: m ? m[1].replace(/[\s;\-–,]+$/, "").trim() : rc || null,
    tomadorCnpj: m ? m[2].replace(/\s+/g, "") : null,
    endereco: valores.endereco || null,
    destino: valores.destino || null,
    produto: valores.produto || null,
    volumes: valores.volumes || null,
    quantidade: valores.quantidade || null,
    modalidade: valores.modalidade || null,
    dataInicio: valores.dataInicio || null,
    horarioInicio: valores.horarioInicio || null,
    duracao: valores.duracao || null,
    temperatura: valores.temperatura || null,
    unidadeVolante: valores.unidadeVolante || null,
  };
}
