-- Segurança (Etapa 3): o que estava aberto pelas migrations e só foi fechado em
-- produção à mão (supabase/snippets/20260817_advisors_fix_fase*.sql), mais as
-- funções que o anon ainda pode executar sem precisar.
--
-- Por que isto importa mesmo com produção já fechada: um banco reconstruído a
-- partir das migrations (branch, ambiente novo, restauração) nasceria aberto.
-- Esta migration NÃO reaplica os snippets (o de views recriaria definições de
-- agosto por cima das atuais); faz só ajustes que não mudam definição:
--
--   1. Views sobre dado pessoal passam a respeitar a RLS de quem consulta
--      (security_invoker). Em produção já estão assim (snippet fase 2): aqui é
--      no-op.
--   2. public.usuarios com RLS ligada. Em produção já está (snippet fase 3,
--      com as policies). Num banco novo SEM essas policies, a tabela fica
--      fechada (falha segura) — o aviso abaixo diz isso.
--   3. Funções que o anon executava sem precisar:
--        • fn_sync_* (disparam o sync do TiTa): só o dono (pg_cron) executa;
--        • guias_avulsas (security definer, lê a fila de autorizações sem
--          checar usuário) e as consultas da Central/Auditoria ASSIM/home:
--          ficam só para quem está logado.
--      Ficam com o anon, de propósito: robo_* (autenticam pelo token do robô)
--      e email_por_username (a tela de login chama antes do login).
--
-- Idempotente.

set lock_timeout = '5s';

-- 1. Views
do $$
declare v text;
begin
  foreach v in array array['vw_central_terapeutica', 'vw_profissionais_disponiveis'] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = true)', v);
      execute format('revoke all on public.%I from anon', v);
    end if;
  end loop;
end $$;

-- 2. usuarios
do $$
begin
  if to_regclass('public.usuarios') is not null then
    alter table public.usuarios enable row level security;
    revoke all on public.usuarios from anon;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'usuarios') then
      raise warning 'public.usuarios está com RLS ligada e SEM policies: ninguém além da service_role lê. Aplique supabase/snippets/20260817_advisors_fix_fase3_usuarios_rls.sql.';
    end if;
  end if;
end $$;

-- 3. Funções
do $$
declare
  f record;
begin
  -- Disparo do sync do TiTa: só o dono (pg_cron) e a service_role.
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_sync\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.assinatura);
    execute format('grant execute on function %s to service_role', f.assinatura);
  end loop;

  -- Só para quem está logado.
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('guias_avulsas', 'get_fluxo_slots', 'listar_central_pacientes',
                        'get_auditoria_assim', 'get_auditoria_assim_periodo', 'get_auditoria_assim_resumo',
                        'get_faltas_auditoria_assim')
  loop
    execute format('revoke all on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
  end loop;
end $$;
