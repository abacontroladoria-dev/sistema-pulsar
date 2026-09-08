-- Aplicar manualmente no SQL Editor do Supabase (produção), DEPOIS de
-- APLICAR_dias_disponiveis_cronograma_salas_2026-09-08.sql já ter rodado.
-- Mesmo conteúdo de supabase/migrations/20260908092832_dias_disponiveis_com_turno.sql
--
-- Evolui `dias_disponiveis` de "quais dias" (smallint[]) para "quais
-- dias E quais turnos" (jsonb: [{"dow":1,"turnos":["Manhã","Tarde"]}, ...]) —
-- necessário pra salas como "Equoterapia em Movimento", que atende quarta
-- (dia inteiro) e sábado (só de manhã). Linhas existentes viram dia inteiro
-- (Manhã+Tarde) em cada dow já cadastrado, preservando o comportamento atual
-- (a sala nova terá que ser reeditada depois pra marcar sábado só de manhã).
--
-- `USING` de `ALTER COLUMN TYPE` não aceita subquery correlacionada
-- (Postgres 0A000: "cannot use subquery in transform expression") — por isso
-- a conversão passa por uma função auxiliar em vez de um `select ... from
-- unnest(...)` inline.
create or replace function public._dias_disponiveis_para_jsonb(dias smallint[])
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('dow', d, 'turnos', jsonb_build_array('Manhã', 'Tarde')) order by d),
    '[]'::jsonb
  )
  from unnest(dias) as d
$$;

alter table public.cronograma_salas
  alter column dias_disponiveis drop default;

alter table public.cronograma_salas
  alter column dias_disponiveis type jsonb
  using public._dias_disponiveis_para_jsonb(dias_disponiveis);

alter table public.cronograma_salas
  alter column dias_disponiveis set default
    '[{"dow":1,"turnos":["Manhã","Tarde"]},{"dow":2,"turnos":["Manhã","Tarde"]},{"dow":3,"turnos":["Manhã","Tarde"]},{"dow":4,"turnos":["Manhã","Tarde"]},{"dow":5,"turnos":["Manhã","Tarde"]}]'::jsonb;

drop function public._dias_disponiveis_para_jsonb(smallint[]);
