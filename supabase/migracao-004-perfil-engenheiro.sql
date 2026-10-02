-- Perfil Engenheiro(a) para os logins do site (rodado em 02/10/2026).
alter table madeireiras.operadores drop constraint if exists operadores_perfil_check;
alter table madeireiras.operadores add constraint operadores_perfil_check check (perfil in ('operador', 'engenheiro', 'master'));

-- Cargo do colaborador, separado do perfil de acesso (rodado em 02/10/2026).
alter table madeireiras.operadores add column if not exists cargo text;
update madeireiras.operadores set cargo = 'Engenheiro(a)', perfil = 'operador' where perfil = 'engenheiro';
