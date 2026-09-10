-- Dá ao papel `marketing` a escrita nos avisos da TV.
--
-- A RLS de tv_avisos e as 4 policies do bucket nasceram (20260831150000) com
-- `usuario_tem_permissao('tv_avisos') or remuneracao_has_role(['admin','diretoria'])`,
-- porque naquele momento o setor marketing não existia como papel. Agora existe
-- (20260910120000) e entra no ramo por papel.
--
-- ─── Por que pelo PAPEL e não só por usuarios_permissoes ─────────────────────
--
-- O código `tv_avisos` concedido usuário a usuário continua funcionando e não é
-- removido daqui. Mas deixar SÓ ele significaria que todo usuário novo do
-- marketing precisa de uma concessão manual em /admin/permissoes — e o modo como
-- essa falha aparece é o problema: RLS recusando WRITE não estoura erro visível
-- no Storage. O upload "funciona", a imagem some ao recarregar, e quem publicou
-- o cartaz não tem como saber que o que faltou foi um clique num outro lugar.
--
-- Pelo papel, criar o usuário já basta.
--
-- ⚠️ AO APLICAR: storage.objects pertence a supabase_storage_admin. Se o SQL
-- Editor recusar o bloco do bucket com "must be owner of table objects", recrie
-- as 4 policies pelo Dashboard (Storage > tv-avisos > Policies) usando
-- EXATAMENTE as mesmas expressões abaixo. O bloco da TABELA roda normal.

-- ===== RLS da tabela =====

do $$
declare
  pol record;
  cond constant text :=
    '(public.usuario_tem_permissao(''tv_avisos'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'',''marketing'']))';
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'tv_avisos'
  loop
    execute format('drop policy %I on public.tv_avisos', pol.policyname);
  end loop;

  execute format(
    'create policy tv_avisos_select on public.tv_avisos'
    || ' for select to authenticated using (%s)', cond);
  execute format(
    'create policy tv_avisos_insert on public.tv_avisos'
    || ' for insert to authenticated with check (%s)', cond);
  execute format(
    'create policy tv_avisos_update on public.tv_avisos'
    || ' for update to authenticated using (%s) with check (%s)', cond, cond);
  execute format(
    'create policy tv_avisos_delete on public.tv_avisos'
    || ' for delete to authenticated using (%s)', cond);
end $$;

-- ===== Policies do bucket =====
--
-- O SELECT continua `to public` e sem condição de papel: é ele que permite a TV
-- da recepção, que roda SEM CONTA, abrir a imagem. Público para LER nunca foi
-- público para ESCREVER — as três policies de escrita abaixo é que mudam.

drop policy if exists "tv_avisos_objects_insert" on storage.objects;
drop policy if exists "tv_avisos_objects_update" on storage.objects;
drop policy if exists "tv_avisos_objects_delete" on storage.objects;

create policy "tv_avisos_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  );

create policy "tv_avisos_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  )
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  );

create policy "tv_avisos_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  );
