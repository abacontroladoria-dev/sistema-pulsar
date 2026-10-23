-- Espelha evoluções/faltas do TiTa em grade_evolucoes a cada carga da cópia.
--
-- Antes, sp_grade_espelhar_evolucoes_tita só rodava em grade_importar_tita_concluir
-- (importação manual da grade, só na janela importada). O sync diário
-- (sync-grade-csv → csv_grades_profissionais) trazia a evolução do TiTa, mas ela
-- não chegava à Grade: em 23/10/2026, 207 sessões de 3 a 14 dias atrás estavam
-- evoluídas no TiTa e "sem registro" no Pulsar.
--
-- Gatilho por COMANDO (não por linha): um espelho por lote do sync, no
-- intervalo de datas do lote. Falha vira aviso e não derruba o sync, igual ao
-- arquivo de evoluções (20261019200300). O espelho já não toca origem = 'pulsar'
-- e para sozinho depois do corte do TiTa.

create or replace function public.sp_csv_grade_espelhar_evolucoes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_de  date;
  v_ate date;
begin
  select min(n.data), max(n.data) into v_de, v_ate
    from novas n
   where n.data is not null
     and (n.possui_tratativa is true
          or lower(coalesce(n.status_execucao, '')) ~ '(cancel|nao realizad|não realizad)');

  if v_de is null then
    return null;
  end if;

  begin
    perform public.sp_grade_espelhar_evolucoes_tita(v_de, v_ate);
  exception when others then
    raise warning '[espelho de evoluções] lote % a % não espelhado: %', v_de, v_ate, sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.sp_csv_grade_espelhar_evolucoes() from public, anon, authenticated;

drop trigger if exists trg_csv_grade_espelhar_evolucoes_ins on public.csv_grades_profissionais;
create trigger trg_csv_grade_espelhar_evolucoes_ins
  after insert on public.csv_grades_profissionais
  referencing new table as novas
  for each statement
  execute function public.sp_csv_grade_espelhar_evolucoes();

drop trigger if exists trg_csv_grade_espelhar_evolucoes_upd on public.csv_grades_profissionais;
create trigger trg_csv_grade_espelhar_evolucoes_upd
  after update on public.csv_grades_profissionais
  referencing new table as novas
  for each statement
  execute function public.sp_csv_grade_espelhar_evolucoes();
