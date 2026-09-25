-- =============================================================================
-- Reativa agendamento que o sync de agenda_tita inativou como 'excluido' mas que
-- a TiTa NÃO excluiu — a grade (vw_grade_base, pipeline tita_csv) tem a mesma
-- sessão como Realizado e sem `excluido_em_tita`.
--
-- CASO: Eric Gabriel Vitório Nunes (11590), 08/09/2026, Psicomotricidade 16:20
-- (tita_agendamento_id 2776276). Inativado às 16:00 do próprio dia; a sessão
-- aconteceu, a guia 126020 saiu às 16:39, e como a agenda não tinha mais a linha
-- a guia apareceu na Reconciliação como autorização a mais.
--
-- Medido em 25/09 (01–25/09, convênio ASSIM): 1.384 linhas 'excluido'; 2 delas
-- contraditas pela grade, ambas de 08/09 (a outra: Miguel Ferreira Nunes Pinto,
-- 10:40). Parece ter sido uma resposta parcial da API naquele dia, não um padrão.
--
-- Reexecutável: rode o SELECT primeiro. Só reativa quando NÃO há outra linha
-- ativa do mesmo paciente no mesmo horário (aí seria troca legítima).
-- =============================================================================

-- 1) Conferir
SELECT at.id, at.tita_agendamento_id, at.data_atendimento, at.hora_inicial,
       at.paciente_nome, at.terapia_nome, at.updated_at
  FROM public.agenda_tita at
  JOIN public.vw_grade_base g ON g.tita_agendamento_id = at.tita_agendamento_id
 WHERE at.ativo = false
   AND at.motivo_inativacao = 'excluido'
   AND at.convenio_nome ILIKE '%assim%'
   AND at.data_atendimento >= date '2026-09-01'   -- vw_grade_base é pesada; recorte o período
   AND g.data = at.data_atendimento
   AND g.status_execucao = 'Realizado'
   AND g.excluido_em_tita IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.agenda_tita o
      WHERE o.ativo
        AND o.paciente_id = at.paciente_id
        AND o.data_atendimento = at.data_atendimento
        AND o.hora_inicial = at.hora_inicial
   )
 ORDER BY at.data_atendimento, at.hora_inicial;

-- 2) Reativar (esperado em 25/09: 2 linhas, ids 128690 e a do Miguel)
UPDATE public.agenda_tita at
   SET ativo = true,
       motivo_inativacao = NULL
  FROM public.vw_grade_base g
 WHERE g.tita_agendamento_id = at.tita_agendamento_id
   AND at.ativo = false
   AND at.motivo_inativacao = 'excluido'
   AND at.convenio_nome ILIKE '%assim%'
   AND at.data_atendimento >= date '2026-09-01'   -- vw_grade_base é pesada; recorte o período
   AND g.data = at.data_atendimento
   AND g.status_execucao = 'Realizado'
   AND g.excluido_em_tita IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.agenda_tita o
      WHERE o.ativo
        AND o.paciente_id = at.paciente_id
        AND o.data_atendimento = at.data_atendimento
        AND o.hora_inicial = at.hora_inicial
   )
RETURNING at.id, at.paciente_nome, at.data_atendimento, at.hora_inicial, at.terapia_nome;
