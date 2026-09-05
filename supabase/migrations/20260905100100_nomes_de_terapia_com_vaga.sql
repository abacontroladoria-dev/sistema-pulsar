-- ============================================================================
-- central.listar_nomes_de_terapia_com_vaga
--
-- Os NOMES distintos de especialidade que têm vaga na janela, com a unidade de
-- cada um. Substitui, para o agente, o papel de
-- central.contar_vagas_por_terapia_e_unidade (20260904100200).
--
-- POR QUE NÃO AGREGA POR terapia_id
--
-- Porque o id não identifica a terapia. Medido em produção (05/09/2026):
--
--   2317  'Aplicador ABA (PS)'                       135 vagas
--   2317  'Aplicador ABA (PS), Psicologia'            12
--   2317  'Aplicador ABA (PS), Psicologia ABA'        21
--   2317  'Aplicador ABA (PS), Supervisão ABA'         5
--   2260  'Aplicador ABA (AE), Aplicador ABA (HS), Psicopedagogia'  63
--
-- `terapia_nome` é a LISTA do que aquele profissional atende naquele horário. Um
-- `group by terapia_id` colapsa essas linhas numa só e escolhe UM dos nomes,
-- perdendo exatamente a distinção que interessa — e foi assim que o agente
-- passou a afirmar "temos fono, mas só em Realengo" sobre uma agregação que não
-- correspondia à especialidade nenhuma.
--
-- Aqui o agrupamento é por (nome, unidade). Quem traduz esses nomes crus para o
-- vocabulário que o responsável entende — e quem decide o que é ofertável — é
-- frontend/modules/atendimento/agente/terapia.ts. A divisão é deliberada: o
-- banco responde o que a grade TEM; o catálogo decide o que se OFERECE e como se
-- chama. Misturar os dois põe regra de atendimento numa migration, onde ela não
-- pode ser revista sem DDL.
--
-- SEM TETO DE LINHAS
--
-- O resultado é da ordem de dezenas de linhas (nomes distintos × 3 unidades),
-- não de milhares. É o mesmo argumento de 20260904100200: um `group by` não
-- precisa de `limit`, e o teto de 500 sobre uma AMOSTRA era o defeito que aquela
-- migration consertou — uma terapia que só tinha vaga a partir da linha 501
-- aparecia com as unidades erradas.
--
-- contar_vagas_por_terapia_e_unidade NÃO é dropada: nada mais a chama depois
-- deste deploy, mas ela é aditiva e barata, e dropar função em uso é o tipo de
-- coisa que só se descobre em produção. Fica para uma limpeza deliberada.
--
-- ROLLBACK: drop function if exists central.listar_nomes_de_terapia_com_vaga(date, date);
-- ============================================================================

create or replace function central.listar_nomes_de_terapia_com_vaga(
  p_data_inicio date default null,
  p_data_fim    date default null
)
returns table (
  terapia_nome text,
  unidade      text,
  vagas        bigint
)
language sql
stable
set search_path = public, central
as $$
  with janela as (
    select
      coalesce(p_data_inicio, (now() at time zone 'America/Sao_Paulo')::date)      as inicio,
      coalesce(p_data_fim,    (now() at time zone 'America/Sao_Paulo')::date + 30) as fim,
      (now() at time zone 'America/Sao_Paulo')::date as hoje,
      (now() at time zone 'America/Sao_Paulo')::time as agora
  )
  select
    v.terapia_nome,
    v.unidade,
    count(*) as vagas
  from central.vw_vagas_livres v, janela j
  where v.data >= j.inicio
    and v.data <= j.fim
    -- Mesma regra de listar_vagas_disponiveis: no dia corrente, descarta o que
    -- já passou. Sem isso o agente afirma que a especialidade tem vaga hoje com
    -- base num horário das 09h20 às 14h.
    and (v.data > j.hoje or v.hora_inicial > j.agora)
    -- A vaga já prometida não conta como disponível. A regra vive em
    -- central.appointments, e repeti-la aqui é o preço de as duas RPCs
    -- responderem sobre o mesmo conjunto — se divergirem, o agente diz que
    -- existe especialidade cuja consulta de horários vem vazia.
    and not exists (
      select 1
      from central.appointments ap
      where ap.profissional_id = v.profissional_id
        and ap.date            = v.data
        and ap.time            = v.hora_inicial
        and ap.status in ('scheduled', 'confirmed')
    )
  group by v.terapia_nome, v.unidade
  order by v.terapia_nome, v.unidade;
$$;

comment on function central.listar_nomes_de_terapia_com_vaga(date, date) is
  'Nomes distintos de especialidade com vaga na janela, por unidade. Agrupa por NOME e não por terapia_id porque o id não identifica a terapia: 2317 aparece com sete terapia_nome diferentes, e um group by id colapsaria "Aplicador ABA (PS)" com "Aplicador ABA (PS), Psicologia". O nome vem CRU (língua da escala do TiTa); a tradução para o que o responsável entende, e a decisão do que é ofertável, vivem em frontend/modules/atendimento/agente/terapia.ts.';

grant execute on function central.listar_nomes_de_terapia_com_vaga(date, date)
  to authenticated, service_role;
