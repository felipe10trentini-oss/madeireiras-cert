// Leitura do certificado mestre já emitido (PDF do SEI) — base do certificado desdobrado — e do
// PDF do Demonstrativo de Rastreabilidade (DR) — base do consolidado. Os rótulos variam de
// numeração entre os modelos (cadastrada 2.x, credenciada 3.x), então a busca é pelo texto.

export interface CertificadoMestre {
  numero: string | null; // "089/2026"
  processo: string | null; // processo SEI do mestre (rodapé): "21034.033948/2026-71"
  razao: string | null;
  cnpj: string | null;
  crea: string | null;
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  regMapa: string | null;
  comunicado: string | null;
  enderecoTrat: string | null;
  destino: string | null;
  produto: string | null;
  volumes: string | null;
  quantidade: string | null;
  lote: string | null;
  ciclo: string | null;
  modalidade: string | null; // texto do certificado: "...: ar quente forçado: AQF - HT"
  dataInicio: string | null;
  horaInicio: string | null;
  dataFim: string | null;
  horaFim: string | null;
  temperatura: string | null; // "56°C / Duração: 32 min"
  local: string | null;
}

/** Texto do PDF numa linha só, sem as quebras do layout (que cortam rótulos ao meio). */
function achatar(texto: string): string {
  return texto
    .replace(/-- \d+ of \d+ --/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Onde o valor de um campo termina: no próximo rótulo numerado ("3.7. Número"), na seção seguinte
// ("4. Local de emissão") ou no rodapé do SEI.
const FIM = /\s(?:\d{1,2}\.\d{1,2}\.?\s+[A-ZÁÉÍÓÚÂÊÔÇ]|\d\.\s+(?:Local|Dados)|Certificado TFQ|-\s*DECLARO|Obs:)/;

function campo(t: string, rotulo: RegExp, desde = 0): string | null {
  const m = rotulo.exec(t.slice(desde));
  if (!m) return null;
  const ini = desde + m.index + m[0].length;
  const resto = t.slice(ini);
  const f = FIM.exec(resto);
  const v = (f ? resto.slice(0, f.index) : resto.slice(0, 300)).trim();
  return v || null;
}

export function lerCertificadoMestre(texto: string): CertificadoMestre | null {
  const t = achatar(texto);
  // "089/2026" ou, na Pinustan, o próprio lote ("11-298").
  const numero = t.match(/Quarenten[áa]rios:\s*(\d[\w./-]*)/i)?.[1] ?? null;
  if (!numero && !/Certificado de Tratamento Fitossanit/i.test(t)) return null;
  // Seção do tomador e do tratamento começam depois dos dados da empresa.
  const iTrat = Math.max(0, t.search(/Dados do Tratamento Fitossanit/i));
  // O PDF às vezes corta o ano ("02/09/202"): completa com o ano do número ou de outra data.
  const ano = t.match(/\d{1,2}\/\d{1,2}\/(\d{4})/)?.[1] ?? numero?.match(/\/(\d{4})/)?.[1] ?? null;
  const datas = (rotulo: RegExp) => {
    const m = campo(t, rotulo, iTrat)?.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return null;
    const a = m[3].length === 4 ? m[3] : (ano ?? m[3]);
    return `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${a}`;
  };
  const hora = (rotulo: RegExp) => campo(t, rotulo, iTrat)?.match(/\d{2}h\d{2}m/)?.[0] ?? null;
  return {
    numero,
    processo: t.match(/Certificado TFQ[^()]*\(\d+\)\s*SEI\s*(\d{5}\.\d{6}\/\d{4}-\d{2})/i)?.[1] ?? t.match(/Processo nº\s*(\d{5}\.\d{6}\/\d{4}-\d{2})/i)?.[1] ?? null,
    razao: campo(t, /Raz[ãa]o social:/i),
    cnpj: t.match(/CNPJ:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i)?.[1] ?? null,
    crea: campo(t, /registro no CREA:/i),
    endereco: campo(t, /\d\.\d\.\s*Endere[çc]o(?: completo com CEP)?:/i),
    telefone: campo(t, /Telefone:/i),
    email: campo(t, /Endere[çc]o\s+eletr[ôo]nico:/i),
    regMapa: campo(t, /junto ao MAPA:/i),
    comunicado: campo(t, /Comunicado de Tratamento:/i, iTrat),
    enderecoTrat: campo(t, /realizado o tratamento fitossanit[áa]rio com fins quarenten[áa]rios:/i, iTrat),
    destino: campo(t, /Destino:/i, iTrat),
    produto: campo(t, /Descri[çc][ãa]o do produto:/i, iTrat),
    volumes: campo(t, /descri[çc][ãa]o dos volumes:/i, iTrat),
    quantidade: campo(t, /Quantidade de produto tratado:/i, iTrat),
    lote: campo(t, /N[úu]mero do lote:/i, iTrat),
    ciclo: campo(t, /Ciclo de Tratamento:/i, iTrat),
    modalidade: campo(t, /Modalidade de Tratamento:/i, iTrat),
    dataInicio: datas(/Data d[eo] in[íi]cio do tratamento:/i),
    horaInicio: hora(/Hor[áa]rio do in[íi]cio do tratamento:/i),
    dataFim: datas(/Data do t[ée]rmino do tratamento:/i),
    horaFim: hora(/Hor[áa]rio do t[ée]rmino do tratamento:/i),
    temperatura: campo(t, /\d\.\d{1,2}\.\s*Temperatura:/i, iTrat),
    local: campo(t, /Local de emiss[ãa]o:/i, iTrat),
  };
}

// ---------- DR (Demonstrativo de Rastreabilidade) ----------

export interface LinhaDR {
  processo: string;
  ciclo: string;
  certificado: string;
  lote: string;
  dataInicio: string;
  horaInicio: string;
  dataFim: string;
  horaFim: string;
  tipo: string; // KD | HT
  umidade: string;
  temperatura: string;
  duracao: string;
}

export interface DemonstrativoRastreabilidade {
  numero: string | null; // "2026/389-C"
  empresa: string | null;
  cnpj: string | null;
  crea: string | null;
  telefone: string | null;
  endereco: string | null;
  email: string | null;
  regMapa: string | null;
  linhas: LinhaDR[];
}

export function lerDR(texto: string): DemonstrativoRastreabilidade | null {
  const t = achatar(texto);
  if (!/DEMONSTRATIVO DE RASTREABILIDADE/i.test(t)) return null;
  // "21034.032577/2026-19 UR061006PR190826 623/2026 6-1006 19/08/2026 22h24m 21/08/202 00h58m KD 18% 71 26h34m"
  const re =
    /(\d{5}\.\d{6}\/\d{4}-\d{2})\s+(\S+)\s+(\d{1,4}\/\d{4}(?:-\w+)?)\s+(\S+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{2}h\d{2}m)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{2}h\d{2}m)\s+(KD|HT)\s+(\S+)\s+(\d+(?:[.,]\d+)?)\s+(\d+h\d+m(?:in)?|\d+)/gi;
  const linhas: LinhaDR[] = [...t.matchAll(re)].map((m) => ({
    processo: m[1],
    ciclo: m[2],
    certificado: m[3],
    lote: m[4],
    dataInicio: m[5],
    horaInicio: m[6],
    dataFim: m[7],
    horaFim: m[8],
    tipo: m[9].toUpperCase(),
    umidade: m[10],
    temperatura: m[11],
    duracao: m[12],
  }));
  return {
    // Também a DR bilíngue: "Consolidado / Consolidated Treatment Certificate Number:", "Endereço / Address:".
    numero: t.match(/Certificado de Tratamento Consolidado(?:\s*\/[^:]*)?:\s*(\d{4}\/\d{1,4}-C)/i)?.[1] ?? null,
    empresa: t.match(/Empresa(?:\s*\/\s*Corporate name)?:\s*(.+?)\s+Cnpj:/i)?.[1] ?? null,
    cnpj: t.match(/Cnpj:\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i)?.[1] ?? null,
    crea: t.match(/CREA:\s*(.+?)\s+Telefone/i)?.[1] ?? null,
    telefone: t.match(/Telefone(?:\s*\/\s*Telephone)?:\s*(.+?)\s+Endere[çc]o/i)?.[1] ?? null,
    endereco: t.match(/Endere[çc]o(?:\s*\/\s*Address)?:\s*(.+?)\s+E-mail:/i)?.[1] ?? null,
    email: t.match(/E-mail:\s*(\S+)/i)?.[1] ?? null,
    regMapa: t.match(/Registro MAPA(?:\s*\/\s*MAPA Registration)?:\s*(\S+)/i)?.[1] ?? null,
    linhas,
  };
}
