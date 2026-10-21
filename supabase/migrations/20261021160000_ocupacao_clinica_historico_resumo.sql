-- Evolução mensal da Ocupação Clínica (A15) — Indicadores › Ocupação Clínica.
--
-- Uma linha por (competência, unidade): as contagens de vagas de 40 min do mês
-- inteiro, somadas semana a semana pelo MESMO motor da tela
-- (frontend/lib/cronograma/evolucaoIndicadores.ts → calcularOcupacaoClinica).
-- `unidade = '__rede__'` é a soma das unidades próprias (terceirizadas fora),
-- como o "Total da rede" da tela.
--
-- status:
--   parcial     mês em andamento (rotina diária 05:15)
--   fechado     fechado no dia 5 do mês seguinte
--   aproximado  meses anteriores ao início da rotina, recalculados UMA vez com
--               a agenda da época e o mapa de salas ATUAL (o mapa não guarda
--               histórico) — o gráfico desenha tracejado
--
-- Quem escreve: só a rota /api/indicadores/evolucao-snapshot (chave de serviço,
-- que ignora RLS). Login lê com a permissão da aba (indicadores_ocupacao_unidades,
-- grupos ao vivo — ver usuario_tem_permissao em 20260929140000). Sem policy de
-- escrita; anon sem nada.
--
-- Idempotente.

set lock_timeout = '5s';

create table if not exists public.ocupacao_clinica_historico_resumo (
  competencia     text        not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  unidade         text        not null check (length(btrim(unidade)) > 0),
  terceirizada    boolean     not null default false,
  total           integer     not null default 0 check (total >= 0),
  paciente        integer     not null default 0 check (paciente >= 0),
  aberta          integer     not null default 0 check (aberta >= 0),
  administrativo  integer     not null default 0 check (administrativo >= 0),
  regularizar     integer     not null default 0 check (regularizar >= 0),
  vazia           integer     not null default 0 check (vazia >= 0),
  dias            integer     not null default 0 check (dias >= 0),
  status          text        not null check (status in ('parcial', 'fechado', 'aproximado')),
  snapshot_data   date        not null,
  atualizado_em   timestamptz not null default now(),
  primary key (competencia, unidade)
);

comment on table public.ocupacao_clinica_historico_resumo is
  'Evolução mensal da Ocupação Clínica (vagas de 40 min por situação), por unidade + __rede__. Gravada só pela rota /api/indicadores/evolucao-snapshot. Ver 20261021160000.';

alter table public.ocupacao_clinica_historico_resumo enable row level security;
alter table public.ocupacao_clinica_historico_resumo force row level security;

revoke all on table public.ocupacao_clinica_historico_resumo from public, anon, authenticated;
grant select on table public.ocupacao_clinica_historico_resumo to authenticated;
grant all on table public.ocupacao_clinica_historico_resumo to service_role;

drop policy if exists ocupacao_clinica_historico_resumo_select on public.ocupacao_clinica_historico_resumo;
create policy ocupacao_clinica_historico_resumo_select
  on public.ocupacao_clinica_historico_resumo
  for select to authenticated
  using (public.usuario_tem_permissao('indicadores_ocupacao_unidades'));
