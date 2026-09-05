-- ============================================================================
-- APLICAR: o filtro de especialidade passa a ser por NOME
--
-- Empacota as duas migrations de 05/09/2026 e as registra no livro-caixa:
--   20260905100000  listar_vagas_disponiveis ganha p_terapia_nomes
--   20260905100100  listar_nomes_de_terapia_com_vaga (nova)
--
-- ⚠ APLICAR JUNTO DO DEPLOY DO FRONTEND.
--
-- A primeira DROPA e recria listar_vagas_disponiveis (assinatura nova). Entre
-- este snippet e o deploy, /api/central/appointments/availability recebe
-- PGRST202 ("function not found") e a tela de Agendamentos para. Fora do horário
-- de atendimento, ou junto.
--
-- POR QUE
--
-- `terapia_id` não identifica a terapia. Medido em produção, 05/09/2026:
--
--   2317  'Aplicador ABA (PS)'                       135 vagas
--   2317  'Aplicador ABA (PS), Psicologia'            12
--   2317  'Aplicador ABA (PS), Psicologia ABA'        21
--   2259  'Psicologia'                                61
--
-- `terapia_nome` é a lista do que o profissional atende naquele horário. Então
-- filtrar por id erra nos dois sentidos: 2317 traz 135 vagas de quem só aplica
-- ABA junto com as de psicologia; 2259 esconde as 12 de psicologia que vivem sob
-- 2317. E há duas línguas para a mesma terapia — o TiTa grava 'Aplicador ABA
-- (PS)', o laudo do responsável diz 'Psicologia ABA' (218 vagas inalcançáveis
-- para quem as procurava pelo nome que tem em mãos).
--
-- Reexecutável: as duas são create-or-replace, e o insert no livro-caixa tem
-- on conflict do nothing.
--
-- Rodar 20260905_contraprova_terapia_por_nome.sql DEPOIS.
-- ============================================================================

begin;

-- ============================================================================
-- 20260905100000 — listar_vagas_disponiveis com p_terapia_nomes
-- ============================================================================

-- O DROP é REQUISITO, não limpeza: `create or replace` com assinatura nova
-- criaria uma SEGUNDA função sobrecarregada (todos os parâmetros têm default), e
-- o PostgREST responderia PGRST203 a TODA consulta de disponibilidade. E o drop
-- apaga os grants — o grant no fim é obrigatório.
drop function if exists central.listar_vagas_disponiveis(
  date, date, bigint, bigint, text, integer
);

create or replace function central.listar_vagas_disponiveis(
  p_data_inicio     date    default null,
  p_data_fim        date    default null,
  p_terapia_id      bigint  default null,
  p_profissional_id bigint  default null,
  p_unidade         text    default null,
  p_terapia_nomes   text[]  default null,
  p_limite          integer default 50
)
returns table (
  data              date,
  dia_semana        text,
  hora_inicial      time,
  hora_final        time,
  profissional_id   bigint,
  profissional_nome text,
  terapia_id        bigint,
  terapia_nome      text,
  unidade_id        bigint,
  unidade_nome      text,
  sala_nome         text,
  unidade           text,
  e_sala_numerada   boolean
)
language plpgsql
stable
set search_path = public, central
as $$
declare
  v_agora  timestamp := now() at time zone 'America/Sao_Paulo';
  v_inicio date;
  v_fim    date;
begin
  if p_unidade is not null
     and p_unidade not in ('Realengo', 'Fazendinha', 'Padre Miguel') then
    raise exception
      'p_unidade inválida: %. Valores aceitos: Realengo, Fazendinha, Padre Miguel.',
      p_unidade
      using errcode = '22023';
  end if;

  -- Array vazio é bug de chamador (um de-para que não achou nada e mandou a
  -- lista vazia mesmo assim). Sem esta guarda ele se comporta como "sem filtro"
  -- e devolve a agenda inteira: o responsável receberia horários de qualquer
  -- especialidade achando que pediu a dele.
  if p_terapia_nomes is not null and cardinality(p_terapia_nomes) = 0 then
    raise exception
      'p_terapia_nomes veio vazio. Passe null para não filtrar por especialidade, ou os nomes que a grade usa.'
      using errcode = '22023';
  end if;

  v_inicio := coalesce(p_data_inicio, v_agora::date);
  v_fim    := coalesce(p_data_fim,    v_agora::date + 30);

  return query
  select
    v.data, v.dia_semana, v.hora_inicial, v.hora_final,
    v.profissional_id, v.profissional_nome,
    v.terapia_id, v.terapia_nome,
    v.unidade_id, v.unidade_nome, v.sala_nome,
    v.unidade, v.e_sala_numerada
  from central.vw_vagas_livres v
  where v.data >= v_inicio
    and v.data <= v_fim
    and (v.data > v_agora::date or v.hora_inicial > v_agora::time)
    and (p_terapia_id      is null or v.terapia_id      = p_terapia_id)
    and (p_profissional_id is null or v.profissional_id = p_profissional_id)
    and (p_unidade         is null or v.unidade         = p_unidade)
    -- Igualdade de PARTE, não ILIKE '%...%'. Substring contaria
    -- 'Arteterapia (Psicologia ABA)' como Psicologia ABA (terapia errada) e
    -- juntaria 'Aplicador ABA (PS)' com 'Aplicador ABA (SF)' (180 vagas).
    and (
      p_terapia_nomes is null
      or exists (
        select 1
        from unnest(string_to_array(v.terapia_nome, ',')) as parte
        where btrim(parte) = any (p_terapia_nomes)
      )
    )
    and not exists (
      select 1
      from central.appointments ap
      where ap.profissional_id = v.profissional_id
        and ap.date            = v.data
        and ap.time            = v.hora_inicial
        and ap.status in ('scheduled', 'confirmed')
    )
  order by v.data, v.hora_inicial, v.profissional_nome
  limit greatest(1, least(coalesce(p_limite, 50), 500));
end;
$$;

comment on function central.listar_vagas_disponiveis(date, date, bigint, bigint, text, text[], integer) is
  'Vagas ofertáveis: central.vw_vagas_livres menos as já prometidas em central.appointments, menos o passado. p_unidade filtra NO BANCO para o teto de 500 valer por unidade. p_terapia_nomes filtra por NOME da especialidade, casando por PARTE do nome-lista (terapia_nome é a lista do que o profissional atende naquele horário) — necessário porque terapia_id NÃO identifica a terapia: o id 2317 aparece com sete nomes diferentes, então filtrar por ele mistura quem só aplica ABA com quem faz psicologia, e esconde as 12 vagas de psicologia que vivem sob 2317. O de-para do nome que o responsável usa (o do laudo, "Psicologia ABA") para o que a grade grava ("Aplicador ABA (PS)") vive em frontend/modules/atendimento/agente/terapia.ts. Fonte única para a página de Agendamentos e para o agente de WhatsApp.';

grant execute on function central.listar_vagas_disponiveis(date, date, bigint, bigint, text, text[], integer)
  to authenticated, service_role;

-- ============================================================================
-- 20260905100100 — listar_nomes_de_terapia_com_vaga
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
  select v.terapia_nome, v.unidade, count(*) as vagas
  from central.vw_vagas_livres v, janela j
  where v.data >= j.inicio
    and v.data <= j.fim
    and (v.data > j.hoje or v.hora_inicial > j.agora)
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

-- ============================================================================
-- LIVRO-CAIXA
-- ============================================================================

insert into supabase_migrations.schema_migrations (version)
values ('20260905100000'), ('20260905100100')
on conflict (version) do nothing;

commit;
