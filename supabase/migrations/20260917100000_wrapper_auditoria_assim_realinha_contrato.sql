-- =============================================================================
-- get_auditoria_assim: o wrapper volta a bater com a função que ele envolve
-- =============================================================================
-- JÁ APLICADO EM PRODUÇÃO em 2026-09-17 pelo SQL Editor
-- (supabase/snippets/20260917_wrapper_auditoria_APLICAR.sql), com a contagem
-- conferida antes e depois: 39/45 antes, 45/45 depois.
--
-- 20260916130100 acrescentou seis colunas a get_auditoria_assim_periodo
-- (motivo_falta, justificativa_falta, data_atendimento_real,
-- adiantada_justificativa, adiantada_por_nome, adiantada_em) e NÃO redefiniu
-- este wrapper, cujo corpo é `SELECT * FROM get_auditoria_assim_periodo(...)`.
--
-- O wrapper prometia 38 colunas e o SELECT * passou a devolver 44. Postgres
-- rejeita em execução, não na criação:
--
--   42804: structure of query does not match function result type
--
-- Efeito: a Conferência ASSIM do dia parava de carregar por inteiro. O cliente
-- Supabase serializa esse erro como `{}`, então o console mostrava
-- "Erro ao buscar auditoria ASSIM: {}" sem dizer a causa
-- (frontend/services/auditoria-assim.service.ts:20).
--
-- A correção é só realinhar a assinatura. O corpo não muda: continua sendo o
-- repasse de um dia, e é de propósito que ele seja `SELECT *` -- é o que faz o
-- wrapper herdar colunas novas sem reescrever a lista. O que falta, e que esta
-- migration repõe, é a assinatura acompanhar.
--
-- DROP antes do CREATE porque o tipo de retorno muda, e CREATE OR REPLACE não
-- muda tipo de retorno (42P13).
--
-- As seis colunas entram NO FIM e na MESMA ORDEM em que get_auditoria_assim_-
-- periodo as devolve. `SELECT *` casa por posição, não por nome: qualquer outra
-- ordem compilaria e devolveria o dado trocado de coluna, calado.
-- =============================================================================

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

GRANT EXECUTE ON FUNCTION public.get_auditoria_assim(date) TO anon, authenticated;
