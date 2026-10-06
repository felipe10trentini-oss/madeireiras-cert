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

export function lerComunicado(texto: string): Comunicado {
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
