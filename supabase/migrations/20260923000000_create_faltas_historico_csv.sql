-- Tabela auxiliar para o backfill de dedução de receita de Jan-Jun/2026.
--
-- ─── Por que existe ─────────────────────────────────────────────────────────
--
-- A dedução por falta na Edge Function snapshot-previsao-receitas casa
-- fila_autorizacoes (status='falta') com a sessão via tita_agendamento_id.
-- Toda linha de csv_grades_profissionais com origem='backup_xls' (Jan-Jun e
-- até 2026-08-04, seed do backup XLS) tem tita_agendamento_id = NULL — o
-- backup nunca trouxe esse id (scripts/lib/backup-grade.js). Rodar o
-- snapshot para esse período hoje daria Dedução = 0 sempre, mesmo havendo
-- faltas reais.
--
-- O usuário forneceu o relatório externo do Órbita "relatorio_faltas_detalhado"
-- (um CSV por mês, Jan-Jun/2026), com Presença Sim/Não por sessão — essa
-- tabela guarda esse relatório inteiro (Sim e Não, para auditoria completa) e
-- os campos derivados usados para casar cada linha com a sessão real.
--
-- Por que não gravar direto em fila_autorizacoes: seus triggers/CHECKs foram
-- desenhados em torno do fluxo operacional vivo (tita_agendamento_id,
-- reversão, lote de faltas) — forçar linhas de um CSV histórico sem esse id
-- ali multiplicaria exceções e poluiria a fila real. Tabela separada, só
-- consumida pela Edge Function, é mais fácil de auditar e reverter.
--
-- IMPORTANTE (decisão de negócio, verificada em 20260908100200 linha 34-36):
-- a dedução de receita hoje NÃO filtra por tipo_falta/motivo — todo
-- status='falta' deduz igual, até feriado. tipo_falta/codigo_justificativa
-- aqui são só rótulo de auditoria (mesmo vocabulário de fila_autorizacoes),
-- NUNCA usados para decidir se a linha deduz. Quem decide é presenca_bool.

create table if not exists public.faltas_historico_csv (
  id                    uuid        primary key default gen_random_uuid(),

  -- Dados brutos do CSV externo (um arquivo por mês, Jan-Jun/2026).
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

  -- Campos derivados no import (calculados uma vez, nunca reinterpretados na leitura).
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

-- Idempotência do import: mesma linha do mesmo mês não duplica. Não há
-- paciente_id nem tita_agendamento_id no CSV para uma chave mais forte que
-- nome normalizado + data + hora + especialidade.
create unique index if not exists uq_faltas_historico_csv_natural
  on public.faltas_historico_csv (paciente_nome_normalizado, data_agendamento, hora_inicial, especialidade_raw);

create index if not exists idx_faltas_historico_csv_data
  on public.faltas_historico_csv (data_agendamento);

create index if not exists idx_faltas_historico_csv_paciente
  on public.faltas_historico_csv (paciente_id) where paciente_id is not null;

create index if not exists idx_faltas_historico_csv_grade
  on public.faltas_historico_csv (csv_grade_id) where csv_grade_id is not null;

-- Falta sem sessão casada, ou sem paciente resolvido, precisa aparecer rápido
-- numa auditoria — são as linhas que NÃO entram na dedução por falta de match.
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
