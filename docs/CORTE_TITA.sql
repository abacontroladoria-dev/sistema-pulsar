-- ═════════════════════════════════════════════════════════════════════════════
-- CORTE DO TiTa — despedida definitiva. NÃO É MIGRATION: aplicar à mão, uma vez,
-- no SQL Editor do Supabase, no dia escolhido.
-- ═════════════════════════════════════════════════════════════════════════════
--
-- O que faz:
--   1. Grava a trava (public.sistema_tita_corte). Daí em diante:
--        • nenhuma importação do TiTa roda (pacientes, profissionais,
--          disponibilidade, agenda): os logs recusam gravação;
--        • nenhuma sessão nova nasce com id do TiTa;
--        • a repetição automática das séries CONTINUA (não lê o TiTa).
--   2. Desliga as rotinas do pg_cron que copiam o TiTa.
--   3. Lista o que sobrou no pg_cron mencionando o TiTa, para conferência.
--
-- ANTES de rodar (checklist):
--   [ ] A página Administração → "Carregar do TiTa" rodou a ÚLTIMA carga hoje,
--       as 4 etapas em verde, e você conferiu os relatórios.
--   [ ] A cópia do TiTa estava fresca (atualizada no mesmo dia).
--   [ ] A lista "Ainda dependem do TiTa" da mesma página está vazia
--       (frontend/lib/tita/dependencias.ts). Se não estiver, essas telas ficam
--       congeladas na última cópia.
--   [ ] Backup do banco feito (Documents\backups-pulsar).
--   [ ] Migrations 20261015190000 e 20261016100000 aplicadas.
--
-- DEPOIS de rodar:
--   • Remover TITA_TOKEN e TITA_API_URL do Coolify e dos secrets das Edge
--     Functions (Supabase → Edge Functions → Secrets).
--   • Revogar o token de integração no próprio TiTa, se ele permitir.
--
-- Não há volta automática: desfazer exige apagar a linha da trava à mão e
-- reagendar os crons — e o TiTa não terá as mudanças feitas no Pulsar.

do $$
begin
  -- TRAVA: troque false por true SÓ no dia do corte, depois do checklist acima.
  if not false then
    raise exception 'Trava ligada: confira o checklist do cabeçalho e troque "if not false" por "if not true" para cortar o TiTa.';
  end if;

  if exists (select 1 from public.sistema_tita_corte) then
    raise exception 'O TiTa já foi desligado em %.', (select cortado_em from public.sistema_tita_corte);
  end if;

  insert into public.sistema_tita_corte (cortado_por_nome, observacao)
  values ('SQL Editor', 'Corte definitivo do TiTa (docs/CORTE_TITA.sql).');
end $$;

-- 2. Rotinas que copiam o TiTa.
do $$
declare
  j record;
  n integer := 0;
begin
  if not exists (select 1 from public.sistema_tita_corte) then
    raise exception 'A trava do corte não foi gravada: nada foi desligado.';
  end if;
  for j in
    select jobid, jobname from cron.job
    where jobname in (
      'sync-grade-csv-daily', 'sync-grade-execucao-daily', 'sync-grade-csv-janela-critica',
      'sync-grade-csv-antecipa-mes', 'sync-grade-csv-verificar-retoma', 'sync-grade-csv-verificar-alerta',
      'sync-tita-diario', 'sync-tita-grade-diario', 'sync-tita-grade-horizonte-diario', 'sync-tita-grade-semanal',
      'sync-tita-operacional', 'sync-tita-planejamento', 'sync-tita-reconciliacao', 'sync-tita-semana-segunda',
      'sync_tita_agenda', 'sync-grade-profissionais-hora', 'cco-sync-tita-sessions',
      'pacientes-importar-tita-diario', 'sync-reposicao-faltas',
      'snapshot-previsao-receitas-daily', 'snapshot-previsao-receitas-fechamento'
    )
  loop
    perform cron.unschedule(j.jobid);
    n := n + 1;
    raise notice 'Desligada: %', j.jobname;
  end loop;
  raise notice '% rotina(s) do TiTa desligada(s).', n;
end $$;

-- 3. Conferência: o que ainda menciona o TiTa no pg_cron (deve vir vazio).
select jobid, jobname, schedule, command
from cron.job
where command ilike '%tita%' or command ilike '%sync-grade%' or jobname ilike '%tita%';
