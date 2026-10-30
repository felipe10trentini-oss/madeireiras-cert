// Linha da aba TÉRMICO do relatório do MAPA para a MANN MÓVEL (Mann Unid. Volante): as colunas A–Z são as
// mesmas das credenciadas, mas a Mann preenche de outro jeito (validado contra as linhas já lançadas):
// o total de peças vai em "Número de volumes" (quantidade vazia), o produto é o do comunicado, o local é
// a cidade do cliente, a "unidade de tratamento" é a placa do veículo e o volume da câmara é fixo.
import type { Comunicado } from "./comunicado";
import type { Madeireira } from "./madeireiras";
import type { ValoresCertificado } from "./modelos";
import type { LinhaRelatorio } from "./relatorio";
import { soDigitos } from "./util";

export const CNPJ_MANN_MOVEL = "00093600000141";

/**
 * Nº do processo (SEI) dos comunicados. Muda quando abrem um processo novo (até o certificado 1479 era
 * 21034.012876/2026-29): ao copiar a linha o site guarda o valor digitado e passa a usá-lo.
 */
export const PROCESSO_COMUNICADO_MANN = "21034.036632/2026-31";
export const VOLUME_CAMARA_MANN = "56";

/** "Unidade volante" do comunicado -> placa do veículo ("Identificação da unidade de tratamento"). */
export const PLACA_POR_UNIDADE: Record<string, string> = {
  "unidade 1": "ATU 0929",
  "unidade 2": "RHV3A66",
  "unidade 3": "JCV8C11",
  "unidade 4": "RIX2I54",
  "unidade 5": "TQV2A94",
};

export const ehMannMovel = (empresa: Pick<Madeireira, "cnpj">) => soDigitos(empresa.cnpj) === CNPJ_MANN_MOVEL;

export function placaDaUnidade(unidade: string | null | undefined): string {
  return PLACA_POR_UNIDADE[(unidade ?? "").trim().toLowerCase()] ?? "";
}

/**
 * "Rua X, 4226 - Cambé - PR" -> "Cambé"; "Av. Y - Londrina (Hag Palete) - PR" e "R. Z, 370 - Londrina - PR
 * (Britoni Pallets)" -> "Londrina" (o nome do pátio entre parênteses sai antes; com ele no fim, a UF ficava
 * como cidade); "… CEP: 86.186-020 –Cambe – PR" e "… Londrina/PR" também.
 */
export function cidadeDoEndereco(endereco: string | null | undefined): string {
  if (!endereco) return "";
  const t = endereco
    .replace(/\([^)]*\)/g, " ")
    .replace(/CEP:?\s*[\d.]+-?\d*/gi, " ")
    .replace(/\s*[–—]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,-]+$/, "")
    .replace(/\s*[-,]\s*Brasil$/i, "");
  // "… Cidade - PR" / "… Cidade/PR": a cidade é o trecho antes da UF (depois do último hífen ou vírgula).
  const m = t.match(/(?:^|[-,])\s*([A-Za-zÀ-ÿ' .]+?)\s*[-/]\s*([A-Z]{2})\.?$/);
  if (m) return m[1].trim();
  const partes = t.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (partes.length && /^[A-Z]{2}$/.test(partes[partes.length - 1])) partes.pop();
  return partes.length > 1 ? partes[partes.length - 1] : "";
}

export function linhaMannMovel(
  base: LinhaRelatorio,
  a: { valores: ValoresCertificado; comunicado: Comunicado | null; processo: string; dataDocumento: string; placa: string; local: string; volumeCamara: string }
): LinhaRelatorio {
  const v = a.valores;
  return {
    ...base,
    processo: a.processo,
    dataDocumento: a.dataDocumento,
    tomador: v.tomRazao ?? "",
    produto: v.produto ?? "",
    // Total de peças em "Número de volumes": a linha genérica põe a soma em "quantidade" ou, quando o
    // estilo da planilha conta em volumes (o da Mann), já em "volumes" — vale a que vier preenchida.
    volumes: base.quantidade || base.volumes,
    unidadeVolumes: "Unidades",
    quantidade: "",
    unidadeQuantidade: "",
    destino: a.comunicado?.destino || "Indefinido",
    horario: (v.horaInicio ?? "").replace(/^(\d{1,2})h(\d{2})m$/, (_, h: string, m: string) => `${h.padStart(2, "0")}:${m}`),
    local: a.local,
    camara: a.placa,
    volumeCamara: a.volumeCamara,
  };
}
