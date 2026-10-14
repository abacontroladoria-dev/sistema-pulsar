-- ═════════════════════════════════════════════════════════════════════════════
-- Auditoria de Documentos PEP — Etapa 1 (nome) junto da Etapa 2 (conteúdo)
-- (15/10/2026)
-- ═════════════════════════════════════════════════════════════════════════════
-- Pedido do usuário: cada documento é avaliado em duas etapas — 1) o NOME do
-- arquivo (padrão SIGLA-NN-MMAAAA / SIGLA-PACIENTE-MMAAAA / TAP-NN-… / REP-…),
-- 2) o CONTEÚDO — e a tela mostra as duas. O nome já é conferido pelo banco
-- desde 02/10 (sp_pep_ler_nome_padrao / sp_pep_aplicar_padrao, motivos de
-- 20261014100000); faltava a lista da tela trazer o motivo e o número.
--
-- Igual à de 20261015100000, com três campos a mais no "item": padrao_motivo,
-- o número lido do nome (seq) e o nome da pasta do paciente. Continua sem CPF.
-- Idempotente; CREATE OR REPLACE mantém os grants.

CREATE OR REPLACE FUNCTION public.sp_pep_auditoria_lista()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.sp_pep_pode_ler_documentos() THEN
    RAISE EXCEPTION 'sem permissao para a auditoria de documentos' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
             (to_jsonb(d) - 'assinatura' - 'revisao_por' - 'analise_reservada_em')
             || jsonb_build_object(
                  'item', jsonb_build_object(
                    'nome', i.nome, 'sigla', i.sigla, 'competencia', i.competencia,
                    'prestador_nome', i.prestador_nome, 'prestador_pasta_id', i.prestador_pasta_id,
                    'paciente_nome', i.paciente_nome, 'paciente_pasta_id', i.paciente_pasta_id,
                    'paciente_pasta_nome', pp.nome,
                    'web_url', i.web_url, 'status', i.status, 'motivo', i.motivo,
                    'padrao', i.padrao, 'padrao_motivo', i.padrao_motivo, 'nome_seq', i.nome_padrao->>'seq'),
                  'prestador', jsonb_build_object('nome_pasta', pa.nome, 'status', pr.status, 'motivo', pr.motivo))
             ORDER BY d.sp_id)
      FROM sp_pep_documentos d
      JOIN sp_pep_itens i ON i.sp_id = d.sp_id
      LEFT JOIN sp_pep_pastas pa ON pa.id = i.prestador_pasta_id
      LEFT JOIN sp_pep_pastas pp ON pp.id = i.paciente_pasta_id
      LEFT JOIN sp_pep_prestadores pr ON pr.pasta_id = i.prestador_pasta_id
     WHERE i.removido_em IS NULL), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_auditoria_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_auditoria_lista() TO authenticated;
