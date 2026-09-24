-- RLS de previsao_receitas_faturamento. Mesmo padrão de
-- laudos_acompanhamento (20260828150000): permissão nova
-- `indicadores_alimentar_bd` (seed em 20260923140200) OU papel admin/diretoria
-- — usuario_tem_permissao() ignora roleDefaults do frontend e IGNORA quem tem
-- a tela só por papel, então o ramo por papel é obrigatório aqui também.
--
-- ⚠️ RLS bloqueando WRITE não gera erro visível no frontend: a gravação
-- "funciona" e não grava. Se o save não persistir, suspeitar daqui ANTES do
-- frontend.
--
-- Sem policy de DELETE: registro financeiro não se apaga — uma correção é uma
-- nova linha ou uma edição, nunca um delete.

alter table public.previsao_receitas_faturamento enable row level security;

do $$
declare
  pol record;
  cond constant text :=
    '(public.usuario_tem_permissao(''indicadores_alimentar_bd'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'']))';
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'previsao_receitas_faturamento'
  loop
    execute format('drop policy %I on public.previsao_receitas_faturamento', pol.policyname);
  end loop;

  execute format(
    'create policy previsao_receitas_faturamento_select on public.previsao_receitas_faturamento'
    || ' for select to authenticated using (%s)', cond);
  execute format(
    'create policy previsao_receitas_faturamento_insert on public.previsao_receitas_faturamento'
    || ' for insert to authenticated with check (%s)', cond);
  execute format(
    'create policy previsao_receitas_faturamento_update on public.previsao_receitas_faturamento'
    || ' for update to authenticated using (%s) with check (%s)', cond, cond);
end $$;

revoke all on public.previsao_receitas_faturamento from public;
revoke all on public.previsao_receitas_faturamento from anon;
revoke all on public.previsao_receitas_faturamento from authenticated;
grant select, insert, update on public.previsao_receitas_faturamento to authenticated;

alter table public.previsao_receitas_faturamento force row level security;
