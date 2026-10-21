-- Corrige três lançamentos para FALTA, a pedido da coordenação da recepção (21/10).
--
-- APLICADO em produção em 21/10/2026 e conferido: as 3 linhas ficaram em 'falta'
-- (Arthur terapeuta/106 com a guia 41467; Manuela paciente/102). Rodar de novo dá
-- "esperava 1 linha, encontrou 0" — a guarda de status já não as encontra.
--
--   Arthur de Paiva Ribeiro — 02/10/2026 15:40. A guia foi capturada, mas a
--     profissional não atendeu → falta do terapeuta (código 106, pelo trigger).
--   Manuela Vitória Nascimento de Farias — 07/10 e 14/10/2026 10:40. Foram lançadas
--     como presença; a paciente chegou atrasada e não foi atendida → falta do
--     paciente (código 102 pelo trigger, "ausência de justificativa").
--
-- Faz o mesmo que a RPC corrigir_lancamento_falta (20261021130000), escrito à mão
-- porque a RPC exige um usuário logado (auth.uid). Não depende da migration.
--
-- PASSO 1 — rode só o SELECT e confira que aparecem 3 linhas: status 'concluido'
--   ou 'concluido_sem_guia' e tipo_falta vazio.
-- PASSO 2 — rode o bloco DO. Se o número de linhas não for 1 por sessão, ele
--   aborta sem gravar nada.
--
-- DEPOIS:
--   - A guia do Arthur continua emitida na ASSIM (o Pulsar não cancela guia) e
--     aparece sem sessão na Reconciliação da Auditoria ASSIM. Lá ela é vinculada
--     à falta como "falta do terapeuta".
--   - Se alguma sessão da Manuela tinha guia de verdade (≠ 'N/A'), ela também
--     aparece sem sessão e se fecha como "sem sessão".

-- PASSO 1 ---------------------------------------------------------------------
SELECT f.id, f.paciente_nome, f.data_atendimento, f.horario, f.terapia_nome,
       f.status, f.completion_type, f.numero_autorizacao, f.tipo_falta, f.created_at
  FROM public.fila_autorizacoes f
 WHERE f.avulsa = false
   AND (
        (unaccent(f.paciente_nome) ILIKE '%arthur de paiva ribeiro%'
         AND f.data_atendimento = '2026-10-02' AND f.horario = '15:40:00')
     OR (unaccent(f.paciente_nome) ILIKE '%manuela vitoria nascimento de farias%'
         AND f.data_atendimento IN ('2026-10-07', '2026-10-14') AND f.horario = '10:40:00')
   )
 ORDER BY f.paciente_nome, f.data_atendimento, f.created_at DESC;

-- PASSO 2 ---------------------------------------------------------------------
DO $c$
DECLARE
  v_n int;
BEGIN
  -- Arthur: guia mantida (é o que a faz aparecer na Reconciliação).
  UPDATE public.fila_autorizacoes f
     SET status               = 'falta',
         tipo_falta           = 'terapeuta',
         terapia_falta        = COALESCE(f.terapia_falta, f.terapia_nome),
         justificativa_falta  = 'Guia capturada, mas a profissional não atendeu (correção pedida pela coordenação em 21/10)',
         codigo_justificativa = NULL,
         falta_revertida_por_nome = NULL,
         falta_revertida_em       = NULL
   WHERE f.avulsa = false
     AND unaccent(f.paciente_nome) ILIKE '%arthur de paiva ribeiro%'
     AND f.data_atendimento = '2026-10-02' AND f.horario = '15:40:00'
     AND f.status IN ('concluido', 'concluido_sem_guia')
     AND f.tipo_falta IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Arthur 02/10 15:40: esperava 1 linha, encontrou %. Nada foi gravado.', v_n;
  END IF;

  -- Manuela: apaga os campos que diziam "aconteceu". Uma guia real fica.
  UPDATE public.fila_autorizacoes f
     SET status               = 'falta',
         tipo_falta           = 'paciente',
         terapia_falta        = COALESCE(f.terapia_falta, f.terapia_nome),
         justificativa_falta  = 'Paciente chegou atrasada e a profissional não atendeu no horário (correção pedida pela coordenação em 21/10)',
         codigo_justificativa = NULL,
         completion_type      = CASE WHEN upper(btrim(COALESCE(f.numero_autorizacao, 'N/A'))) = 'N/A'
                                     THEN NULL ELSE f.completion_type END,
         completed_at         = CASE WHEN upper(btrim(COALESCE(f.numero_autorizacao, 'N/A'))) = 'N/A'
                                     THEN NULL ELSE f.completed_at END,
         numero_autorizacao   = CASE WHEN upper(btrim(COALESCE(f.numero_autorizacao, 'N/A'))) = 'N/A'
                                     THEN NULL ELSE f.numero_autorizacao END,
         falta_revertida_por_nome = NULL,
         falta_revertida_em       = NULL
   WHERE f.avulsa = false
     AND unaccent(f.paciente_nome) ILIKE '%manuela vitoria nascimento de farias%'
     AND f.data_atendimento IN ('2026-10-07', '2026-10-14') AND f.horario = '10:40:00'
     AND f.status IN ('concluido', 'concluido_sem_guia')
     AND f.tipo_falta IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Manuela 07/10 e 14/10 10:40: esperava 2 linhas, encontrou %. Nada foi gravado.', v_n;
  END IF;

  RAISE NOTICE 'OK: 3 sessões corrigidas para falta.';
END
$c$;
