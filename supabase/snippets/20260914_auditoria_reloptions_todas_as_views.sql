-- =============================================================================
-- Auditoria de regressão: security_invoker e anon em TODAS as views do public
-- =============================================================================
-- 2026-09-14. Motivo: os 2 ERRORS do advisor de hoje não eram novos — eram
-- regressão. `vw_central_pacientes` foi flipada para invoker em 2026-08-17 e
-- voltou a DEFINER no DROP VIEW + CREATE VIEW de 20260825010000, porque
-- reloptions morrem no DROP (mesma família de CREATE OR REPLACE perdendo
-- proconfig em função).
--
-- POR QUE AUDITAR O QUE O ADVISOR NÃO ACUSOU: o lint só reclama do que está
-- DEFINER **e** ele consegue enxergar. Ele não sabe quais views DEVERIAM ser
-- invoker — uma view que nunca foi flipada e uma que regrediu são idênticas
-- para ele. Só quem compara com a lista de 2026-08-17 distingue as duas.
--
-- Este snippet SÓ LÊ. Não altera nada.

-- ---------------------------------------------------------------------------
-- BLOCO 1 — as 17 do mutirão de 2026-08-17: alguma regrediu?
-- ---------------------------------------------------------------------------
-- Esperado depois de 20260914120000: `veredito` = OK em todas, menos
-- `occurrences` (que era para ser DROPADA, não flipada — decisão pendente desde
-- agosto) e `vw_reposicao_faltas` (flipada e validada em 17/08: dono 6354 ==
-- diretoria 6354, rp 0).
--
-- Qualquer linha com REGREDIU é uma view que voltou a ignorar a RLS das bases.
with alvo(relname) as (
  values ('vw_reposicao_faltas'), ('vw_match_autorizacoes_assim'),
         ('vw_central_terapeutica'), ('vw_central_autorizacoes'),
         ('vw_auditoria_autorizacoes_assim'), ('vw_faltas_pacientes'),
         ('vw_controle_terapeutico'), ('agenda_tita_autorizacao'),
         ('vw_profissionais_disponiveis'), ('vw_terapeutas_semana'),
         ('vw_blocos_autorizaveis_assim'), ('agenda_tita_autorizacao_v2'),
         ('vw_kpis_auditoria_assim'), ('vw_modal_substituicao_terapeutas'),
         ('vw_central_pacientes'), ('vw_acomp_auditoria'), ('occurrences')
)
select
  a.relname,
  case when c.oid is null then '(NÃO EXISTE MAIS)'
       else coalesce((select option_value from pg_options_to_table(c.reloptions)
                       where option_name = 'security_invoker'), '(DEFINER)')
  end as security_invoker,
  case when c.oid is null then null
       else has_table_privilege('anon', c.oid, 'SELECT') end as anon_pode_ler,
  case
    when c.oid is null then 'sumiu — confirmar se foi drop intencional'
    when has_table_privilege('anon', c.oid, 'SELECT') then '*** ANON LÊ ***'
    when coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'off') = 'true' then 'OK'
    else 'REGREDIU a DEFINER'
  end as veredito
from alvo a
left join pg_class c on c.relname = a.relname
  and c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
order by veredito, a.relname;


-- ---------------------------------------------------------------------------
-- BLOCO 2 — o schema inteiro, para achar o que nasceu depois do mutirão
-- ---------------------------------------------------------------------------
-- vw_paciente_laudos_flat só apareceu no advisor porque nasceu em 2026-08-27,
-- depois da lista acima. Outras views novas podem estar DEFINER sem ninguém ter
-- olhado. Aqui aparecem TODAS — inclusive as que o lint ainda não acusou.
--
-- Nem toda DEFINER é bug: uma view DEFINER cujas bases são todas públicas não
-- expõe nada. O que exige ação é DEFINER **e** anon_pode_ler, nessa ordem.
select
  c.relname,
  coalesce((select option_value from pg_options_to_table(c.reloptions)
             where option_name = 'security_invoker'), '(DEFINER)') as security_invoker,
  has_table_privilege('anon',          c.oid, 'SELECT') as anon_pode_ler,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_pode_ler,
  pg_get_userbyid(c.relowner) as dono
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'v'
order by
  (has_table_privilege('anon', c.oid, 'SELECT')) desc,   -- exposto primeiro
  (coalesce((select option_value from pg_options_to_table(c.reloptions)
              where option_name = 'security_invoker'), 'off') <> 'true') desc,
  c.relname;


-- ---------------------------------------------------------------------------
-- BLOCO 3 — quais migrations ainda podem reintroduzir a regressão
-- ---------------------------------------------------------------------------
-- Não é SQL: é conferência no repo. Toda migration que faça DROP VIEW numa das
-- views acima precisa refazer o `alter view ... set (security_invoker = true)`
-- junto dos GRANTs e do COMMENT, senão a view volta a DEFINER na reaplicação.
--
-- Conhecidas hoje (ambas JÁ registradas no livro-caixa, então `db push` não as
-- reaplica — o risco é aplicação manual):
--   20260825010000_origem_da_guia_nas_leituras.sql   DROP+CREATE vw_central_pacientes
--   20260825130000_autorizacoes_avulsas.sql          idem, e ainda declara GRANT ... TO anon
--
-- Para varrer o repo à procura de outras:
--   rg -i "drop view" supabase/migrations/


-- ---------------------------------------------------------------------------
-- BLOCO 4 — o FORCE que apareceu depois de agosto
-- ---------------------------------------------------------------------------
-- Em 2026-08-17 o mutirão inteiro se apoiou em `relforcerowsecurity` VAZIO no
-- schema: era isso que tornava válido validar uma view comparando "lido como
-- dono" contra "lido como usuário". Hoje cadastros_pacientes_laudos e
-- cadastros_pacientes_laudo_especialidades têm FORCE.
--
-- ONDE HÁ FORCE, AQUELE MÉTODO NÃO VALE: o dono também é filtrado, e a
-- igualdade vira tautologia — o mesmo tipo de falso-positivo que fez o Passo 4
-- do mutirão se dar por aprovado sem ter sido aplicado. Valide contra a tela,
-- ou com um papel que não tenha a permissão.
--
-- Se esta lista for grande, vale investigar o event trigger `rls_auto_enable`
-- (ver Advisors INFO 2026-08-17) como origem.
select
  c.relname,
  c.relrowsecurity      as rls_ligada,
  c.relforcerowsecurity as force_ligado,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
  and c.relforcerowsecurity
order by c.relname;
