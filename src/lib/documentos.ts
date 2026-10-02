// Certificados desdobrado e consolidado (modelos do SEI id_serie 3562 e 3561).
//  - Desdobrado: a partir do certificado mestre (PDF do SEI). Nº = nº do mestre + "-1", "-2"…;
//    2.1, 2.2 e 3.6 ficam para o operador; 3.9 = NFe; madeira serrada leva a observação de umidade.
//  - Consolidado: a partir do PDF da DR. Nº vem da DR ("2026/389-C"); 3.5 só a unidade; 3.6 os lotes.
import type { CertificadoMestre, DemonstrativoRastreabilidade } from "./certificadoMestre";
import type { Madeireira } from "./madeireiras";
import { MODELO_CONSOLIDADO, MODELO_DESDOBRADO } from "./modelosDocumentos";

export type TipoDocumento = "desdobrado" | "consolidado";
export type Material = "palete" | "madeira";

/** Valores por rótulo do modelo ("1.1", "3.6", "local", "numero", "processo", "obs"). */
export type ValoresDocumento = Record<string, string>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Material do mestre: embalagens contadas (paletes, caixas…) ou madeira serrada em m³. */
export function materialDoMestre(m: CertificadoMestre): Material {
  const t = `${m.produto ?? ""} ${m.volumes ?? ""} ${m.quantidade ?? ""}`;
  return /palet|pallet|caixa|kit|skid|suporte|embalag|tampa|engradado/i.test(t) && !/m³|m3/i.test(m.quantidade ?? "") ? "palete" : "madeira";
}

/**
 * Material do consolidado: empresas que secam (KD ou KD/HT) = madeira serrada de pinus (o operador
 * troca se for outra madeira); empresas só HT = paletes. Sem empresa, pela DR (KD = madeira).
 */
export function materialDaDR(dr: DemonstrativoRastreabilidade, empresa?: Madeireira | null): Material {
  if (empresa) return empresa.tratamentos.includes("KD") ? "madeira" : "palete";
  return dr.linhas.some((l) => l.tipo === "KD") ? "madeira" : "palete";
}

/** Só "Cidade - UF" do endereço (sem rua, número, CEP): "… CEP 83.480-000 Tunas do Paraná - PR" -> "Tunas do Paraná - PR". */
export function cidadeUf(endereco: string | null | undefined): string {
  const t = (endereco ?? "").replace(/CEP:?\s*[\d.]+-?\d*/gi, " ").replace(/\s+/g, " ").trim();
  const m = t.match(/([A-Za-zÀ-ÿ' .]+?)\s*[-–/]\s*([A-Z]{2})\.?\s*$/);
  return m ? `${m[1].trim()} - ${m[2]}` : "";
}

/** "tratamento térmico por calor: secagem em estufa: KD" -> "KD"; ar quente forçado / HT -> "HT". */
function modalidadeCurta(m: string | null): string {
  if (/:\s*KD\b|\bKD\s*$/i.test(m ?? "")) return "KD";
  return "HT";
}

/** "Madeira serrada de pinus 17 mm; 22 mm" -> "Madeira serrada de pinus" (o desdobrado não leva bitola). */
function semBitola(p: string | null): string {
  return (p ?? "").replace(/\s+\d+(?:[.,]\d+)?\s*mm\b.*$/i, "").trim();
}

function dadosEmpresa(e: Madeireira | null, m: Partial<CertificadoMestre>) {
  return {
    razao: e?.razaoSocial ?? m.razao ?? "",
    cnpj: e?.cnpj ?? m.cnpj ?? "",
    crea: e?.crea ?? m.crea ?? "",
    endereco: e?.endereco ?? m.endereco ?? "",
    telefone: e?.telefone ?? m.telefone ?? "",
    email: e?.email ?? m.email ?? "",
    regMapa: e?.regMapa ?? m.regMapa ?? "",
  };
}

/** Sequência ("1", "2"…) e quantidade são digitadas pelo operador; aparecem no certificado na hora. */
export function valoresDesdobrado(
  m: CertificadoMestre,
  empresa: Madeireira | null,
  material: Material,
  sequencia: string,
  quantidade: string
): ValoresDocumento {
  const unidade = material === "palete" ? "unidades" : "m³";
  const d = dadosEmpresa(empresa, m);
  return {
    numero: m.numero ? (sequencia.trim() ? `${m.numero}-${sequencia.trim()}` : m.numero) : "",
    processo: m.processo ?? "",
    "1.1": d.razao,
    "1.2": d.cnpj,
    "1.3": d.crea,
    "1.4": d.endereco,
    "1.5": d.telefone,
    "1.6": d.email,
    "1.7": d.regMapa,
    "2.1": "",
    "2.2": "",
    "2.3": "Nihil",
    "2.4": "Nihil",
    "2.5": "Nihil",
    "3.1": m.comunicado ?? "",
    "3.2": m.enderecoTrat ?? d.endereco,
    "3.3": "Nihil",
    "3.4": material === "palete" ? (m.produto ?? "Madeira reflorestada") : semBitola(m.produto) || "Madeira serrada de pinus",
    "3.5": material === "palete" ? (m.volumes ?? "Paletes de madeira") : "Fardos",
    "3.6": quantidade.trim() ? `${quantidade.trim()} ${unidade}` : unidade,
    "3.7": m.lote ?? "",
    "3.8": m.ciclo ?? "",
    "3.9": "NFe",
    "3.10": modalidadeCurta(m.modalidade),
    "3.11": m.dataInicio ?? "",
    "3.12": m.horaInicio ?? "",
    "3.13": m.dataFim ?? "",
    "3.14": m.horaFim ?? "",
    "3.15": m.temperatura ?? "",
    obs: material === "madeira" ? "Obs: Madeira com umidade inferior a 18%" : "",
    local: m.local ?? "",
  };
}

export function valoresConsolidado(dr: DemonstrativoRastreabilidade, empresa: Madeireira | null, material: Material): ValoresDocumento {
  const d = dadosEmpresa(empresa, { razao: dr.empresa, cnpj: dr.cnpj, crea: dr.crea, telefone: dr.telefone, endereco: dr.endereco, email: dr.email, regMapa: dr.regMapa });
  const local = cidadeUf(d.endereco);
  const vide = "vide Demonstrativo de Rastreabilidade";
  return {
    numero: dr.numero ?? "",
    "1.1": d.razao,
    "1.2": d.cnpj,
    "1.3": d.endereco,
    "1.4": d.telefone,
    "1.5": d.email,
    "1.6": d.regMapa,
    "1.7": d.crea,
    "2.1": "",
    "2.2": "",
    "2.3": "Nihil",
    "2.4": "Nihil",
    "2.5": "Nihil",
    "3.1": d.endereco,
    "3.2": "Nihil",
    "3.3": material === "palete" ? "Madeira reflorestada" : "Madeira serrada de pinus",
    "3.4": material === "palete" ? "Paletes de madeira" : "Fardos",
    "3.5": material === "palete" ? "unidades" : "m³",
    "3.6": dr.linhas.map((l) => l.lote).join("; "),
    "3.7": vide,
    "3.8": "NFe",
    "3.9": vide,
    "3.10": vide,
    "3.11": vide,
    "3.12": vide,
    "3.13": vide,
    "3.14": vide,
    local,
  };
}

/** Rótulos editáveis na tela (o resto vem do mestre/DR e pode ser ajustado em "editar"). */
export const CAMPOS_MANUAIS: Record<TipoDocumento, { k: string; rotulo: string }[]> = {
  desdobrado: [
    { k: "2.1", rotulo: "2.1. Razão social (comprador/tomador)" },
    { k: "2.2", rotulo: "2.2. CNPJ (comprador/tomador)" },
    { k: "3.9", rotulo: "3.9. Marcas distintivas (NFe)" },
  ],
  consolidado: [
    { k: "2.1", rotulo: "2.1. Razão social (comprador/tomador)" },
    { k: "2.2", rotulo: "2.2. CNPJ (comprador/tomador)" },
    { k: "3.3", rotulo: "3.3. Descrição do(s) produto(s)" },
    { k: "3.4", rotulo: "3.4. Número e descrição dos volumes" },
    { k: "3.5", rotulo: "3.5. Quantidade de produto tratado" },
    { k: "3.8", rotulo: "3.8. Marcas distintivas (NFe)" },
  ],
};

/**
 * Preenche o modelo do SEI: cada valor entra logo depois do rótulo, dentro do mesmo parágrafo
 * ("1.1. Razão social: AGK Madeiras Ltda"). Nada do modelo é alterado além disso.
 */
export function montarDocumento(tipo: TipoDocumento, v: ValoresDocumento): string {
  let h = tipo === "desdobrado" ? MODELO_DESDOBRADO : MODELO_CONSOLIDADO;
  const val = (k: string) => (v[k] ?? "").trim();

  // Números no cabeçalho.
  h = h.replace(/(Certificado de Tratamento (?:Desdobrado|Consolidado):)(<\/p>)/, (_, a, b) => `${a} ${esc(val("numero"))}${b}`);
  h = h.replace(/(Quarenten&aacute;rios Original:)(<\/p>)/, (_, a, b) => `${a} ${esc(val("processo"))}${b}`);

  // Campos numerados: "<p class=…>3.6. Quantidade…:</p>" -> "…: valor</p>".
  h = h.replace(/(<p class="Texto_Alinhado_Esquerda">)(\d\.\d{1,2})(\.?(?:&nbsp;|\s)[^<]*?)((?:&nbsp;|\s)*)(<\/p>)/g, (todo, p, num, rotulo, _esp, fim) => {
    if (!(num in v)) return todo;
    // Rótulo sem o texto que o modelo já traz depois dele ("…: vide Demonstrativo de Rastreabilidade:").
    let r = rotulo.replace(/(?:&nbsp;|\s)+$/, "").replace(/:(?:&nbsp;|\s)*vide(?:&nbsp;|\s)+Demonstrativo de(?:&nbsp;|\s)*Rastreabilidade:?$/, ":");
    // Consolidado: os itens "vide Demonstrativo de Rastreabilidade:" saem sem os dois-pontos finais.
    r = r.replace(/(Rastreabilidade):$/, "$1");
    if (!/:$/.test(r)) r += ":";
    const valor = val(num);
    let html = `${p}${num}${r}${valor ? ` ${esc(valor)}` : ""}${fim}`;
    if (num === "3.15" && val("obs")) html += `<p class="Texto_Alinhado_Esquerda">${esc(val("obs"))}</p>`;
    return html;
  });
  // Os itens fixos do consolidado ("vide Demonstrativo de Rastreabilidade:") perdem o ":" final.
  h = h.replace(/(vide(?:&nbsp;|\s)+Demonstrativo de(?:&nbsp;|\s)*Rastreabilidade):(<\/p>)/g, "$1$2");

  // Local de emissão no cabeçalho cinza da seção 4.
  h = h.replace(/(<strong>4\. Local de emiss&atilde;o:<\/strong>)/, (_, a) => `${a}${val("local") ? ` ${esc(val("local"))}` : ""}`);
  return h;
}
