-- Ocupação Clínica (Indicadores › ?tab=unidades): feriados da semana para
-- QUEM TEM A ABA, não só para os papéis que leem a tabela.
--
-- A tela tira do cálculo os horários fechados por feriado (a grade do TiTa
-- continua mostrando as sessões recorrentes desses dias). A leitura direta de
-- public.feriados é limitada por RLS aos papéis rp/admin/diretoria/terapeutico;
-- como os grupos de permissão são aditivos, alguém com a aba liberada por
-- override veria a mesma semana com outros números. Esta função devolve só o
-- que o cálculo usa, a quem tem `indicadores_ocupacao_unidades`.
--
-- Feriado não é dado sensível; a trava é só para não abrir a RPC a qualquer
-- login. Idempotente (create or replace), sem dependência de ordem.

create or replace function public.ocupacao_clinica_feriados(p_de date, p_ate date)
returns table (data date, nome text, tipo text, horario_inicio text, horario_fim text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.usuario_tem_permissao('indicadores_ocupacao_unidades') then
    raise exception 'Sem permissão para a Ocupação Clínica.' using errcode = '42501';
  end if;
  if p_ate < p_de or p_ate - p_de > 31 then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  return query
  select f.data, f.nome, f.tipo, f.horario_inicio, f.horario_fim
  from public.feriados f
  where f.data between p_de and p_ate
  order by f.data;
end $$;

revoke all on function public.ocupacao_clinica_feriados(date, date) from public, anon;
grant execute on function public.ocupacao_clinica_feriados(date, date) to authenticated;
