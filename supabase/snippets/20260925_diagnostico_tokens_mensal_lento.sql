-- Diagnóstico: por que get_tokens_mensal leva ~11 s (Conferência de Filipetas).
-- Só leitura. Rodar INTEIRO no SQL Editor; o resultado é uma coluna de texto
-- (1ª linha = a 20260925140000 foi aplicada?; depois o plano com tempos).

set statement_timeout = '120s';
set search_path = public, extensions, pg_temp;

create temp table if not exists _plano (n serial, linha text);
truncate _plano;

do $diag$
declare
  v_src text;
  r     text;
begin
  select prosrc into v_src
    from pg_proc
   where oid = 'public.get_tokens_mensal(date)'::regprocedure;

  insert into _plano(linha)
  values ('20260925140000 aplicada: ' || (position('20260925140000' in v_src) > 0)::text);

  v_src := regexp_replace(v_src, ';\s*$', '');
  v_src := replace(v_src, 'p_mes', '''2026-09-01''::date');

  for r in execute 'explain (analyze, buffers, format text) ' || v_src loop
    insert into _plano(linha) values (r);
  end loop;
end
$diag$;

select linha from _plano order by n;
