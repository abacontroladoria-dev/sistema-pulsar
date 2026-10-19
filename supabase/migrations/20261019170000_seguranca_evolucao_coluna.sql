-- ═════════════════════════════════════════════════════════════════════════════
-- Segurança — texto da evolução clínica fora do alcance do login (Fase 4 da
-- branch feat/seguranca-falhas-dados)
--
-- TRAVA: aplicar SÓ DEPOIS do redeploy do frontend desta branch e DEPOIS da
-- 20261019140000. O frontend antigo lê `descricao_evolucao` direto do navegador
-- na Auditoria de Evoluções; com esta migration essa leitura dá "permission
-- denied". O primeiro bloco falha de propósito até você trocar `false` por `true`.
--
-- O que muda: `csv_grades_profissionais.descricao_evolucao` (texto da evolução,
-- dado de saúde) sai da leitura por coluna do login. Quem continua lendo:
--   • a Auditoria de Evoluções, pela rota de servidor
--     /api/terapeutico/auditoria-evolucoes/grade (cliente de serviço, depois de
--     conferir a permissão da tela);
--   • a Grade, por grade_detalhe_evolucao() (security definer, só quem pode
--     evoluir vê o texto — 20261019120000);
--   • as funções security definer que contam evoluções (conferência de guias,
--     espelhamento) e o sync (service_role).
--
-- Idempotente. Ver docs/SEGURANCA_DADOS_AGENDA.md.
-- ═════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

do $$
declare
  frontend_desta_branch_publicado boolean := false;
begin
  if not frontend_desta_branch_publicado then
    raise exception 'Pare: publique o frontend da branch feat/seguranca-falhas-dados (redeploy no Coolify) e troque false por true no topo. Nada foi alterado.';
  end if;
end $$;

-- Guardas, antes de qualquer mudança.
do $$
declare
  v_lista text;
begin
  if to_regclass('public.csv_grades_profissionais') is null then
    return;
  end if;

  -- Sem a 20261019140000 o login ainda lê a tabela inteira e revogar uma coluna
  -- não adiantaria nada.
  if has_table_privilege('authenticated', 'public.csv_grades_profissionais', 'SELECT') then
    raise exception 'Pare: aplique antes a 20261019140000_seguranca_correcoes_diretas (leitura por coluna). Nada foi alterado.';
  end if;

  select string_agg(distinct vn.nspname || '.' || v.relname, ', ') into v_lista
  from pg_attribute a
  join pg_depend d on d.refobjid = a.attrelid and d.refobjsubid = a.attnum and d.classid = 'pg_rewrite'::regclass
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class and v.oid <> a.attrelid
  join pg_namespace vn on vn.oid = v.relnamespace
  where a.attrelid = 'public.csv_grades_profissionais'::regclass and a.attname = 'descricao_evolucao';

  if v_lista is not null then
    raise exception 'Pare: estas views leem descricao_evolucao e deixariam de responder ao login: %. Nada foi alterado.', v_lista;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_attribute
              where attrelid = to_regclass('public.csv_grades_profissionais')
                and attname = 'descricao_evolucao' and not attisdropped) then
    revoke select (descricao_evolucao) on public.csv_grades_profissionais from public, anon, authenticated;
  end if;
end $$;

comment on column public.csv_grades_profissionais.descricao_evolucao is
  'Texto da evolução clínica (dado de saúde). Fora da leitura do login (20261019170000): leia por grade_detalhe_evolucao() ou pela rota de servidor da Auditoria de Evoluções.';
