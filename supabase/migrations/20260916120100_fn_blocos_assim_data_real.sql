-- =============================================================================
-- fn_blocos_assim passa a enxergar a sessão adiantada
-- =============================================================================
-- Continuação de 20260916120000. Duas mudanças, e só duas:
--
--   1. A exceção nomeada no anti-join de falta: `f.data_atendimento_real is
--      null`. Sessão com data real registrada não é falta — houve atendimento,
--      em outro dia —, então ela não deve ser removida. O filtro segue intacto
--      para todas as outras faltas.
--
--   2. A função devolve `data_atendimento_real`, porque a guarda 6 de
--      vincular_autorizacao (20260821000000:628-632) lê o registro que vem
--      daqui. Sem a coluna, a exceção do item 1 traria o bloco de volta à tela e
--      a gravação continuaria recusando — a pior falha possível aqui é a tela
--      oferecer o que a escrita rejeita.
--
-- O bloco_id NÃO muda: continua montado sobre data_atendimento (a data da
-- AGENDA). Ele é a identidade da sessão na grade, referenciado por
-- autorizacoes_vinculos e auditoria_situacao_overrides. Trocá-lo pela data real
-- órfãria todo vínculo e todo override já gravados.
--
-- A CTE agenda_sem_falta é cópia fiel da de get_auditoria_assim_periodo por
-- desenho (20260821000000:156-168). A migration irmã 20260916120200 aplica a
-- MESMA exceção lá. As duas mudam juntas ou divergem.
--
-- O cast `f.paciente_id = a.paciente_id::text` é preservado como está: ele é a
-- correção medida de 20260824020000 (48.850 ms → sondagem de índice). Não
-- unificar com o cast oposto de get_auditoria_assim_periodo aqui; é outra
-- decisão, já anotada naquele arquivo (linhas 78-85).
-- =============================================================================

drop function if exists public.fn_blocos_assim(date, date);

create or replace function public.fn_blocos_assim(p_de date, p_ate date)
returns table (
  bloco_id              text,
  paciente_id           bigint,
  paciente_nome         text,
  empresa               text,
  matricula             text,
  dep                   text,
  data_atendimento      date,
  data_atendimento_real date,
  hora_inicial          time without time zone,
  codigo_tuss           text,
  convenio_nome         text,
  terapias              text,
  profissionais         text,
  quantidade_sessoes    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with agenda_tita_tuss as (
    select
      at.paciente_id,
      at.paciente_nome,
      at.data_atendimento,
      at.hora_inicial,
      at.terapia_nome,
      at.terapia_exibicao_nome,
      at.profissional_nome,
      at.convenio_nome,
      substring(at.numero_carteirinha, 1, 6)                         as empresa,
      substring(at.numero_carteirinha, 7, 7)                         as matricula,
      right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2) as dep,
      public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) as codigo_tuss
    from public.agenda_tita at
    where at.data_atendimento between p_de and p_ate
      and at.ativo = true
      and at.convenio_nome ilike '%assim%'
      and at.paciente_nome <> all (array['Horário Administrativo','Notificação Prévia'])
  ),
  agenda_filtrada as (
    select a.* from agenda_tita_tuss a
    where a.codigo_tuss is not null
      and not exists (
        select 1 from public.config_regras_terapias r
        where r.categoria = 'BLACKLIST_AUTORIZACAO'
          and r.ativo = true
          and a.terapia_nome ilike ('%' || r.terapia_nome || '%')
      )
  ),
  agenda_sem_falta as (
    select a.* from agenda_filtrada a
    where not exists (
      select 1 from public.fila_autorizacoes f
      -- O cast está sobre a coluna da AGENDA, não sobre a da fila. Invertido, o
      -- planner perde `paciente_id` como chave de junção, sobra só
      -- `data_atendimento` (7 valores distintos numa semana), e o merge join
      -- rebobina o lado interno 19 vezes — 119.712 linhas para descartar 114.012.
      -- Deste lado, as três igualdades casam com unique_fila_agendamento.
      where f.paciente_id = a.paciente_id::text
        and f.data_atendimento = a.data_atendimento
        and f.horario = a.hora_inicial
        -- Sessão adiantada não é falta: houve atendimento, em outra data. Ela
        -- volta à Conferência para poder receber o vínculo da guia órfã
        -- (20260916120000).
        and f.data_atendimento_real is null
        and (
          -- Linha em 'glosa' não é falta: o motivo por extenso pode conter a
          -- palavra FALTA ("FALTA DE COBERTURA CONTRATUAL") e a sessão sumiria
          -- da tela justamente quando mais precisa ser vista. Guarda idêntica à
          -- da RPC (20260820150000:211-218).
          (f.status is distinct from 'glosa'
           and upper(coalesce(f.status_assim, '')) like '%FALTA%')
          or upper(coalesce(f.tipo_falta, '')) like '%PACIENTE%'
          or upper(coalesce(f.tipo_falta, '')) like '%TERAPEUTA%'
        )
    )
      and a.terapia_nome not ilike '%Aplicador ABA Escola%'
      and a.terapia_nome not ilike '%Aplicador ABA Casa%'
      and a.terapia_nome not ilike '%Aplicador Suporte%'
      and a.terapia_nome not ilike '%Supervisão ABA%'
  )
  select
    concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) as bloco_id,
    asf.paciente_id,
    asf.paciente_nome,
    asf.empresa,
    asf.matricula,
    asf.dep,
    asf.data_atendimento,
    -- A data real da linha daquela sessão. Lateral porque a fila pode ter mais
    -- de uma linha para o mesmo horário quando o TUSS difere; pega a mais
    -- recente, como faz get_candidatas_vinculo (20260821000000:506-515).
    dr.data_atendimento_real,
    asf.hora_inicial,
    asf.codigo_tuss,
    asf.convenio_nome,
    string_agg(distinct asf.terapia_exibicao_nome, ' | ' order by asf.terapia_exibicao_nome) as terapias,
    string_agg(distinct asf.profissional_nome,     ' | ' order by asf.profissional_nome)     as profissionais,
    count(*) as quantidade_sessoes
  from agenda_sem_falta asf
  left join lateral (
    select f.data_atendimento_real
    from public.fila_autorizacoes f
    where f.paciente_id      = asf.paciente_id::text
      and f.data_atendimento = asf.data_atendimento
      and f.horario          = asf.hora_inicial
      and f.data_atendimento_real is not null
    order by coalesce(f.updated_at, f.created_at) desc
    limit 1
  ) dr on true
  group by asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
           asf.data_atendimento, dr.data_atendimento_real, asf.hora_inicial,
           asf.codigo_tuss, asf.convenio_nome
$$;

comment on function public.fn_blocos_assim(date, date) is
  'Blocos da Conferência ASSIM (cópia fiel da CTE blocos_auditoria de get_auditoria_assim_periodo). Existe porque a RPC completa estoura o statement_timeout em janelas largas e a reconciliação só precisa contar sessões por partição. A checagem de falta compara paciente_id com o cast do lado da agenda (a.paciente_id::text), e não sobre f.paciente_id: assim as três igualdades casam com unique_fila_agendamento e o anti-join vira sondagem de índice. Sessão com data_atendimento_real não é removida como falta e devolve a data efetiva, que é a que vincular_autorizacao usa na janela.';

grant execute on function public.fn_blocos_assim(date, date) to authenticated;
