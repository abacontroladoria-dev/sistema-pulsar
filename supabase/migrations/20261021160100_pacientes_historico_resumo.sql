-- Evolução mensal do Dashboard de Pacientes (A16) — Indicadores › Dashboard de
-- Pacientes.
--
-- Uma linha por (competência, segmento, unidade), pelo MESMO motor da tela
-- (frontend/lib/cronograma/evolucaoIndicadores.ts → calcularDashboardPacientes
-- com o período do mês inteiro):
--   segmento  multidisciplinar | diagnostico (Processo Diagnóstico)
--   unidade   as da tela (Realengo, Fazendinha, …) + '__total__'
--   pacientes do '__total__' = pacientes ÚNICOS do segmento (quem vai a duas
--             unidades conta uma vez), não a soma das unidades
--   horas     CH somada do mês
--
-- status: parcial (mês em andamento) | fechado (dia 5 do seguinte, ou meses
-- passados — a grade passada é congelada, então o recálculo é fiel).
--
-- Quem escreve: só a rota /api/indicadores/evolucao-snapshot (chave de
-- serviço). Login lê com a permissão da aba (indicadores_pacientes). Sem
-- policy de escrita; anon sem nada.
--
-- Idempotente.

set lock_timeout = '5s';

create table if not exists public.pacientes_historico_resumo (
  competencia    text          not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  segmento       text          not null check (segmento in ('multidisciplinar', 'diagnostico')),
  unidade        text          not null check (length(btrim(unidade)) > 0),
  pacientes      integer       not null default 0 check (pacientes >= 0),
  sessoes        integer       not null default 0 check (sessoes >= 0),
  horas          numeric(12,2) not null default 0 check (horas >= 0),
  status         text          not null check (status in ('parcial', 'fechado')),
  snapshot_data  date          not null,
  atualizado_em  timestamptz   not null default now(),
  primary key (competencia, segmento, unidade)
);

comment on table public.pacientes_historico_resumo is
  'Evolução mensal do Dashboard de Pacientes (pacientes únicos, sessões e CH) por segmento e unidade + __total__. Gravada só pela rota /api/indicadores/evolucao-snapshot. Ver 20261021160100.';

alter table public.pacientes_historico_resumo enable row level security;
alter table public.pacientes_historico_resumo force row level security;

revoke all on table public.pacientes_historico_resumo from public, anon, authenticated;
grant select on table public.pacientes_historico_resumo to authenticated;
grant all on table public.pacientes_historico_resumo to service_role;

drop policy if exists pacientes_historico_resumo_select on public.pacientes_historico_resumo;
create policy pacientes_historico_resumo_select
  on public.pacientes_historico_resumo
  for select to authenticated
  using (public.usuario_tem_permissao('indicadores_pacientes'));
