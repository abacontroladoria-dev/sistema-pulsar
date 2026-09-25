-- Rodar no SQL Editor do Supabase (projeto de produção). Idempotente.
-- Espelho de migrations/20260925100000_conferencia_guias_faltas.sql
begin;

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

-- O PostgREST precisa ver a função nova.
notify pgrst, 'reload schema';

commit;
