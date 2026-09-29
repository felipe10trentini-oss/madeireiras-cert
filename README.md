# Certificados Madeireiras — Mann & Cia / Exata

Emissão dos Certificados de Tratamento Fitossanitário com fins Quarentenários
(SEI/MAPA) das madeireiras atendidas pela consultoria. Você envia a curva de
tratamento, o site identifica a empresa, escolhe o modelo certo do SEI e monta
o certificado para copiar e colar no editor do SEI, junto com a linha do
relatório mensal do MAPA.

## Modelos do SEI

| Empresa | Tratamento | Modelo (id_serie) |
|---|---|---|
| Cadastrada | AQF (ar quente forçado) | 3569 |
| Cadastrada | Secagem em estufa (KD/HT) | 3571 |
| Credenciada | AQF (ar quente forçado) | 3570 |
| Credenciada | Secagem em estufa (KD/HT) | 3579 |

Regras (confirmadas com a equipe):

- Empresa só **HT** → modelo AQF, modalidade "AQF - HT" (a umidade não conta).
- Empresa **KD/HT** → modelo estufa: **KD** se a umidade final for menor que 18%, senão **HT**.
  Exceção: embalagens/skids/suportes/paletes → modelo AQF ("AQF - HT").
- KD usa o ciclo inteiro (início, fim e duração "68h08m"); HT/AQF usa a janela do
  tratamento (SV580: leituras marcadas com `#`; Digisystem: início + tt − 1).
- SV520: temperatura sempre 60°C; duração = "Duração" do cabeçalho; produto e cubagem
  são digitados (vêm da planilha do cliente).
- Credenciada: tomador "Nihil" (editável).
- Programação mensal: nº do comunicado = mês/ano do início ("09/2026").
- Nº do certificado e lote vêm do nome do arquivo da curva: `341 ABB 1-350.pdf` → 341/2026, lote 1-350.

## Curvas SV520 e Mahild: planilha de controle

Essas curvas não trazem bitola, fardos nem m³. Depois de ler a curva, o site pede a
**planilha de controle da secagem** do cliente (.xlsx, com colunas ESTUFA, FARDOS,
Bitola, VOLUME M³ e Nº DA SECAGEM): acha a linha pela estufa + nº da secagem (ou
data de início) e preenche descrição, volumes e quantidade. Sem a planilha, esses
campos ficam em branco para preencher à mão.

## Padrões por empresa

`REGRAS_EMPRESA` em `src/lib/certificado.ts` (por CNPJ): unidade dos volumes (ABB
"Tábuas"), lote com 3 dígitos, nº = lote (Pinustan), lote = nº (JJ Thomazi), lote
sequencial (GM, o site lembra o último), lote ano+semana (MART: 01/09/2026 -> 2636),
prestadora igual à Mann móvel (Exata: tomador, endereço e produto do comunicado),
e-mail (LG), formato do ciclo SV520/Mahild e ajuste do término (Madeico).
`npx tsx scripts/analisar.ts <pasta> saida.jsonl` compara em lote com os emitidos.

## Curvas suportadas

`src/lib/curvas/`: Marrari **SV580**, Marrari **SV520** e Digisystem (**CRG08 HT**,
**CRG08 KDHT**, **DMC2051**, **DMC2051 Gráfico**). PDFs que são só imagem (ex.:
CRG08 KDHT da Madeico) ainda não têm OCR — o site avisa e os campos são digitados.

A empresa é identificada pelo CNPJ da curva, depois pelo registro no MAPA e, por
fim, pelo nome no arquivo (tolerando erro de digitação).

## Rodando localmente

```bash
npm install
cp .env.local.example .env.local   # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEAM_PASSWORD
npm run dev
```

## Supabase

O projeto Supabase é o mesmo do certificado da Mann móvel, mas as tabelas das
madeireiras ficam num schema próprio, `madeireiras` (as da Mann ficam em `public`).
Rode `supabase/schema.sql` no SQL Editor (cria `madeireiras.empresas`) e inclua
`madeireiras` em Project Settings > Data API > **Exposed schemas**. Depois
envie a **Planilha Geral** na aba **Madeireiras** do site (ela é lida no navegador,
por passar do limite de upload da Vercel). O site usa a aba **DADOS CADASTRAIS**
e a aba **PROGRAMAÇÕES**: quem está nela (e não está cancelado) usa programação
mensal, e o nº do peticionamento vira o processo da programação no relatório;
as demais usam comunicado. Coluna opcional em DADOS CADASTRAIS: **UNIDADE** (Fardos, Tábuas…).

Processo/data da programação, RT e volume de cada câmara (relatório do MAPA)
ficam salvos por empresa na coluna `relatorio` quando a linha é copiada.

## Teste de regressão

Compara o certificado gerado com os já emitidos no SEI (`CERT <curva>.pdf`):

```bash
npm run regress                                   # tests/fixtures (não versionado)
npm run regress -- "C:\pasta\com\curvas e CERTs"
```

## Deploy (Vercel)

Importe o repositório na Vercel e configure `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` e `TEAM_PASSWORD`.
