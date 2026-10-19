-- ═════════════════════════════════════════════════════════════════════════════
-- FASE 6 (cópia da agenda do TiTa, agenda_tita) — EXPORTAR DEFINIÇÕES DE
-- PRODUÇÃO. SÓ LEITURA: nada aqui altera o banco.
--
-- Produção recebeu ajustes à mão que as migrations não têm. A Fase 6 só é
-- escrita a partir do que este arquivo devolver. Rode bloco a bloco no SQL
-- Editor e mande o resultado de cada um (o bloco 6.0 junta tudo num texto só:
-- use "Copy cell" e cole num arquivo .txt).
-- ═════════════════════════════════════════════════════════════════════════════

-- 6.0 TUDO NUM TEXTO SÓ (para copiar de uma vez). Pode ser longo.
with funcoes as (
  select 'FUNCAO ' || p.oid::regprocedure::text
         || E'\n-- security_definer=' || p.prosecdef || E'\n'
         || pg_get_functiondef(p.oid) as bloco
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('listar_central_autorizacoes', 'listar_central_pacientes', 'get_tokens_mensal',
                      'get_auditoria_assim_periodo', 'fn_blocos_assim', 'listar_pacientes_assim',
                      'sp_listar_pacientes_assim_interno', 'get_auditoria_assim', 'get_auditoria_assim_resumo',
                      'get_faltas_auditoria_assim', 'guias_avulsas')
),
views as (
  select 'VIEW ' || n.nspname || '.' || c.relname
         || E'\n-- reloptions=' || coalesce(array_to_string(c.reloptions, ','), '(nenhuma)') || E'\n'
         || pg_get_viewdef(c.oid, true) as bloco
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('v', 'm')
    and n.nspname = 'public'
    and c.relname in ('agenda_tita_autorizacao', 'agenda_tita_autorizacao_v2', 'vw_central_autorizacoes',
                      'vw_match_autorizacoes_assim', 'vw_blocos_autorizaveis_assim', 'vw_auditoria_autorizacoes_assim',
                      'vw_kpis_auditoria_assim', 'vw_central_pacientes', 'vw_central_terapeutica')
)
select string_agg(bloco, E'\n\n-- ════════════════════════════════════════\n\n' order by bloco) as definicoes
from (select bloco from funcoes union all select bloco from views) x;

-- 6.1 Toda view que lê agenda_tita (direto), com as colunas sensíveis que usa
--     e se roda como quem consulta (security_invoker).
with sensiveis(coluna) as (values
  ('cpf'), ('data_nascimento'), ('profissional_cpf'), ('numero_carteirinha'), ('responsavel_nome'),
  ('responsavel_telefone'), ('responsavel_email'), ('raw_json'), ('sala_observacoes'), ('crm'), ('nome_medico')
)
select vn.nspname || '.' || v.relname as view,
       coalesce((select bool_or(o in ('security_invoker=true', 'security_invoker=on')) from unnest(v.reloptions) o), false) as invoker,
       string_agg(distinct a.attname, ', ' order by a.attname) filter (where a.attname in (select coluna from sensiveis)) as colunas_sensiveis
from pg_depend d
join pg_rewrite rw on rw.oid = d.objid
join pg_class v on v.oid = rw.ev_class
join pg_namespace vn on vn.oid = v.relnamespace
left join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
where d.refobjid = 'public.agenda_tita'::regclass and v.oid <> 'public.agenda_tita'::regclass
group by 1, 2
order by 1;

-- 6.2 Views que leem as views da cadeia de autorização (segundo nível).
select distinct src.relname as view_lida, dep.relname as lida_por, dep.relkind
from pg_depend d
join pg_rewrite rw on rw.oid = d.objid
join pg_class dep on dep.oid = rw.ev_class
join pg_class src on src.oid = d.refobjid
where src.relname in ('agenda_tita_autorizacao', 'agenda_tita_autorizacao_v2', 'vw_central_autorizacoes',
                      'vw_match_autorizacoes_assim', 'vw_blocos_autorizaveis_assim', 'vw_auditoria_autorizacoes_assim',
                      'vw_kpis_auditoria_assim', 'vw_central_pacientes')
  and dep.oid <> src.oid
order by 1, 2;

-- 6.3 Funções que citam agenda_tita ou as views da cadeia, com o tipo de
--     segurança (as que NÃO são security definer rodam como quem chama).
select p.oid::regprocedure as funcao, p.prosecdef as security_definer,
       (p.prosrc ~ '\magenda_tita\M') as le_agenda_tita
from pg_proc p
where p.pronamespace in ('public'::regnamespace, 'central'::regnamespace)
  and p.prokind = 'f'
  and p.prosrc ~ '(\magenda_tita\M|agenda_tita_autorizacao|vw_central_autorizacoes|vw_match_autorizacoes_assim|vw_blocos_autorizaveis_assim|vw_auditoria_autorizacoes_assim|vw_kpis_auditoria_assim|vw_central_pacientes)'
order by 2, 1;

-- 6.4 Quem chama as 5 funções que vão ganhar checagem de permissão (outra
--     função ou rotina do pg_cron). Chamada sem usuário logado passaria a ser
--     recusada — preciso saber de todas.
select 'funcao' as origem, p.oid::regprocedure::text as quem, alvo
from pg_proc p
cross join unnest(array['listar_central_autorizacoes', 'listar_central_pacientes', 'get_tokens_mensal',
                        'get_auditoria_assim_periodo', 'fn_blocos_assim']) as alvo
where p.pronamespace in ('public'::regnamespace, 'central'::regnamespace)
  and p.proname <> alvo
  and p.prosrc ~ ('\m' || alvo || '\M')
union all
select 'cron', j.jobname, alvo
from cron.job j
cross join unnest(array['listar_central_autorizacoes', 'listar_central_pacientes', 'get_tokens_mensal',
                        'get_auditoria_assim_periodo', 'fn_blocos_assim']) as alvo
where j.command ~ ('\m' || alvo || '\M')
order by 1, 2;

-- 6.5 Permissões atuais do login nas views da cadeia e em agenda_tita.
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public'
  and table_name in ('agenda_tita', 'agenda_tita_autorizacao', 'agenda_tita_autorizacao_v2', 'vw_central_autorizacoes',
                     'vw_match_autorizacoes_assim', 'vw_blocos_autorizaveis_assim', 'vw_auditoria_autorizacoes_assim',
                     'vw_kpis_auditoria_assim', 'vw_central_pacientes')
group by 1
order by 1;

-- 6.6 Colunas reais de agenda_tita em produção.
select string_agg(column_name, ', ' order by ordinal_position) as colunas
from information_schema.columns
where table_schema = 'public' and table_name = 'agenda_tita';
