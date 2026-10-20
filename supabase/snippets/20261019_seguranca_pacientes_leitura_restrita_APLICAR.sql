-- ═════════════════════════════════════════════════════════════════════════════
-- Segurança — cadastro de pacientes só para quem tem a permissão (Fase 5,
-- parte 2 de 2, branch feat/seguranca-falhas-dados)
--
-- TRAVA: aplicar SÓ DEPOIS de
--   1. a 20261019180000 (RPCs da lista básica, busca do PEP, Autorizações
--      Avulsas) aplicada, e
--   2. o redeploy do frontend desta branch (Grade, Ocupação Paciente, Alimentar
--      BD, PEP e Connect deixam de ler a tabela direto), e
--   3. a pré-checagem 5.x (supabase/snippets/20261019_seguranca_prechecagem_SO_LEITURA.sql)
--      conferida: quem perderia a leitura recebeu a permissão pelo grupo.
-- O primeiro bloco falha de propósito até você trocar `false` por `true`.
--
-- O que muda: some a policy `pacientes_select using (true)` (20260817190000):
-- qualquer login lia CPF, endereço e responsável de todos os pacientes. Ficam
-- lendo a tabela:
--   • quem tem `cadastros_pacientes` (policy nova, explícita, e a
--     pacientes_write_cadastro de 20260826100500);
--   • os papéis admin/diretoria/cronograma (pacientes_write, 20260817190000);
--   • as funções security definer e a service_role.
-- As demais telas usam a lista básica (pacientes_lista_basica).
--
-- Desfazer (se uma tela quebrar): recriar a policy antiga —
--   create policy pacientes_select on public.pacientes for select to authenticated using (true);
--
-- Idempotente. Ver docs/SEGURANCA_DADOS_AGENDA.md.
-- ═════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

do $$
declare
  rpcs_aplicadas_e_frontend_publicado boolean := true;
begin
  if not rpcs_aplicadas_e_frontend_publicado then
    raise exception 'Pare: aplique a 20261019180000, publique o frontend da branch feat/seguranca-falhas-dados, confira a pré-checagem 5.x e troque false por true no topo. Nada foi alterado.';
  end if;
  if to_regprocedure('public.pacientes_lista_basica(bigint[], bigint[])') is null then
    raise exception 'Pare: a 20261019180000 (pacientes_lista_basica) não está aplicada neste banco. Nada foi alterado.';
  end if;
end $$;

-- Pré-checagens 5.2 e 5.3 (supabase/snippets/20261019_seguranca_prechecagem_SO_LEITURA.sql),
-- embutidas: se alguma view ou função que roda COMO QUEM CONSULTA ler a tabela
-- pacientes além das esperadas, para aqui, listando, sem alterar nada.
do $$
declare
  v_views text;
  v_funcs text;
begin
  select string_agg(distinct v.relname, ', ') into v_views
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class
  where d.refobjid = 'public.pacientes'::regclass and v.oid <> 'public.pacientes'::regclass
    and coalesce((select bool_or(o in ('security_invoker=true', 'security_invoker=on')) from unnest(v.reloptions) o), false)
    and v.relname not in ('vw_paciente_laudos_flat', 'vw_grade_execucao_pulsar');

  select string_agg(p.oid::regprocedure::text, ', ') into v_funcs
  from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'central'::regnamespace)
    and not p.prosecdef and p.prokind = 'f'
    and p.prosrc ~ '\mpacientes\M'
    and p.proname not in ('listar_pacientes_assim');

  if v_views is not null or v_funcs is not null then
    raise exception E'Pare: ainda ha view/funcao lendo pacientes como quem consulta (voltariam vazias para quem perde a leitura). Mande esta lista para conferirmos. Nada foi alterado.\nviews: %\nfuncoes: %',
      coalesce(v_views, '-'), coalesce(v_funcs, '-');
  end if;
end $$;

drop policy if exists pacientes_select on public.pacientes;
drop policy if exists pacientes_select_cadastro on public.pacientes;

create policy pacientes_select_cadastro on public.pacientes
  for select to authenticated
  using (public.usuario_tem_permissao('cadastros_pacientes'));

-- Conferência: nenhuma policy de leitura aberta sobrou. Esperado: nenhuma linha.
do $$
declare
  v_abertas text;
begin
  select string_agg(policyname, ', ') into v_abertas
  from pg_policies
  where schemaname = 'public' and tablename = 'pacientes'
    and cmd in ('SELECT', 'ALL')
    and coalesce(qual, 'true') in ('true', '(true)');
  if v_abertas is not null then
    raise exception 'Pare: ainda há policy que libera a leitura de pacientes a qualquer login: %', v_abertas;
  end if;
end $$;
