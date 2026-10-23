-- Sala → unidade e modalidade (Fase 0 de docs/PLANO_INTEGRACAO_FATURAMENTO.md,
-- 23/10/2026).
--
-- O faturamento rateia por unidade e separa a modalidade (Clínica, AT Externo,
-- Terceirizada). A modalidade vem da TERAPIA primeiro
-- (cadastro_terapias.modalidade, 20261023180100); a sala é o que sobra, e a
-- unidade só existe para Clínica.
--
-- Medido em produção (23/10): as DUAS grades gravam a sala no mesmo formato do
-- TiTa — "Unid. Realengo - Sala 18 (Coordenação de caso)", "AT Externo Escola",
-- "Unid. Terceirizada - Equoterapia em Movimento (Campo Grande)". A grade nova
-- (grade_agendamentos) tem local_id, mas vazio em 100% das linhas; por isso o
-- nome é a fonte. O resto (~800 linhas de 380 mil: "Apoio Operacional",
-- "Sala Teste", "sala 21", "Clínica") não diz unidade e volta null.
--
-- Mesma regra de parseSalaAgenda + normalizarUnidadeOcupacao
-- (frontend/lib/cronograma/salas.ts e ocupacaoProf.ts), com os nomes de unidade
-- de cronograma_salas.unidade_nome.
--
-- Funções imutáveis, sem tabela: aplicar sobre os nomes DISTINTOS, nunca linha
-- a linha numa tabela grande.
--
-- Idempotente.

create or replace function public.unidade_da_sala(p_sala text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with s as (
    select lower(translate(btrim(coalesce(p_sala, '')),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')) as n
  ), u as (
    select n, (regexp_match(n, '^unid\.?\s*([^-–—]+?)\s*[-–—]'))[1] as unid from s
  )
  select case
    when n like 'at externo%'                                 then 'AT Externo'
    when unid is null                                          then null
    when unid like '%realengo%'                                then 'Realengo'
    when unid like '%fazendinha%'                              then 'Fazendinha'
    when unid like '%padre miguel%'                            then 'Padre Miguel'
    when unid like '%terceirizada%' or unid like '%campo grande%' then 'Terceirizada - Campo Grande'
  end
  from u
$$;

comment on function public.unidade_da_sala(text) is
  'Unidade pelo nome da sala do TiTa ("Unid. Realengo - Sala 5" → Realengo; "AT Externo Escola" → AT Externo). null = o nome não diz.';

create or replace function public.modalidade_da_sala(p_sala text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case public.unidade_da_sala(p_sala)
    when 'AT Externo'                  then 'at_externo'
    when 'Terceirizada - Campo Grande' then 'terceirizada'
    when 'Realengo'                    then 'clinica'
    when 'Fazendinha'                  then 'clinica'
    when 'Padre Miguel'                then 'clinica'
  end
$$;

comment on function public.modalidade_da_sala(text) is
  'clinica | at_externo | terceirizada pelo nome da sala. Reserva: a modalidade da TERAPIA (cadastro_terapias.modalidade) prevalece. null = o nome não diz.';

revoke all on function public.unidade_da_sala(text) from public, anon;
revoke all on function public.modalidade_da_sala(text) from public, anon;
grant execute on function public.unidade_da_sala(text) to authenticated, service_role;
grant execute on function public.modalidade_da_sala(text) to authenticated, service_role;
