/**
 * Regressão do aviso de certificado/comunicado repetido (prestadoras):
 *   npx tsx scripts/regress-duplicidade.ts
 */
import { avisosDuplicidade, type EmissaoAnteriorResumo } from "../src/lib/divergencias";

const anterior = (numero: string | null, comunicado: string | null): EmissaoAnteriorResumo => ({
  operador_login: "ana",
  numero_certificado: numero,
  comunicado,
  created_at: "2026-10-05T15:00:00Z",
});

const casos: { nome: string; anteriores: EmissaoAnteriorResumo[]; esperado: string[] }[] = [
  { nome: "mesmo certificado e comunicado", anteriores: [anterior("1500/2026", "10/2026")], esperado: ["atencao:Certificado já emitido"] },
  { nome: "mesmo certificado, outro comunicado", anteriores: [anterior("1500/2026", "9/2026")], esperado: ["erro:Número de certificado repetido"] },
  { nome: "comunicado já usado em outro certificado", anteriores: [anterior("1499/2026", "10/2026")], esperado: ["erro:Comunicado já atendido"] },
  { nome: "registro antigo sem comunicado", anteriores: [anterior("1500/2026", null)], esperado: [] },
  { nome: "sem histórico", anteriores: [], esperado: [] },
  { nome: "outro certificado e outro comunicado", anteriores: [anterior("1400/2026", "5/2026")], esperado: [] },
];

let falhas = 0;
for (const c of casos) {
  const obtido = avisosDuplicidade(c.anteriores, "1500/2026", "10/2026").map((a) => `${a.nivel}:${a.campo}`);
  const ok = JSON.stringify(obtido) === JSON.stringify(c.esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "OK  " : "FALHA"} ${c.nome}${ok ? "" : ` -> ${JSON.stringify(obtido)}`}`);
}
console.log(`${casos.length - falhas}/${casos.length} casos`);
process.exit(falhas ? 1 : 0);
