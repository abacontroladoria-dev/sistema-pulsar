-- 7 linhas do CSV de Jan/2026 (todas Presença=Sim, dado que não afeta dedução)
-- vieram sem "Hora Inicial" preenchida na fonte (Órbita). A tabela é uma cópia
-- fiel do relatório para auditoria completa ("importar tudo" foi decisão
-- explícita do usuário) — não faz sentido inventar horário nem descartar a
-- linha. hora_inicial passa a aceitar NULL; o índice único de idempotência já
-- trata NULL como valor distinto (padrão Postgres), então não precisa mudar.

alter table public.faltas_historico_csv
  alter column hora_inicial drop not null;

comment on column public.faltas_historico_csv.hora_inicial is
  'NULL nas raras linhas em que o relatório do Órbita não trouxe o horário '
  '(observado em Jan/2026, só em linhas Presença=Sim — não afeta dedução, já '
  'que sem horário não há como casar com csv_grade_id de qualquer forma).';
