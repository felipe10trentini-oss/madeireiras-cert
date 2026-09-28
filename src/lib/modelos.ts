// Os 4 modelos de certificado do SEI/MAPA para madeireiras, reproduzidos a partir
// do editor do SEI (páginas salvas em tests/modelos-sei). Rótulos, negritos,
// agrupamento das células e pequenas inconsistências ("2.2 CNPJ:", "3.4.Descrição")
// são mantidos iguais aos do modelo oficial.

export type ModeloId = "cadastrada-aqf" | "cadastrada-estufa" | "credenciada-aqf" | "credenciada-estufa";

export type Campo =
  | "razao" | "cnpj" | "crea" | "endereco" | "telefone" | "email" | "regMapa"
  | "tomRazao" | "tomCnpj" | "tomEndereco" | "tomTelefone" | "tomEmail"
  | "comunicado" | "enderecoTrat" | "destino" | "produto" | "volumes" | "quantidade"
  | "lote" | "ciclo" | "marcas" | "modalidade"
  | "dataInicio" | "horaInicio" | "dataFim" | "horaFim" | "temperatura" | "local";

export interface Celula {
  k: Campo;
  r: string; // rótulo
  /** Texto fixo do modelo logo após o rótulo (modalidade). O valor completa depois dele. */
  fixo?: string;
  fixoNegrito?: boolean;
}

export type Linha =
  | { tipo: "secao"; titulo: string }
  | { tipo: "campos"; celulas: [Celula] | [Celula, Celula | null] }
  | { tipo: "local"; celula: Celula; cinza: boolean }
  | { tipo: "declaracoes" };

export interface Modelo {
  id: ModeloId;
  nome: string;
  idSerie: number;
  titulo: string;
  rotulosNegrito: boolean;
  declaracoesNegrito: boolean;
  /** Estilo extra nas células da seção de tratamento (o modelo credenciada-estufa usa fundo branco explícito). */
  estiloTratamento?: string;
  linhas: Linha[];
}

const secao = (titulo: string): Linha => ({ tipo: "secao", titulo });
const par = (a: Celula, b: Celula | null): Linha => ({ tipo: "campos", celulas: [a, b] });
const cheia = (a: Celula): Linha => ({ tipo: "campos", celulas: [a] });
const c = (k: Campo, r: string, extra: Partial<Celula> = {}): Celula => ({ k, r, ...extra });

const TITULO_TT = "Certificado de Tratamento Fitossanitário com fins Quarentenários – Tratamento Térmico";
const TITULO_HT = "Certificado de Tratamento Fitossanitário com fins Quarentenários – HT";
const DADOS_TFQ = "Dados do Tratamento Fitossanitário com fins Quarentenários";
const ENDERECO_TRAT = "Endereço completo onde foi realizado o tratamento fitossanitário com fins quarentenários:";

function linhasCadastrada(estufa: boolean): Linha[] {
  return [
    secao("1. Dados do Cadastro"),
    par(c("razao", "1.1. Razão social:"), c("cnpj", "1.2. CNPJ:")),
    par(c("crea", "1.3. Nº de registro no CREA:"), c("telefone", "1.4. Telefone:")),
    cheia(c("endereco", "1.5. Endereço:")),
    par(c("regMapa", "1.6. Código alfanumérico do cadastro junto ao MAPA:"), c("email", "1.7. Endereço eletrônico:")),
    secao(`2. ${DADOS_TFQ}`),
    par(c("comunicado", "2.1. Número do Comunicado de Tratamento:"), null),
    cheia(c("enderecoTrat", `2.2. ${ENDERECO_TRAT}`)),
    par(c("destino", "2.3. Destino:"), null),
    par(c("produto", "2.4. Descrição do produto:"), c("volumes", "2.5. Número e descrição dos volumes:")),
    par(c("quantidade", "2.6. Quantidade de produto tratado:"), c("lote", "2.7. Número do lote:")),
    par(c("ciclo", "2.8. Número do Ciclo de Tratamento:"), c("marcas", "2.9. Marcas distintivas:")),
    estufa
      ? cheia(c("modalidade", "2.10. Modalidade de Tratamento:", { fixo: "tratamento térmico por calor: secagem em estufa" }))
      : par(
          c("modalidade", "2.10. Modalidade de Tratamento:", {
            fixo: "tratamento térmico por calor: ar quente forçado",
            fixoNegrito: true,
          }),
          null
        ),
    par(c("dataInicio", "2.11. Data do início do tratamento:"), c("horaInicio", "2.12. Horário do início do tratamento:")),
    par(c("dataFim", "2.13. Data do término do tratamento:"), c("horaFim", "2.14. Horário do término do tratamento:")),
    par(c("temperatura", "2.15. Temperatura:"), null),
    { tipo: "local", celula: c("local", "3. Local de emissão:"), cinza: false },
    { tipo: "declaracoes" },
  ];
}

export const MODELOS: Record<ModeloId, Modelo> = {
  "cadastrada-aqf": {
    id: "cadastrada-aqf",
    nome: "Cadastrada · Ar quente forçado (AQF)",
    idSerie: 3569,
    titulo: TITULO_TT,
    rotulosNegrito: true,
    declaracoesNegrito: true,
    linhas: linhasCadastrada(false),
  },
  "cadastrada-estufa": {
    id: "cadastrada-estufa",
    nome: "Cadastrada · Secagem em estufa",
    idSerie: 3571,
    titulo: TITULO_TT,
    rotulosNegrito: true,
    declaracoesNegrito: true,
    linhas: linhasCadastrada(true),
  },
  "credenciada-aqf": {
    id: "credenciada-aqf",
    nome: "Credenciada · Ar quente forçado (AQF)",
    idSerie: 3570,
    titulo: TITULO_HT,
    rotulosNegrito: false,
    declaracoesNegrito: false,
    linhas: [
      secao("1. Dados do Cadastro"),
      par(c("razao", "1.1. Razão social:"), c("cnpj", "1.2. CNPJ:")),
      par(c("crea", "1.3. Nº de registro no CREA:"), c("endereco", "1.4. Endereço completo com CEP:")),
      cheia(c("telefone", "1.5. Telefone:")),
      par(c("email", "1.6. Endereço Eletrônico:"), c("regMapa", "1.7. Código alfanumérico do cadastro junto ao MAPA:")),
      secao("2. Dados do Tomador de Serviço"),
      par(c("tomRazao", "2.1. Razão Social:"), c("tomCnpj", "2.2 CNPJ:")),
      cheia(c("tomEndereco", "2.3. Endereço completo com CEP:")),
      par(c("tomTelefone", "2.4. Telefone:"), c("tomEmail", "2.5 Endereço eletrônico:")),
      secao(`3. ${DADOS_TFQ}:`),
      par(c("comunicado", "3.1. Número do Comunicado de Tratamento:"), c("enderecoTrat", `3.2. ${ENDERECO_TRAT}`)),
      par(c("destino", "3.3. Destino:"), c("produto", "3.4. Descrição do produto:")),
      par(c("volumes", "3.5. Número e descrição dos volumes:"), c("quantidade", "3.6. Quantidade de produto tratado:")),
      par(c("lote", "3.7. Número do lote:"), c("ciclo", "3.8. Número do Ciclo de Tratamento:")),
      par(
        c("marcas", "3.9. Marcas distintivas:"),
        c("modalidade", "3.10. Modalidade de Tratamento:", { fixo: "tratamento térmico por calor: ar quente forçado" })
      ),
      par(c("dataInicio", "3.11. Data do início do tratamento:"), c("horaInicio", "3.12. Horário do início do tratamento:")),
      par(c("dataFim", "3.13. Data do término do tratamento:"), c("horaFim", "3.14. Horário do término do tratamento:")),
      cheia(c("temperatura", "3.15. Temperatura:")),
      { tipo: "local", celula: c("local", "4. Local de emissão:"), cinza: true },
      { tipo: "declaracoes" },
    ],
  },
  "credenciada-estufa": {
    id: "credenciada-estufa",
    nome: "Credenciada · Secagem em estufa",
    idSerie: 3579,
    titulo: TITULO_TT,
    rotulosNegrito: false,
    declaracoesNegrito: true,
    estiloTratamento: "background-color: rgb(255, 255, 255);",
    linhas: [
      secao("1. Dados do credenciamento"),
      par(c("razao", "1.1. Razão social:"), c("cnpj", "1.2. CNPJ:")),
      par(c("crea", "1.3. Nº de registro no CREA:"), c("endereco", "1.4. Endereço completo com CEP:")),
      cheia(c("telefone", "1.5. Telefone:")),
      par(c("email", "1.6. Endereço eletrônico:"), c("regMapa", "1.7. Código alfanumérico do cadastro junto ao MAPA:")),
      secao("2. Dados do Tomador de Serviço"),
      par(c("tomRazao", "2.1. Razão Social:"), c("tomCnpj", "2.2. CNPJ:")),
      cheia(c("tomEndereco", "2.3. Endereço completo com CEP:")),
      par(c("tomTelefone", "2.4. Telefone:"), c("tomEmail", "2.5. Endereço Eletrônico:")),
      secao(`3. ${DADOS_TFQ}:`),
      cheia(c("comunicado", "3.1. Número do Comunicado de tratamento:")),
      cheia(c("enderecoTrat", `3.2. ${ENDERECO_TRAT}`)),
      par(c("destino", "3.3. Destino:"), c("produto", "3.4.Descrição do produto:")),
      par(c("volumes", "3.5. Número e descrição dos volumes:"), c("quantidade", "3.6. Quantidade de produto tratado:")),
      par(c("lote", "3.7. Número do lote:"), c("ciclo", "3.8. Número do ciclo de tratamento:")),
      cheia(c("marcas", "3.9. Marcas Distintivas:")),
      cheia(c("modalidade", "3.10. Modalidade de Tratamento:", { fixo: "Tratamento Térmico por calor: secagem em estufa:" })),
      par(c("dataInicio", "3.11. Data de Início do tratamento:"), c("horaInicio", "3.12. Horário do início do tratamento:")),
      par(c("dataFim", "3.13. Data do término do tratamento:"), c("horaFim", "3.14. Horário do término do tratamento:")),
      cheia(c("temperatura", "3.15. Temperatura:")),
      { tipo: "local", celula: c("local", "4. Local de Emissão:"), cinza: true },
      { tipo: "declaracoes" },
    ],
  },
};

export const DECLARACOES = [
  "- DECLARO para os devidos fins que assumo as responsabilidades pela veracidade das informações aqui prestadas, e estar ciente de que, a qualquer momento poderão ser auditadas, pela autoridade competente.",
  "- DECLARO, ainda, estar ciente de que prestar declaração falsa é crime previsto no art. 299 do Código Penal Brasileiro, sujeitando o declarante às suas penas, sem prejuízo de aplicação de outras sanções descritas na PORTARIA Nº 385, de 25 de agosto de 2021.",
  "- O DOCUMENTO DEVE SER PETICIONADO E ASSINADO DIGITALMENTE PELO RESPONSÁVEL TÉCNICO DA EMPRESA DEVIDAMENTE HABILITADO junto à área de TFQ do MAPA, conforme orientações constantes no Ofício-Circular nº1/2025/DIFTQ/CGFC/DSV/SDA/MAPA",
];

export const ROTULO_NUMERO = "Número do Certificado de Tratamento Fitossanitário com fins Quarentenários:";

/** Campos na ordem em que aparecem no modelo (para o formulário de edição). */
export function camposDoModelo(m: Modelo): Celula[] {
  return m.linhas.flatMap((l) => {
    if (l.tipo === "campos") return (l.celulas as (Celula | null)[]).filter((x): x is Celula => x !== null);
    if (l.tipo === "local") return [l.celula];
    return [];
  });
}

/** Texto do valor da modalidade depois do texto fixo: "…secagem em estufa: KD". */
export function textoModalidade(cel: Celula, valor: string): string {
  if (!cel.fixo) return valor;
  if (!valor) return cel.fixo;
  return cel.fixo.endsWith(":") ? `${cel.fixo} ${valor}` : `${cel.fixo}: ${valor}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const P = (html: string) => `<p class="Texto_Alinhado_Esquerda">${html}</p>`;
const CINZA = "background-color: rgb(221, 221, 221);";

export type ValoresCertificado = Partial<Record<Campo, string | null>> & { numero?: string };

/** HTML pronto para colar no editor do SEI (mesma estrutura e classes do modelo). */
export function montarHtml(m: Modelo, v: ValoresCertificado): string {
  const neg = (s: string, sim: boolean) => (sim ? `<strong>${s}</strong>` : s);

  function conteudo(cel: Celula): string {
    const valor = (v[cel.k] ?? "").trim();
    const rotulo = neg(esc(cel.r), m.rotulosNegrito);
    if (cel.fixo) {
      const fixoHtml = neg(esc(cel.fixo), cel.fixoNegrito ?? false);
      const sep = !valor ? "" : cel.fixo.endsWith(":") ? " " : ": ";
      return `${rotulo} ${fixoHtml}${sep}${esc(valor)}`;
    }
    return valor ? `${rotulo} ${esc(valor)}` : rotulo;
  }

  let naSecaoTratamento = false;
  const td = (html: string, colspan: boolean) => {
    const estilo = naSecaoTratamento && m.estiloTratamento ? ` style="${m.estiloTratamento}"` : "";
    return `<td${colspan ? ' colspan="2"' : ""}${estilo}>${P(html)}</td>`;
  };

  const linhas = m.linhas
    .map((l) => {
      switch (l.tipo) {
        case "secao":
          naSecaoTratamento = /Dados do Tratamento/.test(l.titulo);
          return `<tr><td colspan="2" style="${CINZA}">${P(`<strong>${esc(l.titulo)}</strong>`)}</td></tr>`;
        case "campos": {
          const [a, b] = l.celulas;
          if (l.celulas.length === 1) return `<tr>${td(conteudo(a), true)}</tr>`;
          return `<tr>${td(conteudo(a), false)}${td(b ? conteudo(b) : "&nbsp;", false)}</tr>`;
        }
        case "local": {
          naSecaoTratamento = false;
          const valor = (v.local ?? "").trim();
          const html = `<strong>${esc(l.celula.r)}${valor ? "" : "&nbsp;"}</strong>${valor ? ` ${esc(valor)}` : ""}`;
          return `<tr><td colspan="2"${l.cinza ? ` style="${CINZA}"` : ""}>${P(html)}</td></tr>`;
        }
        case "declaracoes":
          return `<tr><td colspan="2">${DECLARACOES.map((d) => P(neg(esc(d), m.declaracoesNegrito))).join("")}${P("&nbsp;")}</td></tr>`;
      }
    })
    .join("");

  return (
    `<p class="Texto_Centralizado">&nbsp;</p>` +
    `<p class="Texto_Centralizado_Maiusculas_Negrito">${esc(m.titulo)}</p>` +
    `<p align="justify" class="Texto_Centralizado">${ROTULO_NUMERO} ${esc(v.numero ?? "")}</p>` +
    `<p class="Texto_Centralizado">&nbsp;</p>` +
    `<table border="2" cellpadding="1" cellspacing="1"><tbody>${linhas}</tbody></table>` +
    `<p>&nbsp;</p>`
  );
}
