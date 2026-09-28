-- Cadastro das madeireiras atendidas pela consultoria (importado da planilha
-- Madeireiras.xlsx pela aba "Madeireiras" do site).
create table if not exists madeireiras (
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
  -- volume de cada câmara...). Gravado pelo site; a planilha não sobrescreve.
  relatorio jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table madeireiras enable row level security;

-- A API só é acessada pelo backend com a service role key, que ignora RLS.
-- Nenhuma policy é criada de propósito: sem policy = sem acesso via chave anon.
