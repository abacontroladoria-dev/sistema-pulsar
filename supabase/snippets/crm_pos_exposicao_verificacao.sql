-- CRM — verificação DEPOIS de expor o schema e aplicar os grants
--
-- Rode este arquivo somente após:
--   1. aplicar a migration 20260909150000_crm_grants_explicitos.sql
--   2. adicionar `crm` em Settings → API → Exposed schemas (dashboard Supabase)
--
-- SOMENTE LEITURA.

-- ============================================================================
-- 1. Os grants chegaram?
--
-- ESPERADO: 6 tabelas, cada uma com "DELETE, INSERT, SELECT, UPDATE".
-- Qualquer linha com "(NENHUM)" significa que a migration não foi aplicada —
-- e o sintoma na tela será 403 em toda leitura, mesmo com o RLS correto,
-- porque o Postgres checa o grant de tabela ANTES de avaliar a policy.
-- ============================================================================
select
  t.tablename,
  coalesce(
    string_agg(distinct g.privilege_type, ', ' order by g.privilege_type)
      filter (where g.grantee = 'authenticated'),
    '(NENHUM — a migration de grants não foi aplicada)'
  ) as authenticated
from pg_tables t
left join information_schema.role_table_grants g
  on g.table_schema = t.schemaname
 and g.table_name   = t.tablename
 and g.grantee = 'authenticated'
where t.schemaname = 'crm'
group by t.tablename
order by t.tablename;

-- ============================================================================
-- 2. O funil tem estágios — e em qual organização?
--
-- O Kanban desenha uma coluna por estágio. Se vier VAZIO, o board aparece sem
-- colunas: não é erro de carregamento, é funil não configurado.
--
-- Atenção ao organization_id: as policies filtram por
-- central.current_organization_id(). Estágio semeado numa org diferente da do
-- usuário logado fica invisível, e o sintoma é idêntico ao de não existir.
--
-- Confira se o organization_id abaixo bate com o do SEU usuário (seção 4).
-- ============================================================================
select
  s.organization_id,
  o.name     as organizacao,
  s.position,
  s.title,
  s.is_system,
  s.auto_win,
  s.auto_lose
from crm.pipeline_stages s
left join central.organizations o on o.id = s.organization_id
where s.is_active
order by s.organization_id, s.position;

-- ============================================================================
-- 3. Há algum estágio de fechamento?
--
-- auto_win / auto_lose são o que faz um card arrastado para "Ganho" fechar o
-- negócio. NÃO existe trigger no banco para isso: quem aplica é o DealService
-- (frontend/modules/comercial/services/deal.service.ts).
--
-- Se nenhuma linha tiver auto_win = true, arrastar para a coluna de ganho vai
-- mover o card mas o negócio segue 'open' — e o Dashboard não contará a
-- conversão. Nesse caso, marque a flag no estágio correspondente.
-- ============================================================================
select
  count(*) filter (where auto_win)  as estagios_de_ganho,
  count(*) filter (where auto_lose) as estagios_de_perda,
  case
    when count(*) filter (where auto_win) = 0
      then 'ATENÇÃO: nenhum estágio fecha como ganho — marque auto_win no estágio final'
    else 'ok'
  end as diagnostico
from crm.pipeline_stages
where is_active;

-- ============================================================================
-- 4. O SEU usuário tem acesso ao CRM?
--
-- As policies exigem central_role in ('admin','director'). Um usuário com
-- central_role nulo ou diferente disso vê o Kanban vazio mesmo com deals no
-- banco — a policy filtra tudo, silenciosamente.
--
-- organization_id precisa bater com o da seção 2.
-- ============================================================================
select
  u.nome,
  u.email,
  u.organization_id,
  u.central_role,
  u.ativo,
  case
    when not u.ativo                                   then 'INATIVO — não autentica'
    when u.organization_id is null                     then 'SEM ORGANIZAÇÃO — extractUser recusa'
    when u.central_role is null                        then 'SEM central_role — sem acesso à Central/CRM'
    when u.central_role not in ('admin','director')    then 'central_role sem permissão no CRM'
    else 'ok — enxerga o CRM'
  end as diagnostico
from public.usuarios u
where u.ativo
order by u.central_role nulls last, u.nome;

-- ============================================================================
-- 5. Volume atual
--
-- Zero em deals é o estado esperado nesta fase: a operação comercial ainda
-- não usa o funil do Pulsar. O Dashboard mostra esses zeros com um aviso
-- explicando o porquê, em vez dos números fixos que exibia antes.
-- ============================================================================
select 'crm.deals (abertos)' as item, count(*) as total from crm.deals where status = 'open'
union all select 'crm.deals (ganhos)',    count(*) from crm.deals where status = 'won'
union all select 'crm.deals (perdidos)',  count(*) from crm.deals where status = 'lost'
union all select 'crm.deal_activities',   count(*) from crm.deal_activities
union all select 'central.contacts (lead)', count(*) from central.contacts where contact_type = 'lead'
union all select 'central.contacts (total)', count(*) from central.contacts
order by item;
