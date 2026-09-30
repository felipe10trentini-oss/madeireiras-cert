// Planilha "Cadastro Madeireiras.xlsx" (aba CADASTRO): dados da empresa + configurações que
// ajustam o certificado, o relatório e a DR. A mesma definição gera a planilha
// (scripts/gerarPlanilhaCadastro.ts) e lê o arquivo na aba Madeireiras do site.
import type { ConfigEmpresa, Madeireira } from "./madeireiras";
import { lerTratamentos } from "./madeireiras";
import { rtCompleto } from "./responsaveis";

export type TipoColuna = "texto" | "simnao" | "numero" | "lista";

export interface ColunaCadastro {
  titulo: string;
  grupo: "Dados da empresa" | "Documento" | "Certificado" | "Tomador / prestador" | "Relatórios";
  tipo: TipoColuna;
  opcoes?: string[];
  obrigatoria?: boolean;
  largura: number;
  ajuda: string;
}

export const SIM_NAO = ["Sim", "Não"];

export const FORMATOS_LOTE = [
  "Padrão (estufa-ciclo)",
  "Ciclo com 3 dígitos (4-043)",
  "Sem hífen (1514)",
  "Lote = nº do certificado",
  "Nº do certificado = lote",
  "Sequencial da empresa",
  "Ano + semana (2640)",
] as const;

export const DOCUMENTOS = ["Programação mensal", "Programação trimestral", "Comunicado"] as const;

export const SISTEMAS = ["SV580", "SV520", "DMC2051", "DMC2051 Gráfico", "Digisystem Relatório", "CRG08 HT", "CRG08 KDHT", "Mahild", "Outro"];

export const COLUNAS_CADASTRO: ColunaCadastro[] = [
  { titulo: "Apelido", grupo: "Dados da empresa", tipo: "texto", obrigatoria: true, largura: 22, ajuda: "Nome curto que aparece no site e no nome da curva (ex.: ABB WOOD, GM, Inexport Capivari)." },
  { titulo: "Razão social", grupo: "Dados da empresa", tipo: "texto", obrigatoria: true, largura: 38, ajuda: "Como vai no item 1.1 do certificado." },
  { titulo: "CNPJ", grupo: "Dados da empresa", tipo: "texto", obrigatoria: true, largura: 20, ajuda: "Com ou sem pontuação. É a chave da empresa: não repita." },
  { titulo: "Modalidade", grupo: "Dados da empresa", tipo: "lista", opcoes: ["Cadastrada", "Credenciada"], obrigatoria: true, largura: 13, ajuda: "Define o modelo do SEI e o relatório (cadastrada A–X, credenciada A–Z)." },
  { titulo: "Tratamentos", grupo: "Dados da empresa", tipo: "lista", opcoes: ["KD/HT", "HT", "KD"], obrigatoria: true, largura: 11, ajuda: "Só HT = sempre AQF. KD/HT = secagem (KD se umidade final < 18%, senão HT)." },
  { titulo: "Registro MAPA", grupo: "Dados da empresa", tipo: "texto", obrigatoria: true, largura: 14, ajuda: "Código do cadastro/credenciamento (ex.: BR-PR0938)." },
  { titulo: "CREA", grupo: "Dados da empresa", tipo: "texto", largura: 11, ajuda: "Nº de registro no CREA." },
  { titulo: "Responsável técnico", grupo: "Dados da empresa", tipo: "texto", largura: 22, ajuda: "Nome do RT (vai no relatório do MAPA)." },
  { titulo: "UF", grupo: "Dados da empresa", tipo: "texto", largura: 5, ajuda: "Estado." },
  { titulo: "Endereço completo", grupo: "Dados da empresa", tipo: "texto", largura: 55, ajuda: "Com CEP e terminando em \"Cidade - UF\" (a cidade vira o local de emissão)." },
  { titulo: "Telefone", grupo: "Dados da empresa", tipo: "texto", largura: 16, ajuda: "" },
  { titulo: "E-mail", grupo: "Dados da empresa", tipo: "texto", largura: 30, ajuda: "E-mail do cadastro." },
  { titulo: "Ativa", grupo: "Dados da empresa", tipo: "lista", opcoes: SIM_NAO, largura: 7, ajuda: "\"Não\" some da lista do site (ex.: WAS, Andreazza)." },

  { titulo: "Documento", grupo: "Documento", tipo: "lista", opcoes: [...DOCUMENTOS], obrigatoria: true, largura: 21, ajuda: "Programação mensal (09/2026), trimestral (03/2026 = jul–set) ou comunicado por tratamento (trava de divergência)." },
  { titulo: "Nº do processo da programação", grupo: "Documento", tipo: "texto", largura: 24, ajuda: "Processo SEI da programação (vai no relatório)." },

  { titulo: "Sistema da curva", grupo: "Certificado", tipo: "lista", opcoes: SISTEMAS, largura: 16, ajuda: "Para referência: o site reconhece o sistema sozinho." },
  { titulo: "Unidade dos volumes", grupo: "Certificado", tipo: "texto", largura: 12, ajuda: "Vazio = Fardos. Ex.: Tábuas (ABB)." },
  { titulo: "Descrição do produto fixa", grupo: "Certificado", tipo: "texto", largura: 32, ajuda: "Quando todo certificado tem a mesma descrição (MART: Madeira serrada para embalagens). Vazio = a da curva." },
  { titulo: "Bitola padrão (mm)", grupo: "Certificado", tipo: "numero", largura: 10, ajuda: "Usada quando a curva não traz a bitola (Rio Timbó: 17)." },
  { titulo: "Formato do lote", grupo: "Certificado", tipo: "lista", opcoes: [...FORMATOS_LOTE], largura: 24, ajuda: "Como o lote vai no certificado. Lote próprio da empresa pode vir no nome da curva: \"165 GM 1-446(833)\"." },
  { titulo: "Formato do ciclo", grupo: "Certificado", tipo: "texto", largura: 22, ajuda: "Vazio = padrão \"Estufa 04 - Ciclo 208\" (secagem SV520/DMC2051/Mahild). Use {e} estufa, {e2} estufa com 2 dígitos, {c} ciclo, {c3} ciclo com 3 dígitos." },
  { titulo: "E-mail no certificado", grupo: "Certificado", tipo: "texto", largura: 28, ajuda: "Só se for diferente do e-mail do cadastro (LG: faturamento2@…)." },
  { titulo: "Kit de paletes = AQF", grupo: "Certificado", tipo: "lista", opcoes: SIM_NAO, largura: 9, ajuda: "Curva com KIT sempre AQF em unidades (Maxi)." },
  { titulo: "Curva SV580 HT = AQF", grupo: "Certificado", tipo: "lista", opcoes: SIM_NAO, largura: 9, ajuda: "Curva SV580 \"Finalizado (HT)\" vai como ar quente forçado AQF-HT (Palletimber)." },
  { titulo: "Embalagem \"de madeira\"", grupo: "Certificado", tipo: "lista", opcoes: SIM_NAO, largura: 9, ajuda: "Paletes -> \"Paletes de madeira\" (MD Paletes)." },
  { titulo: "Planilha de controle do cliente", grupo: "Certificado", tipo: "lista", opcoes: SIM_NAO, largura: 10, ajuda: "SV520/Mahild: bitola, fardos e m³ vêm da planilha de controle enviada pelo cliente." },

  { titulo: "Prestadora de serviço", grupo: "Tomador / prestador", tipo: "lista", opcoes: SIM_NAO, largura: 10, ajuda: "Trata na casa do cliente como a Mann móvel (Exata): tomador e endereço vêm do comunicado." },
  { titulo: "CNPJ do prestador (matriz)", grupo: "Tomador / prestador", tipo: "texto", largura: 20, ajuda: "Filial que emite em nome da matriz (Inexport Capivari): os dados 1.x são os da matriz e o tomador é a filial." },
  { titulo: "Tomador fixo - razão social", grupo: "Tomador / prestador", tipo: "texto", largura: 28, ajuda: "Tomador que vai sempre no certificado (Reis -> Madeireira São Gabriel)." },
  { titulo: "Tomador fixo - CNPJ", grupo: "Tomador / prestador", tipo: "texto", largura: 20, ajuda: "" },
  { titulo: "Tomador fixo - endereço", grupo: "Tomador / prestador", tipo: "texto", largura: 30, ajuda: "Vazio = o da empresa." },
  { titulo: "Tomador fixo - telefone", grupo: "Tomador / prestador", tipo: "texto", largura: 16, ajuda: "Vazio = o da empresa." },
  { titulo: "Tomador fixo - e-mail", grupo: "Tomador / prestador", tipo: "texto", largura: 24, ajuda: "Vazio = o da empresa." },

  { titulo: "Tem DR", grupo: "Relatórios", tipo: "lista", opcoes: SIM_NAO, largura: 8, ajuda: "A empresa tem Demonstrativo de Rastreabilidade: o site mostra \"Copiar para DR\" (data e horário do fim)." },
  { titulo: "DR com KD e HT separados", grupo: "Relatórios", tipo: "lista", opcoes: SIM_NAO, largura: 10, ajuda: "Pinustan: abas DADOS KD (fim da secagem) e DADOS HT (início e fim da janela HT, marcada com # no SV580)." },
  { titulo: "Observações", grupo: "Relatórios", tipo: "texto", largura: 40, ajuda: "Livre (não muda nada no site)." },
];

const sim = (v: string | null) => /^s(im)?$/i.test((v ?? "").trim());

/** Uma linha da aba CADASTRO -> empresa + configurações. `null` quando a linha está vazia. */
export function empresaDaLinha(linha: Record<string, string | null>): { empresa: Madeireira; ativa: boolean } | null {
  const v = (t: string) => linha[t]?.trim() || null;
  if (!v("CNPJ") || !v("Razão social")) return null;
  const doc = (v("Documento") ?? "").toLowerCase();
  const lote = v("Formato do lote") ?? "";
  const config: ConfigEmpresa = {};
  const put = <K extends keyof ConfigEmpresa>(k: K, val: ConfigEmpresa[K] | null | undefined | false) => {
    if (val !== null && val !== undefined && val !== false && val !== "") config[k] = val as ConfigEmpresa[K];
  };
  put("programacaoTrimestral", doc.includes("trimestral"));
  put("sistemaCurva", v("Sistema da curva"));
  put("unidadeVolumes", v("Unidade dos volumes"));
  put("produto", v("Descrição do produto fixa"));
  const bitola = parseFloat((v("Bitola padrão (mm)") ?? "").replace(",", "."));
  put("bitolaPadraoMm", Number.isFinite(bitola) && bitola > 0 ? bitola : null);
  put("loteTresDigitos", lote.startsWith("Ciclo com 3"));
  put("loteSemHifen", lote.startsWith("Sem hífen"));
  put("loteEhNumero", lote.startsWith("Lote = nº"));
  put("numeroEhLote", lote.startsWith("Nº do certificado ="));
  put("loteSequencial", lote.startsWith("Sequencial"));
  put("loteAnoSemana", lote.startsWith("Ano + semana"));
  put("cicloSV520", v("Formato do ciclo"));
  put("email", v("E-mail no certificado"));
  put("kitEhAqf", sim(v("Kit de paletes = AQF")));
  put("htEhAqf", sim(v("Curva SV580 HT = AQF")));
  put("embalagemDeMadeira", sim(v("Embalagem \"de madeira\"")));
  put("planilhaControle", sim(v("Planilha de controle do cliente")));
  put("prestadora", sim(v("Prestadora de serviço")));
  put("prestadorCnpj", v("CNPJ do prestador (matriz)"));
  if (v("Tomador fixo - razão social") && v("Tomador fixo - CNPJ")) {
    config.tomadorFixo = {
      razao: v("Tomador fixo - razão social")!,
      cnpj: v("Tomador fixo - CNPJ")!,
      ...(v("Tomador fixo - endereço") && { endereco: v("Tomador fixo - endereço")! }),
      ...(v("Tomador fixo - telefone") && { telefone: v("Tomador fixo - telefone")! }),
      ...(v("Tomador fixo - e-mail") && { email: v("Tomador fixo - e-mail")! }),
    };
  }
  put("temDR", sim(v("Tem DR")));
  put("drKdHt", sim(v("DR com KD e HT separados")));
  put("observacoes", v("Observações"));
  const ativa = !/^n(ão|ao)?$/i.test(v("Ativa") ?? "Sim");
  if (!ativa) config.inativa = true;

  return {
    ativa,
    empresa: {
      apelido: v("Apelido") ?? v("Razão social")!,
      rt: rtCompleto(v("Responsável técnico")),
      uf: v("UF"),
      modalidade: /credenc/i.test(v("Modalidade") ?? "") ? "Credenciada" : "Cadastrada",
      tratamentos: lerTratamentos(v("Tratamentos")),
      razaoSocial: v("Razão social")!,
      cnpj: v("CNPJ")!,
      crea: v("CREA"),
      telefone: v("Telefone"),
      endereco: v("Endereço completo"),
      regMapa: v("Registro MAPA"),
      email: v("E-mail"),
      documento: doc.includes("comunicado") ? "comunicado" : doc ? "programacao" : null,
      unidadeVolumes: v("Unidade dos volumes"),
      processoProgramacao: v("Nº do processo da programação"),
      config,
    },
  };
}
