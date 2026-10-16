-- Segurança (Etapa 3 do plano de independência do TiTa): o log da importação de
-- pacientes (pacientes_importacoes_log.detalhes) guardava CPF inteiro — do
-- paciente e do responsável — e o número da carteirinha, em texto, para sempre.
-- O log só precisa mostrar QUE mudou; o valor inteiro está no cadastro, que tem
-- RLS própria.
--
--   • gatilho mascara daqui em diante, venha de onde vier (RPC, cron);
--   • o histórico já gravado é mascarado uma vez (não há como desmascarar —
--     é a intenção);
--   • sp_mascarar_cpf fica idempotente (valor já mascarado não muda).
--
-- CPF → ***.456.789-**   ·   carteirinha → ••••1234
-- Idempotente.

set lock_timeout = '5s';

create or replace function public.sp_mascarar_cpf(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null then null
    when p like '***%' then p
    when regexp_replace(p, '\D', '', 'g') ~ '^\d{11}$' then
      '***.' || substr(regexp_replace(p, '\D', '', 'g'), 4, 3) || '.'
             || substr(regexp_replace(p, '\D', '', 'g'), 7, 3) || '-**'
    else '***'
  end
$$;

create or replace function public.sp_mascarar_final(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or btrim(p) = '' then p
    when p like '••••%' then p
    else '••••' || right(regexp_replace(p, '\s', '', 'g'), 4)
  end
$$;

-- detalhes = {novos: [{cpf, ...}], atualizados: [{mudancas: [{campo, de, para}], ...}]}
create or replace function public.sp_mascarar_detalhes_pacientes(d jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when d is null or jsonb_typeof(d) <> 'object' then d else
    d
    || case when jsonb_typeof(d -> 'novos') = 'array' then jsonb_build_object('novos', coalesce((
         select jsonb_agg(
                  case when jsonb_typeof(n) = 'object' and n ? 'cpf'
                       then jsonb_set(n, '{cpf}', coalesce(to_jsonb(public.sp_mascarar_cpf(n ->> 'cpf')), 'null'::jsonb))
                       else n end
                  order by o)
         from jsonb_array_elements(d -> 'novos') with ordinality as x(n, o)), '[]'::jsonb))
       else '{}'::jsonb end
    || case when jsonb_typeof(d -> 'atualizados') = 'array' then jsonb_build_object('atualizados', coalesce((
         select jsonb_agg(
                  case when jsonb_typeof(a) = 'object' and jsonb_typeof(a -> 'mudancas') = 'array'
                       then jsonb_set(a, '{mudancas}', coalesce((
                              select jsonb_agg(
                                       case
                                         when jsonb_typeof(m) <> 'object' then m
                                         when (m ->> 'campo') ilike '%cpf%' then m || jsonb_build_object(
                                           'de', public.sp_mascarar_cpf(m ->> 'de'), 'para', public.sp_mascarar_cpf(m ->> 'para'))
                                         when (m ->> 'campo') ilike '%carteirinha%' then m || jsonb_build_object(
                                           'de', public.sp_mascarar_final(m ->> 'de'), 'para', public.sp_mascarar_final(m ->> 'para'))
                                         else m end
                                       order by om)
                              from jsonb_array_elements(a -> 'mudancas') with ordinality as y(m, om)), '[]'::jsonb))
                       else a end
                  order by o)
         from jsonb_array_elements(d -> 'atualizados') with ordinality as x(a, o)), '[]'::jsonb))
       else '{}'::jsonb end
  end
$$;

create or replace function public.sp_pacientes_log_mascarar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.detalhes := public.sp_mascarar_detalhes_pacientes(new.detalhes);
  return new;
end $$;

drop trigger if exists trg_pacientes_log_mascarar on public.pacientes_importacoes_log;
create trigger trg_pacientes_log_mascarar
  before insert or update of detalhes on public.pacientes_importacoes_log
  for each row execute function public.sp_pacientes_log_mascarar();

-- Histórico já gravado.
do $$
declare n integer;
begin
  update public.pacientes_importacoes_log
     set detalhes = detalhes
   where detalhes is not null
     and public.sp_mascarar_detalhes_pacientes(detalhes) is distinct from detalhes;
  get diagnostics n = row_count;
  raise notice '% execução(ões) do log de pacientes mascarada(s).', n;
end $$;

revoke all on function public.sp_mascarar_cpf(text)                    from public, anon, authenticated;
revoke all on function public.sp_mascarar_final(text)                  from public, anon, authenticated;
revoke all on function public.sp_mascarar_detalhes_pacientes(jsonb)    from public, anon, authenticated;
revoke all on function public.sp_pacientes_log_mascarar()              from public, anon, authenticated;

-- Leitura do log: só quem cuida do cadastro de pacientes (era qualquer login,
-- `using (true)`). Só a tela de Pacientes lê este log.
drop policy if exists "pacientes_importacoes_log_select" on public.pacientes_importacoes_log;
create policy "pacientes_importacoes_log_select" on public.pacientes_importacoes_log
  for select to authenticated using ((select public.usuario_tem_permissao('cadastros_pacientes')));
revoke all on public.pacientes_importacoes_log from anon;
