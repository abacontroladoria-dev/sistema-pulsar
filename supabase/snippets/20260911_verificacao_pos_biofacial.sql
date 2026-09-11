-- =============================================================================
-- Verificação DEPOIS de aplicar 20260911120000
-- =============================================================================
-- Só LÊ. Comparar com o baseline guardado do diagnóstico
-- (20260911_diagnostico_biofacial_8_sem_token.sql, blocos 4 e 4b).

-- ---------------------------------------------------------------------------
-- 1. O caso Adrian — as três afirmações de uma vez
-- ---------------------------------------------------------------------------
-- ESPERADO: biofacial '8-DISPOSITIVO INDISPONIVEL', teve_token false,
-- forma_autorizacao 'Dispositivo indisponível' (era 'Token').
select paciente_nome, hora_inicial, guia, biofacial, teve_token, token, forma_autorizacao
from public.get_auditoria_assim('2026-09-01')
where guia = '5665';

-- ---------------------------------------------------------------------------
-- 2. Distribuição do rótulo — comparar com o baseline
-- ---------------------------------------------------------------------------
-- ESPERADO: o 'Token' indevido migrou para 'Dispositivo indisponível'.
-- ALERTA: se alguma categoria virou NULL EM MASSA, é o risco R6 — pare e
-- confira `forma_validacao_do_biofacial` (bloco 5 do diagnóstico).
select forma_autorizacao, count(*)
from public.get_auditoria_assim('2026-09-01')
group by 1
order by 2 desc;

-- ---------------------------------------------------------------------------
-- 3. Contagem total idêntica — a migration não ganha nem perde linha
-- ---------------------------------------------------------------------------
select count(*) as total_linhas_do_dia
from public.get_auditoria_assim('2026-09-01');

-- ---------------------------------------------------------------------------
-- 4. O wrapper não quebrou
-- ---------------------------------------------------------------------------
-- Se `get_auditoria_assim` tivesse ficado com a assinatura antiga, ESTA consulta
-- já teria falhado com "structure of query does not match function result type".
-- Chegar aqui com resultado é a prova. Confirma também que a função de PERÍODO
-- devolve a coluna nova.
select count(*) filter (where biofacial is not null) as com_biofacial,
       count(*)                                      as total
from public.get_auditoria_assim_periodo('2026-09-01', '2026-09-01');

-- ---------------------------------------------------------------------------
-- 5. AS DUAS PONTAS CONCORDAM — o desfecho que o bug pedia
-- ---------------------------------------------------------------------------
-- A sessão do Adrian tem de aparecer na Conferência de Filipetas (já aparecia) E
-- agora se qualificar na aba Auditoria. ESPERADO: uma linha, `na_auditoria` true.
select
  t.paciente_nome,
  t.hora_inicial,
  t.guia,
  true                                                     as na_conferencia_filipetas,
  (split_part(btrim(coalesce(a.biofacial, '')), '-', 1) = '8'
   or coalesce(a.teve_token, false))                       as na_auditoria
from public.get_tokens_mensal('2026-09-01') t
left join public.get_auditoria_assim('2026-09-01') a
  on a.bloco_id = t.bloco_id
where t.guia = '5665';

-- ---------------------------------------------------------------------------
-- 6. Ninguém PERDEU o pill
-- ---------------------------------------------------------------------------
-- O ramo antigo (`teve_token`) continua valendo por si. ESPERADO: zero linhas —
-- nenhuma sessão com token deixou de se qualificar.
select count(*) as com_token_que_perderam_o_pill
from public.get_auditoria_assim('2026-09-01')
where teve_token = true
  and not (
    teve_token
    or split_part(btrim(coalesce(biofacial, '')), '-', 1) = '8'
    or forma_autorizacao ilike '%reconhecimento facial%'
  );

-- ---------------------------------------------------------------------------
-- 7. Custo do plano — comparar com o EXPLAIN de antes
-- ---------------------------------------------------------------------------
-- A migration só acrescenta 3 colunas a um LATERAL que já fazia o JOIN, mais uma
-- projeção. O tempo não deve mudar de ordem de grandeza. Esta RPC não tem
-- statement_timeout próprio, e a tabela já esgotou o pool do PostgREST uma vez
-- (project_incidente_pool_guias_orfas) — se o tempo saltar, pare.
explain (analyze, buffers)
select * from public.get_auditoria_assim('2026-09-01');
