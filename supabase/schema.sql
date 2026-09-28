-- Banco das madeireiras (consultoria). Fica no mesmo projeto Supabase do
-- certificado da Mann móvel, mas num schema próprio ("madeireiras"), separado
-- das tabelas da Mann (schema "public").
--
-- Depois de rodar: Project Settings > API > Data API > Exposed schemas -> incluir "madeireiras".

create schema if not exists madeireiras;

create table if not exists madeireiras.empresas (
  id bigint generated always as identity primary key,
  apelido text not null,
  rt text,
  uf text,
  modalidade text not null default 'Cadastrada',   -- 'Cadastrada' | 'Credenciada'
  tratamentos text not null default 'HT',          -- 'KD/HT' | 'HT' | 'KD'
  razao_social text not null,
  cnpj text not null unique,
  crea text,
  telefone text,
  endereco text,
  reg_mapa text,
  email text,
  documento text,                                  -- 'programacao' | 'comunicado'
  unidade_volumes text,                            -- 'Fardos', 'Tábuas'...
  -- Dados do relatório do MAPA que se repetem (processo da programação, RT,
  -- volume de cada câmara...). Gravado pelo site.
  relatorio jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table madeireiras.empresas enable row level security;

-- Só o backend (service role) acessa; sem policies = sem acesso pela chave anon.
grant usage on schema madeireiras to service_role;
grant all on all tables in schema madeireiras to service_role;
grant all on all sequences in schema madeireiras to service_role;
alter default privileges in schema madeireiras grant all on tables to service_role;
alter default privileges in schema madeireiras grant all on sequences to service_role;
