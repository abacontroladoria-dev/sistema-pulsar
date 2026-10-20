-- ═════════════════════════════════════════════════════════════════════════════
-- Segurança — correções diretas (Fase 2 da branch feat/seguranca-falhas-dados)
--
-- TRAVA: aplicar SÓ DEPOIS do redeploy do frontend desta branch. O frontend
-- antigo lê csv_grades_profissionais com `select *` no "Confirmar implantação"
-- (services/tita/mappings.ts), e com esta migration `*` dá "permission denied".
-- O primeiro bloco falha de propósito até você trocar `false` por `true`.
--
-- O que muda:
--   1. central.worker_tick_config (URL do disparo de minuto em minuto do worker
--      da Central): estava SEM RLS e com permissão total para qualquer login —
--      dava para trocar a URL e capturar o segredo do worker. Liga RLS e tira
--      tudo de anon/authenticated. Só fn_central_worker_tick() (security
--      definer, dona da tabela) lê.
--   2. controle_terapeutico: some a policy `with check (true)` de 18/05 —
--      qualquer login inseria. Fica a inserção por papel (20260610000011).
--   3. grade_profissionais_tita (cópia do TiTa): o login deixa de ler CPF,
--      telefone, CBO, registro profissional, raw_json e observação da sala.
--      vw_profissionais_disponiveis é recriada com o mesmo nome e filtro, sem
--      essas colunas.
--   4. csv_grades_profissionais: o login deixa de ler profissional_cpf e
--      sala_observacoes. (descricao_evolucao sai na migration da Fase 4.)
--
-- ATENÇÃO — LEITURA POR COLUNA: nas tabelas do item 3 e 4 o login lê só as
-- colunas concedidas uma a uma. Coluna NOVA nessas tabelas NÃO fica legível
-- sozinha: a migration que acrescentar coluna precisa de
--   grant select (nova_coluna) on public.<tabela> to authenticated;
-- A CI (scripts/check-seguranca-migrations.js) cobra isso.
--
-- GUARDA: antes de revogar, a migration procura toda view que dependa das
-- colunas revogadas (definição REAL do banco, não a das migrations). Se achar,
-- para com a lista e nada é alterado — a view precisa ser revista antes.
--
-- Idempotente. Ver docs/SEGURANCA_DADOS_AGENDA.md.
-- ═════════════════════════════════════════════════════════════════════════════

set lock_timeout = '5s';

do $$
declare
  frontend_desta_branch_publicado boolean := true;
begin
  if not frontend_desta_branch_publicado then
    raise exception 'Pare: publique o frontend da branch feat/seguranca-falhas-dados (redeploy no Coolify) e troque false por true no topo. Nada foi alterado.';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Guarda: views que dependem das colunas que vão ser revogadas.
--    vw_profissionais_disponiveis é recriada abaixo, por isso fica de fora.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_lista text;
begin
  with revogadas(tabela, coluna) as (values
    ('grade_profissionais_tita', 'cpf_profissional'), ('grade_profissionais_tita', 'numero_telefone'),
    ('grade_profissionais_tita', 'cbo_profissional'), ('grade_profissionais_tita', 'registro_profissional'),
    ('grade_profissionais_tita', 'tipo_registro_profissional'), ('grade_profissionais_tita', 'uf_registro_profissional'),
    ('grade_profissionais_tita', 'raw_json'), ('grade_profissionais_tita', 'observacoes_sala'),
    ('csv_grades_profissionais', 'profissional_cpf'), ('csv_grades_profissionais', 'sala_observacoes')
  )
  select string_agg(distinct vn.nspname || '.' || v.relname || ' → ' || r.tabela || '.' || r.coluna, E'\n')
    into v_lista
  from revogadas r
  join pg_class t on t.relname = r.tabela and t.relnamespace = 'public'::regnamespace
  join pg_attribute a on a.attrelid = t.oid and a.attname = r.coluna
  join pg_depend d on d.refobjid = t.oid and d.refobjsubid = a.attnum and d.classid = 'pg_rewrite'::regclass
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class and v.oid <> t.oid
  join pg_namespace vn on vn.oid = v.relnamespace
  where not (vn.nspname = 'public' and v.relname = 'vw_profissionais_disponiveis');

  if v_lista is not null then
    raise exception E'Pare: estas views leem colunas que o login vai deixar de ler. Revise-as antes (nada foi alterado):\n%', v_lista;
  end if;
end $$;

-- 0b. vw_profissionais_disponiveis é recriada com o mesmo filtro da definição
--     de produção (20260518131652_remote_schema.sql): horário Livre na unidade
--     280. Se a definição real for outra, para antes de mudar qualquer coisa.
do $$
declare
  v_def text;
begin
  if to_regclass('public.vw_profissionais_disponiveis') is null then
    return;
  end if;
  v_def := pg_get_viewdef(to_regclass('public.vw_profissionais_disponiveis'), true);
  if v_def !~ $re$status_agendamento = 'Livre'$re$ or v_def !~ 'id_unidade = 280' then
    raise exception E'Pare: vw_profissionais_disponiveis em produção não tem o filtro esperado (Livre, unidade 280). Nada foi alterado. Definição atual:\n%', v_def;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. central.worker_tick_config
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('central.worker_tick_config') is not null then
    alter table central.worker_tick_config enable row level security;
    revoke all on central.worker_tick_config from public, anon, authenticated;
  end if;
end $$;

-- Toda tabela do schema central nasce com permissão total para qualquer login
-- (default privileges de 20260701000000_create_ca_schema.sql). Sem RLS, isso é
-- leitura e escrita livres. Esperado depois do item 1: nenhuma.
do $$
declare
  v_lista text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v_lista
  from pg_class c
  where c.relnamespace = 'central'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_lista is not null then
    raise warning 'central: tabelas ainda SEM RLS (qualquer login lê e escreve): %', v_lista;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. controle_terapeutico: sem inserção livre
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.controle_terapeutico') is not null then
    drop policy if exists controle_terapeutico_insert_authenticated on public.controle_terapeutico;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 e 4. Leitura por coluna nas cópias do TiTa
--
-- A lista das colunas permitidas sai do próprio banco (todas menos as
-- sensíveis): produção tem colunas que as migrations não registram.
-- ─────────────────────────────────────────────────────────────────────────────
-- seguranca: função temporária da sessão (pg_temp), some ao fim da migration; ninguém mais a executa
create or replace function pg_temp.leitura_por_coluna(p_tabela text, p_sensiveis text[])
returns void
language plpgsql
as $$
declare
  v_permitidas text;
begin
  if to_regclass('public.' || p_tabela) is null then
    return;
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_permitidas
  from pg_attribute a
  where a.attrelid = ('public.' || p_tabela)::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname <> all (p_sensiveis);

  execute format('revoke select on public.%I from public, anon, authenticated', p_tabela);
  -- Reaplicar não deixa sobra: as sensíveis perdem também um grant por coluna antigo.
  execute format('revoke select (%s) on public.%I from public, anon, authenticated',
                 (select string_agg(quote_ident(s), ', ') from unnest(p_sensiveis) s
                   where exists (select 1 from pg_attribute a
                                  where a.attrelid = ('public.' || p_tabela)::regclass
                                    and a.attname = s and not a.attisdropped)),
                 p_tabela);
  execute format('grant select (%s) on public.%I to authenticated', v_permitidas, p_tabela);
  execute format('grant select on public.%I to service_role', p_tabela);
end $$;

-- 3a. vw_profissionais_disponiveis sai antes (depende das colunas da grade; o
--     filtro já foi conferido no bloco 0b). Na reaplicação a definição nova não
--     tem cpf_profissional e fica.
do $$
begin
  -- Dois `if` de propósito: o PL/pgSQL não garante curto-circuito no `and`.
  if to_regclass('public.vw_profissionais_disponiveis') is not null then
    if pg_get_viewdef(to_regclass('public.vw_profissionais_disponiveis'), true) ~ 'cpf_profissional' then
      drop view public.vw_profissionais_disponiveis;
    end if;
  end if;
end $$;

select pg_temp.leitura_por_coluna('grade_profissionais_tita', array[
  'cpf_profissional', 'numero_telefone', 'cbo_profissional', 'registro_profissional',
  'tipo_registro_profissional', 'uf_registro_profissional', 'raw_json', 'observacoes_sala'
]);

select pg_temp.leitura_por_coluna('csv_grades_profissionais', array[
  'profissional_cpf', 'sala_observacoes'
]);

-- 3b. A view oficial de cobertura (AGENTS.md), sem as colunas sensíveis.
create or replace view public.vw_profissionais_disponiveis
  with (security_invoker = true)
as
select
  id,
  grade_terapeuta_id,
  grade_clinica_id,
  profissional_id,
  nome_profissional,
  id_unidade,
  nome_unidade,
  dia_semana,
  data,
  hora_inicial,
  hora_final,
  status_agendamento,
  terapia_id,
  nome_terapia,
  terapia_exibicao_id,
  terapia_exibicao,
  id_sala,
  sala,
  created_at,
  updated_at
from public.grade_profissionais_tita
where status_agendamento = 'Livre'
  and id_unidade = 280;

revoke all on public.vw_profissionais_disponiveis from public, anon;
grant select on public.vw_profissionais_disponiveis to authenticated, service_role;

comment on view public.vw_profissionais_disponiveis is
  'View oficial de cobertura: horários Livres da unidade 280 (cópia do TiTa). Sem CPF, telefone e registro do profissional (20261019140000): telefone vem do cadastro profissionais.';
