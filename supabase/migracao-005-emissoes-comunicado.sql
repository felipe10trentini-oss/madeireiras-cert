-- Aviso de certificado/comunicado repetido (prestadoras, ex.: Mann Unid. Volante).
-- A emissão passa a guardar o nº do comunicado ("1543/2026") e o site consulta o histórico
-- antes de copiar: mesmo nº de certificado com outro comunicado, ou comunicado já usado em outro certificado.
-- Rode uma vez no SQL Editor do Supabase ANTES de publicar o código novo.

alter table madeireiras.emissoes add column if not exists comunicado text;

create index if not exists emissoes_cnpj_numero_idx on madeireiras.emissoes (empresa_cnpj, numero_certificado);
create index if not exists emissoes_cnpj_comunicado_idx on madeireiras.emissoes (empresa_cnpj, comunicado);

notify pgrst, 'reload schema';
