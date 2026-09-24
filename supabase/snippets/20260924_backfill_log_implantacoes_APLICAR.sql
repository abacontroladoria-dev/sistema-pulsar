-- Backfill do log de implantações (aumentar_ocupacao_paciente_auditoria) com o
-- que ficou entre o backfill manual de 18/08 e o deploy da gravação pelo servidor.
--
-- PRÉ-REQUISITO: migration 20260924190000_log_implantacoes_ocupacao_paciente.sql
-- aplicada. RODAR DEPOIS do deploy do código (a rota já gravando origem=servidor).
--
-- Fonte: acomp_pac_bundles, o estado atual da tela. É um PISO: o que já tinha
-- sido apagado de lá (sessão removida, bundle cancelado, navegador desatualizado)
-- não volta.
--
-- Uma linha por sessão, a partir de 18/08/2026 12:27:53 (última linha do
-- backfill de 20260818180000). `status` guarda o status atual do bundle
-- (confirmado / removido_tita), como nas linhas antigas.
--   acao = 'implantada'        → bundle com implantadoPor (passou pela TiTa)
--   acao = 'confirmado_manual' → sem implantadoPor (marcado em lote, sem TiTa)
--
-- Idempotente: rodar de novo não duplica. Também não duplica o que a rota já
-- registrou (mesmo paciente + csv_grade_id + dia, origem=servidor).

with sessoes as (
  select
    b.id                                                                         as bundle_id,
    b.pac                                                                        as paciente,
    b.status,
    to_timestamp((b.dados->>'ts')::bigint / 1000) at time zone 'America/Sao_Paulo' as quando,
    nullif(b.dados->>'implantadoPor', '')::uuid                                  as implantado_por,
    b.dados->>'implantadoPorEmail'                                               as implantado_email,
    s->>'tP'                                                                     as terapia,
    s->>'prof'                                                                   as profissional,
    s->>'dia'                                                                    as dia_sessao,
    s->>'hora'                                                                   as hora_sessao,
    nullif(s->>'csvGradeId', '')                                                 as csv_grade_id
  from public.acomp_pac_bundles b
  cross join lateral jsonb_array_elements(coalesce(b.dados->'sessoes', '[]'::jsonb)) s
  where b.status in ('confirmado', 'removido_tita')
    and to_timestamp((b.dados->>'ts')::bigint / 1000) > timestamptz '2026-08-18 12:27:53-03'
)
insert into public.aumentar_ocupacao_paciente_auditoria
  (data, hora, usuario, email, usuario_id, paciente, terapia, profissional,
   dia_sessao, hora_sessao, status, acao, detalhe, tipo, origem, csv_grade_id, bundle_id)
select
  to_char(x.quando, 'DD/MM/YYYY'),
  to_char(x.quando, 'HH24:MI:SS'),
  coalesce(us.nome, pf.nome, x.implantado_email, '(sem autoria)'),
  coalesce(us.email, x.implantado_email),
  au.id,                                   -- FK para auth.users: nulo se o usuário não existe mais
  x.paciente, x.terapia, x.profissional, x.dia_sessao, x.hora_sessao,
  x.status,
  case when x.implantado_por is null then 'confirmado_manual' else 'implantada' end,
  'reconstruído de acomp_pac_bundles em 24/09/2026 (piso: linhas já apagadas não entram)',
  'implantacao', 'backfill_bundles', x.csv_grade_id, x.bundle_id
from sessoes x
left join auth.users      au on au.id = x.implantado_por
left join public.usuarios us on us.id = x.implantado_por
left join public.perfis   pf on pf.id = x.implantado_por
where not exists (
    select 1 from public.aumentar_ocupacao_paciente_auditoria l
    where l.origem = 'backfill_bundles'
      and l.bundle_id = x.bundle_id
      and l.dia_sessao is not distinct from x.dia_sessao
      and l.hora_sessao is not distinct from x.hora_sessao
      and l.terapia is not distinct from x.terapia
  )
  and not exists (
    select 1 from public.aumentar_ocupacao_paciente_auditoria l
    where l.origem = 'servidor'
      and l.paciente = x.paciente
      and l.csv_grade_id = x.csv_grade_id
      and l.data = to_char(x.quando, 'DD/MM/YYYY')
  );

-- Conferência: quantas linhas por origem/ação.
select origem, acao, count(*)
from public.aumentar_ocupacao_paciente_auditoria
where tipo = 'implantacao'
group by 1, 2
order by 1, 2;
