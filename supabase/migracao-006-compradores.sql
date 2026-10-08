-- Compradores frequentes do certificado desdobrado (2.1 Razão social do comprador/tomador).
-- Cadastrados na aba Cadastros; a lista aparece no desdobrado para escolher.
-- Rode uma vez no SQL Editor do Supabase. Já entra com os 11 compradores combinados em 08/10/2026.

create table if not exists madeireiras.compradores (
  id bigint generated always as identity primary key,
  razao text not null unique,
  created_at timestamptz not null default now()
);

alter table madeireiras.compradores enable row level security;
grant all on madeireiras.compradores to service_role;
grant all on all sequences in schema madeireiras to service_role;

insert into madeireiras.compradores (razao) values
  ('Serrabras Comércio de Madeiras Ltda'),
  ('Tree Serviços, Com. Importação e Exportação de Madeiras Ltda'),
  ('Brasilmad Exportadora S.A.'),
  ('Multi-Pine Wood Trading Ltda'),
  ('Mow Brazil Co Ltda'),
  ('Blue Export Comercial Exportadora Ltda'),
  ('Embalatec Industrial Ltda'),
  ('Pallets Castillo Brasil Comercial Ltda'),
  ('Madetam Madeireira Tamandare Ltda'),
  ('Eagle Comercial Exportadora Ltda'),
  ('Embalatec Mato Grosso do Sul Embalagens Ltda')
on conflict (razao) do nothing;

notify pgrst, 'reload schema';
