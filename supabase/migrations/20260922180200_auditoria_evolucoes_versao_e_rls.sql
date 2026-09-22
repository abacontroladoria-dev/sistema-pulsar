-- Duas coisas na mesma migration, ambas sobre auditoria_evolucoes:
--   (1) rastrear sob QUAIS critérios cada auditoria foi feita;
--   (2) fechar a RLS, hoje aberta a qualquer usuário autenticado.
--
-- (1) POR QUE A VERSÃO: a partir dos critérios editáveis, a régua muda ao longo
-- do tempo. Sem registrar a versão, ninguém explica por que duas evoluções
-- iguais tiveram veredito diferente, nem prova sob qual regra se auditou num
-- questionamento de glosa. A FK aponta para linha imutável (a tabela é
-- append-only), então tem a mesma força de um snapshot sem duplicar o texto
-- dos critérios em cada uma das milhares de linhas. ON DELETE RESTRICT impede
-- que a versão usada desapareça. `criterios_versao_numero` é desnormalizado de
-- propósito: exibir "critérios v3" na tela sem join.
--
-- `erro_auditoria` existe porque status_risco é NOT NULL + CHECK: não há valor
-- "deu erro". Quando a IA falha numa evolução JÁ auditada antes, guardamos o
-- motivo aqui e preservamos o veredito anterior, que a tela marca como
-- desatualizado. Evolução nunca auditada que falha não vira linha nenhuma — a
-- rota devolve a falha e a tela avisa.
--
-- (2) POR QUE APERTAR A RLS: as policies atuais são USING (true) para todo
-- `authenticated`. Esta tabela guarda texto_original — a evolução clínica
-- escrita pelo terapeuta, dado de saúde. Hoje qualquer usuário logado no
-- Pulsar, inclusive quem só usa cronograma, lê e altera tudo. O padrão adotado
-- é o mesmo de 20260826140700 (laudos/altas) e 20260818210000 (ocupação).
--
-- O RAMO POR PAPEL NÃO É DECORAÇÃO: usuario_tem_permissao() lê
-- usuarios_permissoes e IGNORA os roleDefaults do frontend. Como
-- 'terapeutico_auditoria_evolucoes' só existe em roleDefaults (não há linhas
-- concedidas individualmente), sem remuneracao_has_role TODOS perderiam a tela.
--
-- ADITIVA PARA QUEM JÁ USA: quem enxerga a tela hoje passa por um dos dois
-- ramos. Perde acesso apenas quem nunca deveria ter tido.

alter table public.auditoria_evolucoes
  add column if not exists criterios_versao_id uuid
    references public.auditoria_criterios_versoes(id) on delete restrict,
  add column if not exists criterios_versao_numero int,
  add column if not exists erro_auditoria text;

comment on column public.auditoria_evolucoes.criterios_versao_id is
  'Versão dos critérios sob a qual esta evolução foi auditada. Null = auditada antes da feature de critérios versionados.';
comment on column public.auditoria_evolucoes.erro_auditoria is
  'Motivo da última falha de auditoria. Quando preenchido, os campos de veredito são da tentativa ANTERIOR (bem-sucedida).';

do $$
declare
  pol record;
  cond constant text :=
    '(public.usuario_tem_permissao(''terapeutico_auditoria_evolucoes'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'',''terapeutico'']))';
begin
  -- Remove o que existir hoje (as duas USING(true)), sem depender dos nomes.
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'auditoria_evolucoes'
  loop
    execute format('drop policy %I on public.auditoria_evolucoes', pol.policyname);
  end loop;

  execute format(
    'create policy auditoria_evolucoes_select on public.auditoria_evolucoes for select to authenticated using (%s)',
    cond);
  execute format(
    'create policy auditoria_evolucoes_insert on public.auditoria_evolucoes for insert to authenticated with check (%s)',
    cond);
  execute format(
    'create policy auditoria_evolucoes_update on public.auditoria_evolucoes for update to authenticated using (%s) with check (%s)',
    cond, cond);
  execute format(
    'create policy auditoria_evolucoes_delete on public.auditoria_evolucoes for delete to authenticated using (%s)',
    cond);
end $$;

alter table public.auditoria_evolucoes enable row level security;
-- force: nem o dono da tabela escapa. service_role tem bypassrls, então o
-- sync e jobs internos seguem funcionando.
alter table public.auditoria_evolucoes force row level security;
