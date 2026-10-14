-- Quem está online (controladoria): o navegador de quem está logado avisa o servidor a cada minuto
-- e o site guarda a hora do último sinal. Online = sinal nos últimos 2 minutos. "Sair" limpa o campo.
-- Rode uma vez no SQL Editor do Supabase.

alter table madeireiras.operadores add column if not exists visto_em timestamptz;

notify pgrst, 'reload schema';
