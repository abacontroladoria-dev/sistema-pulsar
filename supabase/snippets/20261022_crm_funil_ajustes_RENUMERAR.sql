-- Renumera crm_funil_ajustes no livro-caixa: 20261022150000 → 20261022150100.
--
-- Dois arquivos nasceram com a mesma versão em 22/10/2026:
-- 20261022150000_crm_funil_ajustes.sql (aplicada) e
-- 20261022150000_escola_preenchida_pela_equipe.sql (de outra frente, ainda
-- não aplicada). Com a versão no livro-caixa apontando para a do funil, um
-- `supabase db push` daria a da escola como aplicada e a pularia em silêncio.
-- A do funil foi renumerada no repo para 20261022150100; aqui o livro-caixa
-- acompanha. Não reaplica nada: as funções já estão no banco.
begin;

update supabase_migrations.schema_migrations
   set version = '20261022150100'
 where version = '20261022150000'
   and name    = 'crm_funil_ajustes';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022150000') then
    raise exception 'a versão 20261022150000 ainda está ocupada — nada foi alterado';
  end if;
  if not exists (select 1 from supabase_migrations.schema_migrations
                  where version = '20261022150100' and name = 'crm_funil_ajustes') then
    raise exception 'crm_funil_ajustes não ficou em 20261022150100 — nada foi alterado';
  end if;
end $$;

commit;

-- Conferência (só leitura): 150000 livre para a da escola, 150100 = funil.
select version, name from supabase_migrations.schema_migrations
 where version like '2026102215%' order by version;
