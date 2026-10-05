-- grade_sync_dia: "quando a TiTa confirmou este dia pela última vez", por DIA
--
-- ─── O defeito ──────────────────────────────────────────────────────────────
-- Em 05/10/2026 /cronograma/ocupacao-paciente avisou "Grade desatualizada ...
-- há 2 dia(s)" com o sync saudável: o log da Edge Function mostra a cadeia de
-- 04/10 passando por 01–28/11 sem uma falha.
--
-- O aviso (medirFrescorGrade) media max(visto_em) de csv_grades_profissionais.
-- Só que o sync, para não gerar WAL, renova visto_em de linha INALTERADA a cada
-- 7 dias (DIAS_REVALIDACAO). Grade que não muda por 2 dias = aviso falso. Em
-- 03/11, de 878 linhas: 845 carimbadas em 01/10 (backfill), 17 em 03/10, 1 hoje.
--
-- ─── A correção ─────────────────────────────────────────────────────────────
-- Um carimbo por DIA processado, não por linha: ~60 upserts por rodada em vez
-- de ~14 mil UPDATEs. A Edge Function grava ao fim de cada fatia que entrou
-- (inclusive fim de semana, em que a TiTa devolve vazio — confirmar "vazio"
-- também é confirmar). A tela passa a ler daqui.
--
-- Rollback: `drop table public.grade_sync_dia;` e reverter fonte.ts.
--
-- Idempotente.

create table if not exists public.grade_sync_dia (
  data            date        not null,
  modo            text        not null check (modo in ('grade', 'execucao')),
  unidade_id      integer     not null default 280,
  sincronizado_em timestamptz not null default now(),
  recebidos       integer     not null default 0,
  primary key (data, modo, unidade_id)
);

comment on table public.grade_sync_dia is
  'Último instante em que o sync-grade-csv processou com sucesso cada dia, por modo. Sinal de frescor da grade (medirFrescorGrade) — visto_em por linha só é renovado a cada 7 dias e não serve para isso.';

alter table public.grade_sync_dia enable row level security;

drop policy if exists grade_sync_dia_leitura on public.grade_sync_dia;
create policy grade_sync_dia_leitura on public.grade_sync_dia
  for select to authenticated using (true);

revoke all on public.grade_sync_dia from anon, authenticated;
grant select on public.grade_sync_dia to authenticated;
grant all on public.grade_sync_dia to service_role;
