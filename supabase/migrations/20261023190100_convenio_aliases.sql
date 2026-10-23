-- De-para de nome de convênio (Fase 0 de docs/PLANO_INTEGRACAO_FATURAMENTO.md,
-- 23/10/2026).
--
-- O mesmo convênio chega com grafias diferentes de cada fonte: "Sul América"
-- (AXIUM) × "SULAMERICA" (catálogo, TiTa); "Bradesco Saúde" × "BRADESCO SAÚDE
-- S.A"; e "MEMORIAL SAÚDE LTDA", operadora que encerrou e cuja carteira passou à
-- ASSIM (ver REDIRECIONAMENTO_CONVENIO em scripts/importar-favorecidos-tita.js),
-- ainda no cadastro de pacientes do TiTa. O faturamento precisa de FK para
-- public.convenios, não de texto.
--
--   1. convenio_aliases: nome alternativo → convenio_id. A chave é o nome
--      normalizado por sp_normalizar_convenio (sem acento, caixa e pontuação),
--      então "Sul América" e "SUL AMERICA" são o mesmo alias.
--   2. convenio_id_por_nome(text): catálogo primeiro (nome normalizado igual),
--      depois o alias. null = sem correspondência.
--
-- Diferença só de acento/caixa/pontuação NÃO precisa de alias: a função já
-- casa direto com o catálogo. Alias é para nome que muda de verdade.
--
-- Nada que já existe passa a ler a função nesta migration (a importação de
-- pacientes continua igual); ela é a base do faturamento.
--
-- Idempotente.

set lock_timeout = '5s';

create table if not exists public.convenio_aliases (
  id               bigint generated always as identity primary key,
  alias            text not null,
  alias_normalizado text generated always as (public.sp_normalizar_convenio(alias)) stored,
  convenio_id      bigint not null references public.convenios(id),
  origem           text,
  criado_em        timestamptz not null default now(),

  constraint convenio_aliases_alias_unico unique (alias_normalizado),
  constraint convenio_aliases_alias_check check (public.sp_normalizar_convenio(alias) is not null)
);

create index if not exists convenio_aliases_convenio_idx on public.convenio_aliases (convenio_id);

comment on table public.convenio_aliases is
  'De-para de nome de convênio vindo de outras fontes (AXIUM, grade, TiTa) para public.convenios. Chave: sp_normalizar_convenio(alias).';
comment on column public.convenio_aliases.origem is
  'De onde veio a grafia (axium, tita, grade, operadora_encerrada…). Só informativo.';

alter table public.convenio_aliases enable row level security;

-- Mesmo acesso do catálogo de convênios (20260826110000).
drop policy if exists convenio_aliases_select on public.convenio_aliases;
create policy convenio_aliases_select on public.convenio_aliases
  for select to authenticated
  using (
    (select public.usuario_tem_permissao('cadastros_convenios'))
    or (select public.usuario_tem_permissao('cadastros_pacientes'))
  );

drop policy if exists convenio_aliases_insert on public.convenio_aliases;
create policy convenio_aliases_insert on public.convenio_aliases
  for insert to authenticated
  with check ((select public.usuario_tem_permissao('cadastros_convenios')));

drop policy if exists convenio_aliases_update on public.convenio_aliases;
create policy convenio_aliases_update on public.convenio_aliases
  for update to authenticated
  using ((select public.usuario_tem_permissao('cadastros_convenios')))
  with check ((select public.usuario_tem_permissao('cadastros_convenios')));

drop policy if exists convenio_aliases_delete on public.convenio_aliases;
create policy convenio_aliases_delete on public.convenio_aliases
  for delete to authenticated
  using ((select public.usuario_tem_permissao('cadastros_convenios')));

revoke all on public.convenio_aliases from anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- Função de resolução
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.convenio_id_por_nome(p_nome text)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select c.id
       from public.convenios c
      where c.ativo
        and public.sp_normalizar_convenio(c.nome) = public.sp_normalizar_convenio(p_nome)
      order by c.id
      limit 1),
    (select a.convenio_id
       from public.convenio_aliases a
      where a.alias_normalizado = public.sp_normalizar_convenio(p_nome))
  )
$$;

comment on function public.convenio_id_por_nome(text) is
  'Id do convênio (public.convenios) pelo nome: catálogo por nome normalizado, depois convenio_aliases. null = sem correspondência.';

revoke all on function public.convenio_id_por_nome(text) from public, anon;
grant execute on function public.convenio_id_por_nome(text) to authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- Aliases iniciais: só os que o catálogo não casa sozinho. Alvo pelo nome
-- normalizado do catálogo; alvo ausente = alias não entra (não falha).
-- ═════════════════════════════════════════════════════════════════════════════
insert into public.convenio_aliases (alias, convenio_id, origem)
select v.alias, c.id, v.origem
from (values
  ('MEMORIAL SAÚDE LTDA', 'assim saude',       'operadora_encerrada'),
  ('Memorial Saúde',      'assim saude',       'operadora_encerrada'),
  ('Sul América',         'sulamerica',        'axium'),
  ('Sul América Saúde',   'sulamerica',        'axium'),
  ('Bradesco Saúde',      'bradesco saude s a', 'axium')
) as v(alias, alvo, origem)
join lateral (
  select c.id from public.convenios c
  where c.ativo and public.sp_normalizar_convenio(c.nome) = v.alvo
  order by c.id limit 1
) c on true
on conflict (alias_normalizado) do nothing;
