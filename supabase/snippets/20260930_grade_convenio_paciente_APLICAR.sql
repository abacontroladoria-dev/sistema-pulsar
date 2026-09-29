-- Status Laudos e Senhas — convênio do paciente pela grade da TiTa
--
-- APLICA a migration 20260930140000 e registra no livro-caixa. Snippet e não
-- `db push` (ver reference_db_push_blast_radius). Reexecutável.
--
-- Cria SÓ uma função de leitura (grade_convenio_por_paciente), executável
-- apenas pela service_role. Não altera tabela, view nem permissão existente.

begin;
set local lock_timeout = '5s';

-- ============================================================================
-- Convênio do paciente pela GRADE da TiTa — para a tela Status Laudos e Senhas
-- (filtro "Convênio" e o nome do convênio no cartão).
--
-- Fonte: a mesma da "Grade · N horários" de /cronograma/* —
-- csv_grades_profissionais, sincronizada da TiTa por sync-grade-csv, lida pelo
-- ponto único vw_grade_atendimentos (linha ativa, status 'Agendado').
--
-- ─── A regra (medida em 28/09/2026) ─────────────────────────────────────────
--
-- A grade guarda o convênio POR AGENDAMENTO (`convenio_nome`; não há id de
-- convênio na fonte). 213 de 488 pacientes aparecem com mais de um convênio no
-- ano — mas é TROCA ao longo do tempo, não convênio simultâneo: de hoje em
-- diante, 0 pacientes com dois convênios; nos últimos 30 dias, 3 em transição.
-- Por isso, por paciente:
--
--   1. o convênio do PRÓXIMO agendamento (data >= hoje em Brasília);
--   2. sem agendamento futuro, o do ÚLTIMO agendamento passado.
--
-- "Ainda não selecionado" e vazio são ignorados (12 pacientes têm alguma linha
-- assim; todos têm outra linha com convênio de verdade).
--
-- Medido contra os 358 laudos do Órbita: 253 pelo próximo agendamento, 86 pelo
-- último, 19 sem nenhum na grade (a tela usa o Plano do Órbita para esses).
--
-- ─── Por que FUNÇÃO, e não view ─────────────────────────────────────────────
--
-- Uma view sobre vw_grade_atendimentos viraria DEPENDENTE dela no catálogo, e as
-- migrations da grade recriam essas views com DROP VIEW sem CASCADE
-- (20260806110000): a próxima falharia por causa desta. O corpo de uma função
-- `language sql` não é rastreado como dependência, então não prende nada.
--
-- Uma linha por paciente (~500), no lugar das ~156 mil linhas da grade que a
-- tela teria de ler a cada carga para chegar ao mesmo resultado.
--
-- ─── Segurança ──────────────────────────────────────────────────────────────
--
--   • SÓ LEITURA (`stable`, um SELECT): não grava, não apaga, não chama nada.
--   • Devolve o mínimo: paciente_id + nome do convênio + data de referência. Nada
--     de nome de paciente, CPF, telefone ou profissional.
--   • SECURITY INVOKER (explícito): roda com os privilégios de quem chama — não
--     é uma porta para contornar RLS/GRANT da grade.
--   • search_path VAZIO: todo objeto é chamado com o schema (`public.`), então
--     ninguém consegue "sequestrar" a função criando um objeto de mesmo nome num
--     schema que venha antes no caminho.
--   • EXECUTE só para service_role (revogado de public, anon e authenticated —
--     o Supabase concede EXECUTE a anon/authenticated por padrão em função nova
--     no schema public). A leitura é da rota /api/acompanhamento-laudos, que
--     roda no servidor e exige sessão.
--
-- Idempotente.

create or replace function public.grade_convenio_por_paciente()
returns table (
  paciente_id bigint,
  convenio_nome text,
  data_referencia date,
  futuro boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with hoje as (
    select (now() at time zone 'America/Sao_Paulo')::date as d
  ),
  base as (
    select
      g.id,
      g.paciente_id,
      btrim(g.convenio_nome) as convenio_nome,
      g.data,
      g.data >= (select d from hoje) as futuro
    from public.vw_grade_atendimentos g
    where g.unidade_id = 280
      and g.paciente_id is not null
      and nullif(btrim(g.convenio_nome), '') is not null
      and btrim(g.convenio_nome) <> 'Ainda não selecionado'
  )
  select distinct on (b.paciente_id)
    b.paciente_id::bigint,
    b.convenio_nome,
    b.data as data_referencia,
    b.futuro
  from base b
  order by
    b.paciente_id,
    b.futuro desc,                                  -- futuro antes do passado
    case when b.futuro then b.data end asc nulls last,  -- o próximo
    case when b.futuro then b.id end asc nulls last,
    b.data desc,                                    -- ou o último
    b.id desc
$$;

comment on function public.grade_convenio_por_paciente() is
  'Convênio atual de cada paciente (paciente_id = ID Favorecido) pela grade da TiTa, unidade 280: o do próximo agendamento a partir de hoje (Brasília); sem futuro, o do último passado. Ignora vazio e "Ainda não selecionado". Uma linha por paciente. Só service_role.';

revoke all on function public.grade_convenio_por_paciente() from public, anon, authenticated;
grant execute on function public.grade_convenio_por_paciente() to service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260930140000', 'grade_convenio_por_paciente')
on conflict (version) do nothing;

commit;

-- Avisa o PostgREST (a API que a tela usa) para recarregar o catálogo agora —
-- sem isto, a função pode levar alguns instantes para "aparecer" e a tela
-- continua dizendo "Could not find the function".
notify pgrst, 'reload schema';

-- CONFERÊNCIA — ESPERADO numa linha só:
--   pacientes ≈ 490 · pacientes_repetidos = 0 ·
--   anon_executa = false · authenticated_executa = false · service_role_executa = true
select
  (select count(*) from public.grade_convenio_por_paciente())                         as pacientes,
  (select count(*) filter (where futuro) from public.grade_convenio_por_paciente())   as pelo_proximo_agendamento,
  (select count(*) - count(distinct paciente_id) from public.grade_convenio_por_paciente()) as pacientes_repetidos,
  has_function_privilege('anon', 'public.grade_convenio_por_paciente()', 'execute')          as anon_executa,
  has_function_privilege('authenticated', 'public.grade_convenio_por_paciente()', 'execute') as authenticated_executa,
  has_function_privilege('service_role', 'public.grade_convenio_por_paciente()', 'execute')  as service_role_executa;
