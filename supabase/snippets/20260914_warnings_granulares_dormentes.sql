-- =============================================================================
-- WARNINGS 0024 — BLOCO 6: o que as granulares DORMENTES dizem (só lê)
-- =============================================================================
-- Contexto: BLOCO 5 mostrou 9 tabelas com `amplas >= 1 AND granulares >= 1`.
-- Nessas, a policy ampla ANULA as granulares ao lado (permissivas somam com OR).
-- Derrubar a ampla não "aperta" a tabela: ATIVA de uma vez um modelo de papéis
-- que nunca teve efeito e nunca foi testado.
--
-- O perigo não é erro, é silêncio: RLS não grita, ela some com a linha. SELECT
-- restrito devolve MENOS linhas com sucesso; UPDATE/DELETE barrados pelo USING
-- afetam ZERO linhas SEM ERRO. Foi assim que os 2 usuários `rp` ficaram sem a
-- fila_autorizacoes em 17/08.
--
-- Este bloco responde: se eu derrubar a ampla, QUEM continua enxergando?

-- ---------------------------------------------------------------------------
-- 6a — as granulares das 9 tabelas de risco, com o texto da regra.
-- Ler cada `using_expr` perguntando: "que papéis isto cobre?"
-- ---------------------------------------------------------------------------
select c.relname as tabela,
       pol.polname as policy,
       case pol.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                       when 'w' then 'UPDATE' when 'd' then 'DELETE'
                       else 'ALL' end as comando,
       case when pg_get_expr(pol.polqual, pol.polrelid) = 'true'
              or pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true'
            then '>>> AMPLA (anula as outras)' else 'granular' end as tipo,
       (select array_agg(r.rolname) from pg_roles r
         where r.oid = any(pol.polroles)) as papeis,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('controle_terapeutico','chamada_paciente','pacientes',
                     'alertas_regras','itens_padrao_compra','logs',
                     'permissoes','sinonimos_item_compra','sync_controle')
 order by c.relname, tipo desc, comando;

-- ---------------------------------------------------------------------------
-- 6b — o censo de papéis. É a régua contra a qual ler o 6a.
-- Qualquer papel ATIVO que não apareça coberto numa granular perde a tabela
-- no instante em que a ampla cair.
-- ---------------------------------------------------------------------------
select coalesce(role, '(null)') as papel,
       count(*) filter (where ativo)     as ativos,
       count(*) filter (where not ativo) as inativos
  from public.usuarios
 group by role
 order by 2 desc nulls last;

-- ---------------------------------------------------------------------------
-- 6c — `logs`: 3 policies de INSERT idênticas (o advisor conta 3 warnings).
-- Aqui não há decisão de produto: são duplicatas exatas. Manter UMA e apagar
-- as outras duas fecha 2 warnings sem mudar comportamento nenhum.
-- Confirma que as 3 são mesmo equivalentes antes de apagar.
-- ---------------------------------------------------------------------------
select pol.polname,
       case pol.polcmd when 'a' then 'INSERT' else pol.polcmd::text end as cmd,
       (select array_agg(r.rolname) from pg_roles r
         where r.oid = any(pol.polroles)) as papeis,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
 where c.relnamespace = 'public'::regnamespace
   and c.relname = 'logs'
 order by 1;

-- ---------------------------------------------------------------------------
-- 6d — volume das 3 `acomp_*` + agenda_orbita (granulares = 0).
-- Serve para saber se a aba Acompanhamento ainda é usada de verdade ou se
-- virou tabela morta pós-localStorage. Tabela morta muda a conversa: em vez de
-- desenhar policy, a pergunta passa a ser se a tabela deveria existir.
-- ---------------------------------------------------------------------------
select 'acomp_conf'        as tabela, count(*) as linhas,
       max(atualizado_em)::date as ultima_escrita from public.acomp_conf
union all
select 'acomp_pac_bundles', count(*), max(atualizado_em)::date from public.acomp_pac_bundles
union all
select 'acomp_prof_map',    count(*), max(atualizado_em)::date from public.acomp_prof_map
 order by 2 desc;
