-- Pacote: carrossel de avisos da TV (/tv-avisos, /tv) + papel `marketing`.
--
-- Junta 6 migrations que já estão na main mas NUNCA entraram em produção (nem
-- no banco, nem no livro-caixa `supabase_migrations.schema_migrations`):
--
--   20260831150000_tv_avisos.sql
--   20260831150100_seed_permissao_tv_avisos.sql
--   20260910120000_add_role_marketing.sql
--   20260910120100_tv_avisos_papel_marketing.sql
--   20260910120200_permissao_tv_avisos_grupo_marketing.sql
--   20260910120300_grupo_permissoes_marketing.sql
--
-- É por isso que duas imagens de teste subidas em /tv-avisos não aparecem na
-- TV mesmo após F5: a tabela `tv_avisos`, o bucket `tv-avisos`, a RLS e as
-- permissões associadas não existem em produção. Se o upload não deu erro
-- visível, é o padrão já documentado dentro da própria 20260831150000: RLS
-- bloqueando WRITE não estoura erro no frontend, a gravação "funciona" e não
-- grava (ou, mais provável aqui, a tabela/bucket simplesmente não existiam
-- ainda e o insert falhou silenciosamente em algum catch genérico).
--
-- Ordem interna preservada: tabela+RLS+bucket → seed da permissão → role
-- `marketing` → RLS/policies do bucket passam a aceitar o papel → permissão
-- muda de grupo visual → grupo de permissões semente. Cada bloco é
-- reexecutável (create table/index if not exists, create or replace, drop+
-- create de policy, on conflict do nothing), então rodar de novo não quebra.
--
-- ⚠️ Bloco do BUCKET (dentro da primeira migration) e as policies de
-- storage.objects da quarta migration: `storage.objects` pertence a
-- `supabase_storage_admin`. Se o SQL Editor recusar com "must be owner of
-- table objects", recrie as policies pelo Dashboard (Storage > tv-avisos >
-- Policies) usando EXATAMENTE as expressões abaixo, e comente esses trechos
-- aqui antes de rodar o resto.

begin;

-- ============================================================
-- 20260831150000_tv_avisos.sql
-- ============================================================

create table if not exists public.tv_avisos (
  id uuid primary key default gen_random_uuid(),
  caminho text not null,
  titulo text,
  ordem int not null default 0,
  ativo boolean not null default true,
  criado_em       timestamptz not null default now(),
  criado_por_id   uuid references public.usuarios(id),
  criado_por_nome text,
  atualizado_em       timestamptz not null default now(),
  atualizado_por_id   uuid references public.usuarios(id),
  atualizado_por_nome text,
  atualizado_em_brasilia text
);

create index if not exists idx_tv_avisos_ativos
  on public.tv_avisos (ordem, criado_em)
  where ativo;

create or replace function public.set_tv_avisos_atualizado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  new.atualizado_em_brasilia :=
    to_char(new.atualizado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
  return new;
end;
$$;

drop trigger if exists trg_tv_avisos_atualizado on public.tv_avisos;
create trigger trg_tv_avisos_atualizado
  before insert or update on public.tv_avisos
  for each row execute function public.set_tv_avisos_atualizado();

comment on table public.tv_avisos is
  'Fila de imagens do carrossel de avisos da TV da recepção (/tv), mantida pelo marketing em /tv-avisos. Aparece apenas no estado de ESPERA do painel esquerdo — a chamada de paciente tem precedência e ocupa a tela sozinha. Sem nenhum aviso ativo, a TV volta à ilustração fixa "Atendimento em andamento".';
comment on column public.tv_avisos.caminho is
  'Path do objeto no bucket `tv-avisos`, nunca a URL. Cada troca grava um objeto NOVO: sobrescrever o path faria a TV, que nunca recarrega, continuar servindo o cartaz antigo.';
comment on column public.tv_avisos.titulo is
  'Rótulo interno para o marketing se localizar na lista. NÃO é exibido na TV.';
comment on column public.tv_avisos.ordem is
  'Sequência no carrossel, reescrita em bloco pelas setas da UI. Empate desfeito por criado_em para a ordenação ser sempre total.';
comment on column public.tv_avisos.ativo is
  'Tira do ar sem apagar o objeto — campanha sazonal volta no ano seguinte.';

alter table public.tv_avisos enable row level security;

do $$
declare
  pol record;
  cond constant text :=
    '(public.usuario_tem_permissao(''tv_avisos'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'']))';
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'tv_avisos'
  loop
    execute format('drop policy %I on public.tv_avisos', pol.policyname);
  end loop;

  execute format(
    'create policy tv_avisos_select on public.tv_avisos'
    || ' for select to authenticated using (%s)', cond);
  execute format(
    'create policy tv_avisos_insert on public.tv_avisos'
    || ' for insert to authenticated with check (%s)', cond);
  execute format(
    'create policy tv_avisos_update on public.tv_avisos'
    || ' for update to authenticated using (%s) with check (%s)', cond, cond);
  execute format(
    'create policy tv_avisos_delete on public.tv_avisos'
    || ' for delete to authenticated using (%s)', cond);
end $$;

revoke all on public.tv_avisos from public;
revoke all on public.tv_avisos from anon;
revoke all on public.tv_avisos from authenticated;
grant select, insert, update, delete on public.tv_avisos to authenticated;

alter table public.tv_avisos force row level security;

-- ===== BUCKET (ver aviso de ownership no topo do arquivo) =====

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tv-avisos',
  'tv-avisos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tv_avisos_objects_select" on storage.objects;
drop policy if exists "tv_avisos_objects_insert" on storage.objects;
drop policy if exists "tv_avisos_objects_update" on storage.objects;
drop policy if exists "tv_avisos_objects_delete" on storage.objects;

create policy "tv_avisos_objects_select"
  on storage.objects for select
  to public
  using (bucket_id = 'tv-avisos');

create policy "tv_avisos_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  );

create policy "tv_avisos_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  )
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  );

create policy "tv_avisos_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria'])
    )
  );

-- ============================================================
-- 20260831150100_seed_permissao_tv_avisos.sql
-- ============================================================

INSERT INTO public.permissoes (codigo, nome, rota, grupo, descricao) VALUES
  ('tv_avisos', 'Avisos da TV', '/tv-avisos', 'Marketing',
   'Imagens do carrossel de avisos exibido na TV da recepção enquanto ninguém está sendo chamado')
ON CONFLICT (codigo) DO NOTHING;

-- ============================================================
-- 20260910120000_add_role_marketing.sql
-- ============================================================

DO $$
DECLARE
  allowed     text[] := ARRAY[
    'admin','diretoria','recepcao','autorizacao','terapeutico',
    'faturamento','rp','cronograma','disponibilidade_terapeuta','marketing'
  ];
  extra_role  text;
BEGIN
  FOR extra_role IN
    SELECT DISTINCT role FROM public.usuarios WHERE role IS NOT NULL
  LOOP
    IF NOT (extra_role = ANY(allowed)) THEN
      allowed := array_append(allowed, extra_role);
      RAISE NOTICE 'Role existente não mapeado incluído no constraint: %', extra_role;
    END IF;
  END LOOP;

  ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_role_check;

  EXECUTE format(
    'ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_role_check CHECK (role IN (%s))',
    (SELECT string_agg(quote_literal(r), ',') FROM unnest(allowed) AS r)
  );

  RAISE NOTICE 'Constraint usuarios_role_check criado com roles: %', array_to_string(allowed, ', ');
END;
$$;

-- ============================================================
-- 20260910120100_tv_avisos_papel_marketing.sql
-- ============================================================

-- ===== RLS da tabela =====

do $$
declare
  pol record;
  cond constant text :=
    '(public.usuario_tem_permissao(''tv_avisos'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'',''marketing'']))';
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'tv_avisos'
  loop
    execute format('drop policy %I on public.tv_avisos', pol.policyname);
  end loop;

  execute format(
    'create policy tv_avisos_select on public.tv_avisos'
    || ' for select to authenticated using (%s)', cond);
  execute format(
    'create policy tv_avisos_insert on public.tv_avisos'
    || ' for insert to authenticated with check (%s)', cond);
  execute format(
    'create policy tv_avisos_update on public.tv_avisos'
    || ' for update to authenticated using (%s) with check (%s)', cond, cond);
  execute format(
    'create policy tv_avisos_delete on public.tv_avisos'
    || ' for delete to authenticated using (%s)', cond);
end $$;

-- ===== Policies do bucket (ver aviso de ownership no topo do arquivo) =====

drop policy if exists "tv_avisos_objects_insert" on storage.objects;
drop policy if exists "tv_avisos_objects_update" on storage.objects;
drop policy if exists "tv_avisos_objects_delete" on storage.objects;

create policy "tv_avisos_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  );

create policy "tv_avisos_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  )
  with check (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  );

create policy "tv_avisos_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'tv-avisos'
    and (
      public.usuario_tem_permissao('tv_avisos')
      or public.remuneracao_has_role(array['admin', 'diretoria', 'marketing'])
    )
  );

-- ============================================================
-- 20260910120200_permissao_tv_avisos_grupo_marketing.sql
-- ============================================================

UPDATE public.permissoes
   SET grupo = 'Marketing'
 WHERE codigo = 'tv_avisos';

-- ============================================================
-- 20260910120300_grupo_permissoes_marketing.sql
-- ============================================================

insert into public.grupos_permissoes (nome, descricao) values
  ('Marketing', 'Grupo inicial — marketing')
on conflict (nome) do nothing;

insert into public.grupos_permissoes_membros (grupo_id, usuario_id)
select g.id, u.id
  from public.grupos_permissoes g
  join public.usuarios u on u.role = 'marketing'
 where g.nome = 'Marketing'
on conflict (grupo_id, usuario_id) do nothing;

-- ============================================================
-- Livro-caixa do CLI
-- ============================================================

insert into supabase_migrations.schema_migrations (version) values
  ('20260831150000'),
  ('20260831150100'),
  ('20260910120000'),
  ('20260910120100'),
  ('20260910120200'),
  ('20260910120300')
on conflict (version) do nothing;

commit;
