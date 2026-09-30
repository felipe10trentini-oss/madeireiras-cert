-- Login por operador, registro das emissões (controladoria) e configurações da planilha de cadastro.
-- Rodar uma vez no SQL Editor do Supabase (projeto "Certificado SEI", schema madeireiras).

-- Configurações por empresa vindas da planilha de cadastro (lote, ciclo, tomador fixo, DR...).
alter table madeireiras.empresas add column if not exists config jsonb not null default '{}'::jsonb;

create table if not exists madeireiras.operadores (
  id bigint generated always as identity primary key,
  login text not null unique,              -- guardado em minúsculas
  nome text not null,
  senha_hash text not null,                -- scrypt: "scrypt$<sal>$<hash>"
  perfil text not null default 'operador' check (perfil in ('operador', 'master')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists madeireiras.emissoes (
  id bigint generated always as identity primary key,
  operador_id bigint references madeireiras.operadores (id),
  operador_login text not null,
  empresa_cnpj text not null,
  empresa_apelido text not null,
  numero_certificado text,
  tipo text,                               -- KD | HT | AQF
  lote text,
  ciclo text,
  data_tratamento text,                    -- dd/mm/aaaa (início)
  divergencias jsonb,                      -- divergências que o operador marcou como conferidas
  created_at timestamptz not null default now()
);
create index if not exists emissoes_created_at on madeireiras.emissoes (created_at desc);
create index if not exists emissoes_operador on madeireiras.emissoes (operador_login, created_at desc);

alter table madeireiras.operadores enable row level security;
alter table madeireiras.emissoes enable row level security;

-- Só o backend (service role) acessa; sem policies = sem acesso pela chave anon.
grant all on all tables in schema madeireiras to service_role;
grant all on all sequences in schema madeireiras to service_role;
