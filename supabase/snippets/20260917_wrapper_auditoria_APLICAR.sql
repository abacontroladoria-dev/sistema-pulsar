-- =============================================================================
-- APLICAR NO SQL EDITOR -- conserta a Conferência ASSIM que não carrega
-- =============================================================================
-- Sintoma: "Erro ao buscar auditoria ASSIM: {}" no console; a tela do dia fica
-- vazia. O `{}` é o cliente Supabase não serializando o erro -- a causa real é
-- 42804, abaixo.
--
-- Causa: 20260916130100 acrescentou 6 colunas a get_auditoria_assim_periodo
-- (44 colunas) e não redefiniu get_auditoria_assim, cujo corpo é
-- `SELECT * FROM get_auditoria_assim_periodo(...)` mas cuja assinatura ainda
-- promete 38. Postgres rejeita em execução, não na criação.
--
-- Esta correção é só a assinatura. Nenhum dado é lido, escrito ou movido, e o
-- corpo da função não muda.
--
-- NÃO conserta o pareamento da sessão adiantada (guia órfã na Reconciliação) --
-- esse é outro defeito, anterior, e vem em migration separada.
-- =============================================================================

-- ── 1. ANTES: confirme o diagnóstico ────────────────────────────────────────
-- Deve devolver 38 (o wrapper) e 44 (a função envolvida). Se já vier 44 e 44,
-- alguém já aplicou -- pode parar por aqui.
select p.proname,
       array_length(string_to_array(pg_get_function_result(p.oid), ','), 1) as colunas
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_auditoria_assim', 'get_auditoria_assim_periodo')
order by p.proname;


-- ── 2. A CORREÇÃO ───────────────────────────────────────────────────────────
-- DROP antes do CREATE porque o tipo de retorno muda (CREATE OR REPLACE não
-- muda tipo de retorno: 42P13).
--
-- As 6 colunas entram NO FIM e na MESMA ORDEM em que get_auditoria_assim_periodo
-- as devolve. `SELECT *` casa por POSIÇÃO, não por nome: qualquer outra ordem
-- compilaria e devolveria o dado trocado de coluna, calado.

drop function if exists public.get_auditoria_assim(date);

CREATE OR REPLACE FUNCTION public.get_auditoria_assim(p_data date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, empresa text, matricula text, dep text, carteirinha text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint, guia text, status_assim text, codigo_erro text, descricao_erro text, data_execucao timestamp with time zone, autorizacao_updated_at timestamp with time zone, diferenca_minutos numeric, situacao text, prioridade integer, dias_atraso integer, possui_autorizacao boolean, possui_solicitacao boolean, observacao text, motivo_glosa text, teve_token boolean, token text, biofacial text, criado_por text, forma_autorizacao text, horario_autorizacao timestamp without time zone, guia_origem text, reclassificacao_situacao_anterior text, reclassificacao_justificativa text, reclassificacao_por text, reclassificacao_em timestamp with time zone, motivo_falta text, justificativa_falta text, data_atendimento_real date, adiantada_justificativa text, adiantada_por_nome text, adiantada_em timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM public.get_auditoria_assim_periodo(p_data, p_data)
$function$
;

comment on function public.get_auditoria_assim(date) is
  'Conferência ASSIM de um dia. Repasse puro de get_auditoria_assim_periodo(p_data, p_data). A assinatura precisa acompanhar a da função envolvida: o corpo é SELECT *, e divergir de uma coluna derruba a tela inteira com 42804 (20260916130100).';

-- O DROP leva os grants junto. Repor é obrigatório, senão a tela troca 42804
-- por 42501 (permissão negada) -- e o console mostraria o mesmo `{}`.
GRANT EXECUTE ON FUNCTION public.get_auditoria_assim(date) TO anon, authenticated;


-- ── 3. DEPOIS: prove que funcionou ──────────────────────────────────────────
-- (a) as duas assinaturas agora batem em 44:
select p.proname,
       array_length(string_to_array(pg_get_function_result(p.oid), ','), 1) as colunas
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_auditoria_assim', 'get_auditoria_assim_periodo')
order by p.proname;

-- (b) a chamada que a tela faz para de estourar. Troque a data por um dia com
--     movimento; o que importa é NÃO levantar 42804.
select count(*) as linhas from public.get_auditoria_assim(current_date);

-- (c) os grants voltaram (esperado: anon e authenticated):
select grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name = 'get_auditoria_assim'
order by grantee;
