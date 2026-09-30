// Nome completo dos responsáveis técnicos. A Planilha Geral traz só o apelido ("Geraldo",
// "Carolina"); o nome completo é o da assinatura no SEI ("Documento assinado eletronicamente
// por …", certificados de setembro/2026) e, na falta dela, o das planilhas de relatório.
import { chaveNome } from "./util";

const NOMES: Record<string, string> = {
  CAROLINA: "Carolina Ferraz Hampel Gonzaga",
  GERALDO: "Geraldo Adolfo Mann",
  RODOLFO: "Rodolfo Cardoso Jacinto",
  VINICIUS: "Marcus Vinicius Rodrigues Berkembrock",
  HALLISON: "Halisson Budinheski Halila",
  HALISSON: "Halisson Budinheski Halila",
  CAMILACRESTANI: "Camila Crestani Trentini",
  SUELEN: "Suelen Carina Ferreira Nogueira",
  SILVANA: "Silvana Rugik",
  FELIPE: "Felipe Trentini",
  HUMBERTOGABARDO: "Humberto Gabardo",
  CLEVERSON: "Cleverson Bomfim Bettega",
  MAICON: "Maicon Berkenbrock",
  MAIKON: "Maicon Berkenbrock",
  HUMBERTOCABRAL: "Humberto de Ramos Cabral",
  TICIANO: "Ticiano José Boing",
  // Só nas planilhas de relatório (sem certificado assinado em setembro):
  CAMILASESTREM: "Camila Cristiane Sestrem",
  ROBERTO: "José Roberto Andrade Nobell",
  RICARDOSFREDO: "Ricardo Sfredo",
};

/** "Geraldo" -> "Geraldo Adolfo Mann". Nome já completo ou desconhecido volta como veio. */
export function rtCompleto(rt: string | null | undefined): string | null {
  const t = (rt ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return NOMES[chaveNome(t)] ?? t;
}
