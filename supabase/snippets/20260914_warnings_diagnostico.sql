-- =============================================================================
-- Advisors WARNINGS 2026-09-14 — DIAGNÓSTICO (só lê, não altera nada)
-- =============================================================================
-- Por que este arquivo existe: o relatório do advisor é um SNAPSHOT
-- (2026-09-14T12:26:15Z). Ele pode estar defasado em relação ao banco, e em
-- 14/09 esteve: acusava 16 funções sem search_path e a consulta ao catálogo
-- devolveu ZERO. Fonte de verdade é pg_proc/pg_policy, nunca o texto das
-- migrations nem o relatório.
--
-- Rodar os 5 blocos e comparar com o relatório ANTES de escrever qualquer fix.

-- ---------------------------------------------------------------------------
-- BLOCO 1 — 0011 function_search_path_mutable. Relatório diz 16.
-- Se vier 0, o relatório está defasado e NÃO há trabalho aqui.
-- Sem filtro de prokind de propósito: função de trigger e agregada também
-- contam, e assumir prokind='f' foi um palpite não verificado em 14/09.
-- ---------------------------------------------------------------------------
select 'BLOCO 1 sem search_path' as bloco,
       n.nspname || '.' || p.proname || '(' ||
         pg_get_function_identity_arguments(p.oid) || ')' as objeto,
       p.prokind,
       p.prosecdef as security_definer
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'central')
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                    where c like 'search_path=%')
   and not exists (select 1 from pg_depend d
                    where d.objid = p.oid and d.deptype = 'e')
 order by 2;

-- ---------------------------------------------------------------------------
-- BLOCO 2 — contagem de controle do bloco 1.
-- Prova que a consulta enxerga alguma coisa (um 0/0 seria suspeito).
-- ---------------------------------------------------------------------------
select 'BLOCO 2 cobertura' as bloco,
       count(*) as funcoes_proprias,
       count(*) filter (where p.proconfig is not null) as com_algum_proconfig,
       count(*) filter (
         where exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c like 'search_path=%')) as com_search_path
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'central')
   and not exists (select 1 from pg_depend d
                    where d.objid = p.oid and d.deptype = 'e');

-- ---------------------------------------------------------------------------
-- BLOCO 3 — 0014 extension_in_public. Relatório diz 3 (pg_net, unaccent, http).
-- DECISÃO DE 17/08: NÃO MOVER. Este bloco é só para confirmar que segue igual.
-- Mover pg_net quebra rotinas de sync do TiTa que o chamam sem qualificar.
-- ---------------------------------------------------------------------------
select 'BLOCO 3 extensao em public' as bloco,
       e.extname,
       n.nspname as schema_atual
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
 order by 2;

-- ---------------------------------------------------------------------------
-- BLOCO 4 — 0024 rls_policy_always_true. Relatório diz 22.
-- Este é o trabalho real que sobra. A coluna `ampla_anula_granular` é o que
-- importa: policies permissivas somam com OR, então UMA policy ampla na mesma
-- tabela+comando torna TODAS as granulares ao lado decorativas.
-- ---------------------------------------------------------------------------
select 'BLOCO 4 policy sempre true' as bloco,
       c.relname                as tabela,
       pol.polname              as policy,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                       when 'w' then 'UPDATE' when 'd' then 'DELETE'
                       else 'ALL' end as comando,
       pol.polpermissive        as permissiva,
       (select array_agg(r.rolname) from pg_roles r
         where r.oid = any(pol.polroles)) as papeis,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
 where c.relnamespace = 'public'::regnamespace
   and pol.polpermissive
   and (pg_get_expr(pol.polqual, pol.polrelid) = 'true'
     or pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true')
 order by 2, 4;

-- ---------------------------------------------------------------------------
-- BLOCO 5 — O RISCO do bloco 4, medido.
-- Para cada tabela com policy ampla: quantas granulares existem ao lado.
-- granulares > 0 significa que existe um modelo de papéis DORMENTE ali. Derrubar
-- a ampla o ATIVA de uma vez — e papel não coberto passa a ler ZERO LINHAS SEM
-- ERRO (RLS não grita, ela some com a linha). Foi assim que os 2 usuários `rp`
-- ficaram sem a fila_autorizacoes em 17/08.
-- Enquanto granulares > 0, NÃO derrubar sem enumerar os consumidores da tabela.
-- ---------------------------------------------------------------------------
select 'BLOCO 5 risco por tabela' as bloco,
       c.relname as tabela,
       count(*) filter (
         where pg_get_expr(pol.polqual, pol.polrelid) = 'true'
            or pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true') as amplas,
       count(*) filter (
         where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') <> 'true'
           and coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') <> 'true'
       ) as granulares,
       c.relrowsecurity as rls_ligada,
       c.relforcerowsecurity as force_rls
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
 where c.relnamespace = 'public'::regnamespace
 group by c.relname, c.relrowsecurity, c.relforcerowsecurity
having count(*) filter (
         where pg_get_expr(pol.polqual, pol.polrelid) = 'true'
            or pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true') > 0
 order by 4 desc, 2;
