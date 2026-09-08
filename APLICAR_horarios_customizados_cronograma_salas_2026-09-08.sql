-- Aplicar manualmente no SQL Editor do Supabase (produção).
-- Mesmo conteúdo de supabase/migrations/20260908095723_add_horarios_customizados_cronograma_salas.sql
--
-- Override opcional de horários por sala/dia/turno — necessário quando um
-- turno tem duração de sessão diferente do padrão do sistema (40min). Ex.:
-- sábado da "Equoterapia em Movimento", sessões de 30min das 08:00 às 12:00
-- (8 sessões, não os 6 blocos padrão da Manhã). Chave "<dow>-<turno>" (ex.:
-- "6-Manhã"); ausência de chave = usa o grid padrão HORAS_GRID do sistema —
-- ver calcularSlotsDaSala em frontend/lib/cronograma/salas.ts.
alter table public.cronograma_salas
  add column if not exists horarios_customizados jsonb not null default '{}'::jsonb;
