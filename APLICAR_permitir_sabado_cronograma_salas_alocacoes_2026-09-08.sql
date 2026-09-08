-- Aplicar manualmente no SQL Editor do Supabase (produção).
-- Mesmo conteúdo de supabase/migrations/20260908095030_permitir_sabado_cronograma_salas_alocacoes.sql
--
-- Permite alocação em sábado (dow=6) — necessário pra salas com
-- `dias_disponiveis` fora do padrão Seg-Sex (ex.: "Equoterapia em Movimento",
-- que atende quarta e sábado de manhã). A constraint original só previa
-- Seg-Sex porque, até aqui, toda sala operava só nesses dias.
alter table public.cronograma_salas_alocacoes
  drop constraint if exists cronograma_salas_alocacoes_dow_check;

alter table public.cronograma_salas_alocacoes
  add constraint cronograma_salas_alocacoes_dow_check check (dow between 1 and 6);
