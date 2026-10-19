-- Texto clínico da evolução só para quem pode evoluir (hoje: admin).
--
-- Problema (20261016180000): grade_detalhe_evolucao liberava a leitura completa
-- para qualquer usuário com permissão na Grade (cai em sp_grade_exigir_permissao
-- quando não é admin) e devolvia descricao_evolucao e o carimbo. A tela esconde o
-- painel de quem não é admin, mas a função é chamável direto pela API.
--
-- Correção: a função original vira auxiliar interna (sem acesso de usuário) e
-- grade_detalhe_evolucao passa a ser um invólucro que, para quem não pode evoluir,
-- zera descricao_evolucao e carimbo. Os demais campos (status, falta da recepção,
-- quem evoluiu, data/hora) continuam, pois a Grade precisa deles para o selo.
-- A regra fica em sp_grade_pode_evoluir: quando o profissional ganhar acesso à
-- própria agenda, é lá que se libera.

alter function public.grade_detalhe_evolucao(uuid) rename to sp_grade_detalhe_evolucao_interno;

revoke all on function public.sp_grade_detalhe_evolucao_interno(uuid) from public, anon, authenticated;

create or replace function public.grade_detalhe_evolucao(p_agendamento_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb := public.sp_grade_detalhe_evolucao_interno(p_agendamento_id);
begin
  if public.sp_grade_pode_evoluir(p_agendamento_id) then
    return v;
  end if;

  return v || jsonb_build_object(
    'descricao_evolucao', null,
    'carimbo', null
  );
end $$;

revoke all on function public.grade_detalhe_evolucao(uuid) from public, anon;
grant execute on function public.grade_detalhe_evolucao(uuid) to authenticated;
