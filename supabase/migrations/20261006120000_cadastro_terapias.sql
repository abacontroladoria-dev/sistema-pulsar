-- Cadastro de Terapias (tela /cadastros/terapias).
--
-- Até aqui a cor de cada terapia vivia só em código, em duas cópias que já
-- divergiam (TERAPIA_CORES em frontend/lib/cronograma/constants.ts e outra em
-- OcupacaoProfShell.tsx), e não havia lista de terapias no banco. Esta tabela é
-- o catálogo que o Cadastro de Profissionais usa: as "terapias habilitadas" de
-- cada profissional, as terapias de cada faixa da disponibilidade e a cor do
-- card. Regra do usuário: "foi cadastrada? já pode ser usada".
--
-- Três decisões:
--
-- 1. NOME ÚNICO SEM ACENTO/CAIXA. "Psicopedagogia" e "psicopedagogia " são a
--    mesma terapia; a coluna gerada nome_normalizado carrega a unicidade, e a
--    mesma função casa os nomes que chegam da grade TiTa (csv_grades_profissionais).
--
-- 2. tita_terapia_id OPCIONAL. Casamento estável com a TiTa, que renomeia
--    terapias mas não troca o id (ver TERAPIA_ID em constants.ts). Terapia
--    criada à mão no Pulsar nasce sem ele.
--
-- 3. SEM DELETE. Terapia usada em disponibilidade antiga não pode sumir do
--    histórico; a tela inativa (ativo = false). authenticated não tem grant de
--    DELETE.
--
-- Leitura liberada a todo usuário logado (nome e cor não são dado sensível, e o
-- catálogo vai ser lido por outras telas); escrita só com a permissão
-- cadastros_terapias. Idempotente.

-- ═════════════════════════════════════════════════════════════════════════════
-- Normalização de nome (sem acento, minúsculo, espaços colapsados)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.normalizar_nome_terapia(p text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(regexp_replace(btrim(translate(coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
    'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g'))
$$;

comment on function public.normalizar_nome_terapia(text) is
  'Nome de terapia sem acento, minúsculo e com espaços colapsados. Chave de unicidade de cadastro_terapias e de casamento com terapia_nome da grade TiTa.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Tabela
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists public.cadastro_terapias (
  id               bigint generated always as identity primary key,
  nome             text not null,
  nome_normalizado text generated always as (public.normalizar_nome_terapia(nome)) stored,
  tipo             text not null default 'terapia',
  cor_hex          text not null default '#CBD5E1',
  tita_terapia_id  integer,
  ativo            boolean not null default true,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  atualizado_por   uuid,

  constraint cadastro_terapias_nome_unico unique (nome_normalizado),
  constraint cadastro_terapias_tita_unico unique (tita_terapia_id),
  constraint cadastro_terapias_tipo_check check (tipo in ('terapia', 'procedimento')),
  constraint cadastro_terapias_cor_check check (cor_hex ~ '^#[0-9A-F]{6}$'),
  constraint cadastro_terapias_nome_check check (length(btrim(nome)) between 2 and 120)
);

comment on table public.cadastro_terapias is
  'Catálogo de terapias/procedimentos com a cor (hex) usada no Cadastro de Profissionais. Sem DELETE: inativar com ativo = false.';
comment on column public.cadastro_terapias.tita_terapia_id is
  'Id da terapia na TiTa (estável quando a TiTa renomeia). Null = terapia criada só no Pulsar.';

-- Nome aparado e cor em maiúsculas; quem e quando, sempre pelo servidor.
create or replace function public.sp_cadastro_terapias_antes_gravar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.nome := regexp_replace(btrim(new.nome), '\s+', ' ', 'g');
  new.cor_hex := upper(btrim(new.cor_hex));
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  if tg_op = 'INSERT' then
    new.criado_em := now();
  else
    new.criado_em := old.criado_em;
  end if;
  return new;
end $$;

drop trigger if exists trg_cadastro_terapias_antes_gravar on public.cadastro_terapias;
create trigger trg_cadastro_terapias_antes_gravar
  before insert or update on public.cadastro_terapias
  for each row execute function public.sp_cadastro_terapias_antes_gravar();

-- ═════════════════════════════════════════════════════════════════════════════
-- Carga inicial
-- ═════════════════════════════════════════════════════════════════════════════
-- Cores: tabela oficial terapias-cores.md (47 linhas). Branco (#FFFFFF) vira
-- cinza-claro neutro (#CBD5E1) para não desaparecer no card. Mais duas que a
-- grade TiTa usa e a tabela não tinha: Psiquiatra/Neurologista e Avaliação
-- Neuropsicopedagógica. Ids TiTa: TERAPIA_ID (constants.ts) + coluna
-- "Id Terapia" da grade (ex.: Arteterapia 2314, Aplicador Suporte (MT) 2334).
-- `on conflict do nothing`: reaplicar a migration nunca desfaz edição da tela.
insert into public.cadastro_terapias (nome, tipo, cor_hex, tita_terapia_id) values
  ('Aplicador ABA (AE)',                    'terapia',      '#E89D9D', 2260),
  ('Aplicador ABA (AV)',                    'terapia',      '#CBD5E1', 2264),
  ('Aplicador ABA (EF)',                    'terapia',      '#57E6D6', 2269),
  ('Aplicador ABA (HS)',                    'terapia',      '#CBD5E1', 2283),
  ('Aplicador ABA (PS)',                    'terapia',      '#D4A9F5', 2317),
  ('Aplicador ABA (SF)',                    'terapia',      '#BDB8BF', 2263),
  ('Aplicador ABA Casa',                    'terapia',      '#BDB8BF', 2262),
  ('Aplicador ABA Escola',                  'terapia',      '#A9A2A2', 2261),
  ('Aplicador Suporte',                     'terapia',      '#E9FECE', 2331),
  ('Aplicador Suporte (MT)',                'terapia',      '#CBD5E1', 2334),
  ('Aplicador Suporte (TA)',                'terapia',      '#CBD5E1', 2333),
  ('Aplicador Suporte (TO)',                'terapia',      '#CBD5E1', 2332),
  ('Apoio Operacional',                     'terapia',      '#CBD5E1', 2280),
  ('Arteterapia',                           'terapia',      '#E89D9D', 2314),
  ('Arteterapia (Psicologia ABA)',          'terapia',      '#FFAD98', 2578),
  ('Assistente de Desenvolvimento',         'terapia',      '#CBD5E1', null),
  ('Avaliação Neuropsicológica',            'procedimento', '#CBD5E1', 2268),
  ('Avaliação Neuropsicopedagógica',        'procedimento', '#CBD5E1', 2800),
  ('Circuito Funcional',                    'terapia',      '#CBD5E1', null),
  ('Coordenador de Caso',                   'terapia',      '#A560E5', 2248),
  ('Cozinha Funcional',                     'terapia',      '#CBD5E1', null),
  ('Equoterapia',                           'terapia',      '#946D05', 2267),
  ('Especialista Técnico de Área',          'terapia',      '#CBD5E1', 2281),
  ('Esporte Adaptado',                      'terapia',      '#CBD5E1', null),
  ('Estágio',                               'terapia',      '#CBD5E1', 2277),
  ('Facilitador Técnico',                   'terapia',      '#CBD5E1', 2278),
  ('Fisioterapia',                          'terapia',      '#54E8E3', 2258),
  ('Fisioterapia Aquática',                 'terapia',      '#9DD0FD', 2249),
  ('Fonoaudiologia',                        'terapia',      '#E0B00F', 2250),
  ('Habilidades Sociais (Psicologia ABA)',  'terapia',      '#6B5D5D', 2654),
  ('Musicalização',                         'terapia',      '#CBD5E1', null),
  ('Musicoterapia',                         'terapia',      '#FFAD98', 2251),
  ('Nutrição',                              'terapia',      '#BCF47C', null),
  ('OFERECER CONSULTA NUTRIÇÃO',            'procedimento', '#54A9FA', 2579),
  ('Oficina de Aprendizagem',               'terapia',      '#CBD5E1', null),
  ('Operações Clínicas',                    'terapia',      '#CBD5E1', 2279),
  ('Psicoeducação',                         'terapia',      '#E996F1', null),
  ('Psicologia',                            'terapia',      '#C81ED5', 2259),
  ('Psicologia ABA',                        'terapia',      '#CBD5E1', 2271),
  ('Psicomotricidade',                      'terapia',      '#39A8F9', 2253),
  ('Psicopedagogia',                        'terapia',      '#FFFB73', 2254),
  ('Psiquiatra/Neurologista',               'procedimento', '#CBD5E1', 2695),
  ('Supervisão ABA',                        'terapia',      '#000000', 2353),
  ('Técnico Terapêutico Particular',        'terapia',      '#CBD5E1', 2289),
  ('Terapia Alimentar',                     'terapia',      '#95EF9C', 2274),
  ('Terapia Ocupacional',                   'terapia',      '#0B13CA', 2255),
  ('Triagem',                               'procedimento', '#EE8F00', 2270),
  ('Trilha Socioemocional',                 'terapia',      '#CBD5E1', null),
  ('Visita Guiada',                         'procedimento', '#EC62E5', 2604)
on conflict do nothing;

-- ═════════════════════════════════════════════════════════════════════════════
-- RLS e GRANTs
-- ═════════════════════════════════════════════════════════════════════════════
alter table public.cadastro_terapias enable row level security;

-- Remoção por catálogo: RLS é OR entre policies; uma permissiva esquecida
-- anularia o fechamento em silêncio.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'cadastro_terapias'
  loop
    execute format('drop policy %I on public.cadastro_terapias', pol.policyname);
  end loop;
end $$;

create policy "cadastro_terapias_select" on public.cadastro_terapias
  for select to authenticated
  using (true);

create policy "cadastro_terapias_insert" on public.cadastro_terapias
  for insert to authenticated
  with check (public.usuario_tem_permissao('cadastros_terapias'));

create policy "cadastro_terapias_update" on public.cadastro_terapias
  for update to authenticated
  using (public.usuario_tem_permissao('cadastros_terapias'))
  with check (public.usuario_tem_permissao('cadastros_terapias'));

revoke all on public.cadastro_terapias from public, anon, authenticated;
grant select on public.cadastro_terapias to authenticated;
-- Só as colunas de conteúdo: criado_em/atualizado_* são do gatilho.
grant insert (nome, tipo, cor_hex, tita_terapia_id, ativo) on public.cadastro_terapias to authenticated;
grant update (nome, tipo, cor_hex, tita_terapia_id, ativo) on public.cadastro_terapias to authenticated;
grant select, insert, update on public.cadastro_terapias to service_role;

revoke all on function public.sp_cadastro_terapias_antes_gravar() from public, anon, authenticated;
revoke all on function public.normalizar_nome_terapia(text) from public, anon;
grant execute on function public.normalizar_nome_terapia(text) to authenticated, service_role;
