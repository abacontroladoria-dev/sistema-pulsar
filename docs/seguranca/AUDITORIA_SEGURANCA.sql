-- ═════════════════════════════════════════════════════════════════════════════
-- AUDITORIA DE SEGURANÇA — SÓ LEITURA. Rodar no SQL Editor do Supabase, bloco a
-- bloco (cada SELECT é um relatório). Nada aqui altera o banco.
--
-- Mostra o estado REAL de produção (as migrations do repositório não são a
-- verdade: há dessincronia conhecida). Resultado esperado de cada bloco está
-- no comentário dele. Linha que aparecer onde se espera vazio = achado.
-- Ver docs/SEGURANCA_DADOS_AGENDA.md.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. Tabelas dos schemas expostos SEM RLS. Esperado: vazio.
select n.nspname as schema, c.relname as tabela
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and n.nspname in ('public', 'central')
  and not c.relrowsecurity
order by 1, 2;

-- 2. O que o anon (chave pública, qualquer pessoa na internet) pode fazer em
--    tabelas e views. Esperado: vazio (ou só objetos públicos de propósito,
--    como a TV da recepção).
select table_schema, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where grantee in ('anon', 'PUBLIC')
  and table_schema in ('public', 'central', 'storage')
group by 1, 2
order by 1, 2;

-- 3. Policies que liberam tudo (USING true / sem condição) para anon ou
--    authenticated. Esperado: só tabelas sem dado pessoal. Toda linha aqui com
--    paciente, profissional, agenda ou evolução é achado.
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname in ('public', 'central', 'storage')
  and (coalesce(qual, 'true') in ('true', '(true)') or coalesce(with_check, '') in ('true', '(true)'))
order by 1, 2, 3;

-- 4. Tabelas sensíveis: RLS, FORCE e policies (matriz tabela × papel).
with sensiveis(t) as (values
  ('pacientes'), ('pacientes_importacoes_log'), ('pacientes_disponibilidade_versoes'),
  ('profissionais'), ('profissionais_terapias_habilitadas'),
  ('profissionais_disponibilidade_versoes'), ('profissionais_disponibilidade_faixas'),
  ('profissionais_disponibilidade_eventos'),
  ('grade_agendamentos'), ('grade_series'), ('grade_bloqueios'), ('grade_eventos'),
  ('grade_importacoes'), ('grade_importacoes_itens'), ('tita_importacoes'), ('tita_importacoes_itens'),
  ('csv_grades_profissionais'), ('agenda_tita'), ('grade_profissionais_tita'), ('controle_terapeutico'),
  ('cadastros_auditoria'), ('sistema_tita_corte')
)
select s.t as tabela,
       c.relrowsecurity as rls,
       c.relforcerowsecurity as force_rls,
       (select string_agg(p.policyname || ' [' || p.cmd || ' → ' || array_to_string(p.roles, ',') || '] ' || coalesce(p.qual, '—'), E'\n')
          from pg_policies p where p.schemaname = 'public' and p.tablename = s.t) as policies,
       (select string_agg(distinct g.grantee || ':' || g.privilege_type, ', ')
          from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = s.t and g.grantee in ('anon', 'authenticated', 'PUBLIC')) as grants
from sensiveis s
left join pg_class c on c.relname = s.t and c.relnamespace = 'public'::regnamespace
order by 1;

-- 5. Colunas sensíveis legíveis por authenticated (CPF, telefone, evolução).
--    Esperado: só em tabelas cuja RLS restringe por permissão (bloco 4).
--    Depois de 20261019140000: nenhuma linha de grade_profissionais_tita nem de
--    csv_grades_profissionais com cpf/telefone (leitura por coluna).
select table_name, column_name
from information_schema.column_privileges
where grantee = 'authenticated' and privilege_type = 'SELECT' and table_schema = 'public'
  and column_name ~* '(cpf|telefone|celular|evolucao|responsavel_email|data_nascimento|carteirinha)'
order by 1, 2;

-- 6. Views que NÃO respeitam a RLS de quem consulta (sem security_invoker).
--    Esperado: vazio para views sobre dado pessoal.
select n.nspname as schema, c.relname as view
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v'
  and n.nspname in ('public', 'central')
  and not coalesce((select bool_or(o = 'security_invoker=true' or o = 'security_invoker=on')
                    from unnest(c.reloptions) o), false)
order by 1, 2;

-- 7. Funções SECURITY DEFINER sem search_path fixo (risco de sequestro de
--    função). Esperado: vazio.
select n.nspname as schema, p.proname as funcao, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname in ('public', 'central')
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')
order by 1, 2;

-- 8. Funções que o anon pode executar. Esperado: só as públicas de propósito
--    (formulário público, TV). Toda SECURITY DEFINER aqui merece olhar.
select n.nspname as schema, p.proname as funcao, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'central')
  and has_function_privilege('anon', p.oid, 'EXECUTE')
  and p.prokind = 'f'
order by p.prosecdef desc, 1, 2;

-- 9. Buckets de arquivos. Esperado: public = false para foto, assinatura,
--    documento e contrato.
select id, name, public, file_size_limit, allowed_mime_types from storage.buckets order by 1;

-- 10. pg_graphql: se não é usado, a extensão é uma segunda porta para o mesmo
--     dado. Esperado: vazio (ou desligar).
select extname, extversion from pg_extension where extname = 'pg_graphql';

-- 11. Contas ativas com papel amplo (admin/diretoria veem tudo). Conferir se
--     cada uma ainda precisa — e se quem saiu da clínica está inativo.
select nome, email, role, ativo from public.usuarios where role in ('admin', 'diretoria') order by ativo desc, nome;

-- 12. Trilhas que deveriam ser imutáveis: gatilhos que recusam UPDATE/DELETE.
select event_object_table as tabela, trigger_name, string_agg(event_manipulation, ',') as eventos
from information_schema.triggers
where trigger_schema = 'public'
  and event_object_table in ('grade_eventos', 'profissionais_disponibilidade_eventos', 'pacientes_disponibilidade_versoes',
                             'cadastros_auditoria', 'cronograma_salas_auditoria')
group by 1, 2
order by 1;
