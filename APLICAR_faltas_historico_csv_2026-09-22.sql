-- ============================================================================
-- APLICAR NO SQL EDITOR DO DASHBOARD SUPABASE (produção)
--
-- Corresponde às migrations (só locais até rodar isto):
--   20260923000000_create_faltas_historico_csv.sql
--   20260923000100_rls_faltas_historico_csv.sql
--   20260923000200_classificar_falta_historico_csv.sql
--
-- Contexto: backfill de dedução de receita para Jan-Jun/2026 no histórico
-- de "Previsão de Receitas". Cria uma tabela NOVA (faltas_historico_csv) para
-- guardar o relatório externo do Órbita "relatorio_faltas_detalhado" —
-- não toca em nenhuma tabela existente (fila_autorizacoes, csv_grades_
-- profissionais, pacientes ficam 100% intactas; só são referenciadas por FK).
--
-- Seguro: CREATE TABLE novo + índices + RLS + 1 função SQL nova. Nenhum ALTER
-- em tabela existente, nenhum dado é modificado. Idempotente (IF NOT EXISTS /
-- CREATE OR REPLACE em tudo) — reexecutar não causa efeito colateral.
--
-- DEPOIS de rodar isto com sucesso, registre no histórico para não
-- dessincronizar o tracking de migrations:
--     npx supabase migration repair --status applied 20260923000000
--     npx supabase migration repair --status applied 20260923000100
--     npx supabase migration repair --status applied 20260923000200
-- ============================================================================

BEGIN;

-- ─── 1. Tabela ──────────────────────────────────────────────────────────────

create table if not exists public.faltas_historico_csv (
  id                    uuid        primary key default gen_random_uuid(),

  arquivo_origem        text        not null,
  linha_origem          integer     not null,
  data_agendamento      date        not null,
  hora_inicial          time        not null,
  paciente_nome_raw     text        not null,
  profissional_nome_raw text,
  especialidade_raw     text,
  motivo_raw            text,
  justificativa_raw     text,
  profissional_substituto_raw text,
  presenca_raw          text        not null,
  mensagem_protocolo_raw text,

  presenca_bool         boolean     not null,
  paciente_id           bigint      references public.pacientes(id_paciente),
  paciente_nome_normalizado text,
  csv_grade_id          uuid        references public.csv_grades_profissionais(id),
  tipo_falta            text        check (tipo_falta is null or tipo_falta in ('paciente','terapeuta','unidade_fechada')),
  codigo_justificativa  smallint    check (codigo_justificativa is null or codigo_justificativa between 101 and 113),
  motivo_classificado   boolean     not null default false,
  observacao_classificacao text,

  importado_em          timestamptz not null default now(),
  importado_por         text        not null default 'importar-faltas-historico-csv.js'
);

create unique index if not exists uq_faltas_historico_csv_natural
  on public.faltas_historico_csv (paciente_nome_normalizado, data_agendamento, hora_inicial, especialidade_raw);

create index if not exists idx_faltas_historico_csv_data
  on public.faltas_historico_csv (data_agendamento);

create index if not exists idx_faltas_historico_csv_paciente
  on public.faltas_historico_csv (paciente_id) where paciente_id is not null;

create index if not exists idx_faltas_historico_csv_grade
  on public.faltas_historico_csv (csv_grade_id) where csv_grade_id is not null;

create index if not exists idx_faltas_historico_csv_sem_match
  on public.faltas_historico_csv (data_agendamento)
  where not presenca_bool and (csv_grade_id is null or paciente_id is null);

comment on table public.faltas_historico_csv is
  'Backfill de faltas Jan-Jun/2026 (e até 2026-08-04), importado do relatório '
  'externo "relatorio_faltas_detalhado" do Órbita — CSV mensal com Presença '
  'Sim/Não por sessão. Supre a dedução de receita em previsao_receitas_historico '
  'para sessões de csv_grades_profissionais com origem=''backup_xls'', que não '
  'têm tita_agendamento_id e por isso não casam com fila_autorizacoes. '
  'presenca_bool=false decide a dedução; tipo_falta/codigo_justificativa são só '
  'rótulo de auditoria e NUNCA devem gatear a dedução (ver 20260908100200: a '
  'dedução real de produção também ignora tipo_falta).';

comment on column public.faltas_historico_csv.csv_grade_id is
  'FK para a sessão em csv_grades_profissionais (origem=''backup_xls''), '
  'resolvida por paciente_id + data_agendamento + hora_inicial. NULL quando não '
  'foi possível casar (paciente não resolvido, ou sessão inexistente/ambígua na '
  'grade) — essas linhas não entram na dedução, ver idx_..._sem_match.';

comment on column public.faltas_historico_csv.tipo_falta is
  'Rótulo de auditoria (mesma taxonomia de fila_autorizacoes.tipo_falta). NÃO '
  'afeta a dedução de receita — só presenca_bool decide isso, igual ao '
  'comportamento real de produção (status=''falta'' deduz sempre, sem filtrar '
  'por tipo/motivo).';

-- ─── 2. RLS ─────────────────────────────────────────────────────────────────

alter table public.faltas_historico_csv enable row level security;

drop policy if exists "faltas_historico_csv_select" on public.faltas_historico_csv;
create policy "faltas_historico_csv_select"
  on public.faltas_historico_csv for select
  to authenticated
  using (public.remuneracao_has_role(array['admin','diretoria']));

drop policy if exists "faltas_historico_csv_write" on public.faltas_historico_csv;
create policy "faltas_historico_csv_write"
  on public.faltas_historico_csv for all
  to service_role
  using (true) with check (true);

-- ─── 3. Classificação de motivo (só auditoria, não afeta dedução) ───────────

create or replace function public.classificar_falta_historico_csv(
  p_motivo   text,
  p_presenca boolean
)
returns table(tipo_falta text, codigo_justificativa smallint, motivo_classificado boolean)
language sql
immutable
set search_path = public
as $$
  select
    case when p_presenca then null else
      case upper(btrim(coalesce(p_motivo, '')))
        when 'ATESTADO / INTERNAÇÃO / FALECIMENTO'                   then 'paciente'
        when 'AUSÊNCIA DE JUSTIFICATIVA'                             then 'paciente'
        when 'CONFLITO COM CRONOGRAMA'                               then 'paciente'
        when 'CONFLITO TERAPÊUTICO'                                  then 'paciente'
        when 'CONSULTAS / COMPROMISSOS'                              then 'paciente'
        when 'FALTA DO PROFISSIONAL'                                 then 'terapeuta'
        when 'FÉRIAS/VIAGEM'                                         then 'paciente'
        when 'LOGÍSTICA / DESLOCAMENTO / CLIMA'                      then 'paciente'
        when 'PENDÊNCIA ADMINISTRATIVA'                              then 'paciente'
        when 'SAÚDE DA CRIANÇA'                                      then 'paciente'
        when 'SAÚDE DO RESPONSÁVEL'                                  then 'paciente'
        when 'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO RESPONSÁVEL'     then 'paciente'
        when 'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO COORDENADOR'     then 'paciente'
        when 'FERIADO/RECESSO CLÍNICA'                               then 'unidade_fechada'
        when 'FERIADO/RECESSO CLINICA'                               then 'unidade_fechada'
        else 'paciente'
      end
    end,
    case when p_presenca then null else
      case upper(btrim(coalesce(p_motivo, '')))
        when 'ATESTADO / INTERNAÇÃO / FALECIMENTO'                   then 101::smallint
        when 'AUSÊNCIA DE JUSTIFICATIVA'                             then 102::smallint
        when 'CONFLITO COM CRONOGRAMA'                               then 103::smallint
        when 'CONFLITO TERAPÊUTICO'                                  then 104::smallint
        when 'CONSULTAS / COMPROMISSOS'                              then 105::smallint
        when 'FALTA DO PROFISSIONAL'                                 then 106::smallint
        when 'FÉRIAS/VIAGEM'                                         then 107::smallint
        when 'LOGÍSTICA / DESLOCAMENTO / CLIMA'                      then 108::smallint
        when 'PENDÊNCIA ADMINISTRATIVA'                              then 109::smallint
        when 'SAÚDE DA CRIANÇA'                                      then 110::smallint
        when 'SAÚDE DO RESPONSÁVEL'                                  then 111::smallint
        when 'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO RESPONSÁVEL'     then 112::smallint
        when 'FERIADO/RECESSO CLÍNICA'                               then 113::smallint
        when 'FERIADO/RECESSO CLINICA'                               then 113::smallint
        else null
      end
    end,
    p_presenca or upper(btrim(coalesce(p_motivo, ''))) in (
      'ATESTADO / INTERNAÇÃO / FALECIMENTO', 'AUSÊNCIA DE JUSTIFICATIVA',
      'CONFLITO COM CRONOGRAMA', 'CONFLITO TERAPÊUTICO', 'CONSULTAS / COMPROMISSOS',
      'FALTA DO PROFISSIONAL', 'FÉRIAS/VIAGEM', 'LOGÍSTICA / DESLOCAMENTO / CLIMA',
      'PENDÊNCIA ADMINISTRATIVA', 'SAÚDE DA CRIANÇA', 'SAÚDE DO RESPONSÁVEL',
      'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO RESPONSÁVEL',
      'SOLICITAÇÃO DE LIBERAÇÃO POR PARTE DO COORDENADOR',
      'FERIADO/RECESSO CLÍNICA', 'FERIADO/RECESSO CLINICA'
    );
$$;

comment on function public.classificar_falta_historico_csv(text, boolean) is
  'Mapa motivo_raw (relatorio_faltas_detalhado do Órbita) -> tipo_falta/'
  'codigo_justificativa, só para auditoria/consistência com o vocabulário de '
  'fila_autorizacoes. NUNCA usar este resultado para decidir dedução de '
  'receita — isso é decidido só por presenca_bool. Motivo fora da lista '
  'conhecida cai em tipo_falta=''paciente'', codigo NULL, '
  'motivo_classificado=false (reportado no import, não bloqueia).';

-- ─── 4. Normalização de nome em lote (para o script de import) ─────────────

create or replace function public.normalizar_nomes_paciente_lote(p_nomes text[])
returns table(nome_raw text, nome_normalizado text)
language sql
immutable
set search_path = public
as $$
  select n, public.normalizar_nome_paciente(n)
  from unnest(p_nomes) as n;
$$;

comment on function public.normalizar_nomes_paciente_lote(text[]) is
  'Aplica public.normalizar_nome_paciente a uma lista de nomes em lote (para '
  'imports que precisam casar por nome sem ID direto, ex. '
  'importar-faltas-historico-csv.js). Nunca duplicar a lógica de normalização '
  'em JS — sempre passar pela função canônica via esta wrapper.';

COMMIT;

-- ---------------------------------------------------------------------------
-- Conferência (rode depois do COMMIT; deve retornar a tabela vazia e a função):
--
-- SELECT count(*) FROM public.faltas_historico_csv;
-- SELECT public.classificar_falta_historico_csv('FALTA DO PROFISSIONAL', false);
-- SELECT public.classificar_falta_historico_csv('CONSULTAS / COMPROMISSOS', false);
-- SELECT public.classificar_falta_historico_csv(null, false); -- motivo vazio: 'paciente', null, false
-- ---------------------------------------------------------------------------
