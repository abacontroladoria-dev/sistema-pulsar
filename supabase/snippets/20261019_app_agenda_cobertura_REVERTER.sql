-- REVERTE 20261019210000_app_agenda_cobertura. sp_grade_pode_evoluir e
-- sp_grade_exigir_evoluir voltam exatamente como estavam em PRODUÇÃO em
-- 19/10/2026 (pg_get_functiondef): só admin evolui. Apaga as coberturas e o
-- histórico das ações de cobertura (a constraint antiga não as aceita).
begin;
set local lock_timeout = '5s';

drop trigger if exists trg_grade_evolucoes_regras_terapeuta on public.grade_evolucoes;
drop function if exists public.sp_grade_evolucoes_regras_terapeuta();
drop function if exists public.app_agenda(date, date, bigint);
drop function if exists public.app_agenda_profissionais();
drop function if exists public.grade_definir_cobertura(uuid, bigint);
drop function if exists public.grade_remover_cobertura(uuid);

CREATE OR REPLACE FUNCTION public.sp_grade_pode_evoluir(p_agendamento_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    return false;
  end if;
  -- Regra atual: apenas 'admin' pode evoluir (nem diretoria pode).
  return public.sp_grade_eh_admin();
end $function$
;

CREATE OR REPLACE FUNCTION public.sp_grade_exigir_evoluir(p_agendamento_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.sp_grade_pode_evoluir(p_agendamento_id) then
    raise exception 'Apenas administradores podem evoluir ou registrar falta na Grade por enquanto.'
      using errcode = '42501';
  end if;
end $function$
;

drop table if exists public.grade_coberturas;

delete from public.grade_eventos where acao in ('cobertura_definida', 'cobertura_removida');
alter table public.grade_eventos drop constraint if exists grade_eventos_acao_check;
alter table public.grade_eventos add constraint grade_eventos_acao_check check (acao in (
  'criado', 'excluido', 'serie_encerrada', 'estendido', 'importado', 'bloqueio_criado',
  'bloqueio_excluido', 'inativacao_profissional', 'evoluido', 'evolucao_editada',
  'falta_registrada', 'evolucao_removida'
));

delete from supabase_migrations.schema_migrations where version = '20261019210000';

commit;

select pg_get_functiondef('public.sp_grade_pode_evoluir(uuid)'::regprocedure) not like '%grade_coberturas%' as pode_evoluir_original,
       to_regclass('public.grade_coberturas') is null as coberturas_removida;
