-- Quem já começou tratamento DE VERDADE pela grade da TiTa — para o card "Sem
-- contrato" da Status Contratos (frontend/lib/contratos/filtros.ts).
--
-- Decisão do usuário (08/10/2026): a cobrança de contrato de Terapias não vale
-- enquanto o paciente só teve Triagem (avaliação de entrada). Ele ainda não é
-- "tratamento terapêutico" — é o passo anterior. Por isso "Sem contrato" não
-- pode usar só "tem agendamento" (`grade_convenio_por_paciente`, que conta
-- Triagem igual a qualquer outra terapia): precisa saber se ALGUMA das sessões
-- do paciente é de verdade.
--
-- Mesma fonte de `grade_convenio_por_paciente` (20260930140000):
-- vw_grade_atendimentos, unidade 280, security_invoker. Função PRÓPRIA, e não
-- uma coluna a mais naquela: esta responde "tem terapia real?", aquela
-- responde "qual o convênio?" — perguntas diferentes, chamadores diferentes.
--
-- Casamento de "Triagem" por `normalizar_nome_terapia()` (20261006120000) — a
-- MESMA função que casa `terapia_nome` da grade com o Cadastro de Terapias, e
-- não um `lower(btrim(...))` próprio: ela também tira acento, e o catálogo tem
-- exatamente UMA terapia chamada "Triagem" (nome_normalizado = 'triagem',
-- seed de 20261006150000) — não há variante tipo "Triagem ABA" para perder.
--
-- Só pede o paciente que TEM pelo menos uma sessão não-Triagem; ausência do
-- paciente no resultado = só teve Triagem (ou nenhuma sessão, ou terapia_nome
-- nulo — não é prova de tratamento real). Comparar com o conjunto de quem tem
-- agendamento (`grade_convenio_por_paciente`) decide os três casos que a tela
-- precisa diferenciar:
--
--   sem agendamento nenhum          → cobra contrato (decisão do usuário)
--   agendamento só de Triagem       → NÃO cobra (este é o caso que esta função resolve)
--   agendamento com terapia real    → cobra contrato
create or replace function public.grade_pacientes_com_terapia_real()
returns table (
  paciente_id bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct g.paciente_id::bigint
  from public.vw_grade_atendimentos g
  where g.unidade_id = 280
    and g.paciente_id is not null
    and g.terapia_nome is not null
    and public.normalizar_nome_terapia(g.terapia_nome) <> 'triagem'
$$;

comment on function public.grade_pacientes_com_terapia_real() is
  'Pacientes (paciente_id = ID Favorecido) com pelo menos uma sessão NÃO-Triagem na grade da TiTa, unidade 280. Ausência = só teve Triagem (ou nenhuma sessão). Usado por "Sem contrato" na Status Contratos para não cobrar contrato de quem ainda está em avaliação de entrada. Só service_role.';

revoke all on function public.grade_pacientes_com_terapia_real() from public, anon, authenticated;
grant execute on function public.grade_pacientes_com_terapia_real() to service_role;
