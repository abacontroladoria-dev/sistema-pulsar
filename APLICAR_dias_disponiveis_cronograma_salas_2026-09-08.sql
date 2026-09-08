-- Aplicar manualmente no SQL Editor do Supabase (produção).
-- Mesmo conteúdo de supabase/migrations/20260908084935_add_dias_disponiveis_cronograma_salas.sql
--
-- Dias da semana em que a sala atende (1=Seg ... 6=Sáb). Default = padrão
-- Seg-Sex já assumido em todo o motor de ocupação até aqui, então salas
-- existentes não mudam de comportamento. Só uma sala com um conjunto
-- diferente (ex.: só quarta e sábado) passa a gerar slots fora do padrão —
-- ver calcularSlotsDaSala em frontend/lib/cronograma/salas.ts.
alter table public.cronograma_salas
  add column if not exists dias_disponiveis smallint[] not null default '{1,2,3,4,5}';
