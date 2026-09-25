-- =============================================================================
-- Conferência de Guias: faltas pela mesma porta da tela
-- =============================================================================
-- A folha mostra as faltas (a recepção escreve "falta" na linha do papel, e a
-- numeração da tela tem de bater com a dele). Elas vinham direto de
-- get_faltas_auditoria_assim, que é LANGUAGE sql sem SECURITY DEFINER: roda
-- como o usuário e lê fila_autorizacoes sob a RLS dele. Quem entra na tela só
-- pela permissão `conferencia_guias` (sem papel nas policies da fila) recebia
-- ZERO faltas sem erro nenhum, e as linhas se renumeravam caladas — o mesmo
-- modo de falha de 20260922200000.
--
-- Este wrapper DEFINER faz o mesmo portão de get_conferencia_guias_dia e
-- devolve a mesma função, sem reescrever a regra dela (que substituição,
-- feriado e adiantamento já editam por texto — ver 20260922240000).
--
-- Aplicar pelo SQL Editor: supabase/snippets/20260925_conferencia_guias_faltas_APLICAR.sql
-- =============================================================================

create or replace function public.get_conferencia_guias_faltas_dia(p_data date)
returns table (
  fila_id             uuid,
  paciente_id         text,
  paciente_nome       text,
  data_atendimento    date,
  hora_inicial        time,
  tuss                text,
  terapia_nome        text,
  tipo_falta          text,
  profissional_nome   text,
  motivo_falta        text,
  justificativa_falta text
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '15s'
as $$
begin
  if not (public.usuario_tem_permissao('conferencia_guias')
          or public.remuneracao_has_role(array['admin', 'faturamento'])) then
    raise exception 'sem permissão para a Conferência de Guias' using errcode = '42501';
  end if;

  return query select * from public.get_faltas_auditoria_assim(p_data);
end;
$$;

comment on function public.get_conferencia_guias_faltas_dia(date) is
  'Faltas do dia para a Conferencia de Guias: get_faltas_auditoria_assim atras do portao da tela (DEFINER), para a RLS da fila nao zerar as faltas de quem so tem a permissao conferencia_guias.';

revoke all on function public.get_conferencia_guias_faltas_dia(date) from public, anon;
grant execute on function public.get_conferencia_guias_faltas_dia(date) to authenticated;
