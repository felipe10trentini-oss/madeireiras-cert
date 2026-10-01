-- Acessos ao SEI dos responsáveis técnicos (aba ACESSO SEI da Planilha Geral).
-- A senha fica cifrada (AES-256-GCM) pelo servidor do site; o banco nunca vê a senha em texto.
create table if not exists madeireiras.acessos_sei (
  id bigint generated always as identity primary key,
  nome text not null,             -- "LOGIN RESP." da planilha (ex.: Carolina Hampel)
  funcao text,                    -- Resp. Técnico / Resp. Legal
  empresa text,                   -- coluna EMPRESA (quando a pessoa é de uma empresa só)
  login text not null,            -- e-mail de acesso ao SEI
  senha_cifrada text not null,
  updated_at timestamptz not null default now()
);

alter table madeireiras.acessos_sei enable row level security;
grant all on madeireiras.acessos_sei to service_role;
grant all on all sequences in schema madeireiras to service_role;
