-- Avaliação Neuropsicopedagógica (terapia_id 2800) não tem TUSS em
-- tuss_da_sessao(), e a view exigia `codigo_tuss IS NOT NULL` — a sessão nunca
-- chegava à /solicitar. Paciente != ASSIM não precisa de TUSS (fluxo de
-- presença/falta), então a 2800 passa quando o convênio não é ASSIM. Para a
-- ASSIM continua fora: cobrá-la é decisão de negócio + código da operadora.
--
-- CREATE OR REPLACE zera reloptions: o ALTER no fim devolve security_invoker.

CREATE OR REPLACE VIEW public.agenda_tita_autorizacao AS
 SELECT a.id,
    a.tita_agendamento_id,
    a.origem,
    a.data_atendimento,
    a.hora_inicial,
    a.hora_final,
    a.paciente_id,
    a.paciente_nome,
    a.cpf,
    a.data_nascimento,
    a.profissional_id,
    a.profissional_nome,
    a.profissional_cpf,
    a.terapia_id,
    a.terapia_nome,
    a.terapia_exibicao_id,
    a.terapia_exibicao_nome,
    a.sala_id,
    a.sala_nome,
    a.sala_observacoes,
    a.clinica_id,
    a.clinica_nome,
    a.convenio_id,
    a.convenio_nome,
    a.numero_carteirinha,
    a.responsavel_nome,
    a.responsavel_telefone,
    a.responsavel_email,
    a.atividade,
    a.ativo,
    a.raw_json,
    a.created_at,
    a.updated_at,
    "substring"(a.numero_carteirinha, 1, 6) AS empresa,
    "substring"(a.numero_carteirinha, 7, 7) AS matricula,
    "right"(regexp_replace(a.numero_carteirinha, '\D'::text, ''::text, 'g'::text), 2) AS dep,
    ao.crm,
    upper(replace(translate(COALESCE(ao.nome_medico, ''::text), 'ÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇáàãâäéèêëíìîïóòõôöúùûüç.'::text, 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc '::text), '.'::text, ''::text)) AS nome_medico,
    tu.codigo_tuss
   FROM ((agenda_tita a
     LEFT JOIN LATERAL ( SELECT o.crm,
            o.nome_medico
           FROM agenda_orbita o
          WHERE (o.paciente_nome = a.paciente_nome)
         LIMIT 1) ao ON (true))
     CROSS JOIN LATERAL ( SELECT tuss_da_sessao(a.terapia_exibicao_nome, a.terapia_id, a.terapia_nome, a.paciente_id, a.data_atendimento) AS codigo_tuss) tu)
  WHERE ((a.ativo = true)
    AND (a.paciente_nome <> ALL (ARRAY['Horário Administrativo'::text, 'Notificação Prévia'::text]))
    AND ((tu.codigo_tuss IS NOT NULL)
      OR (a.terapia_id = 2800 AND lower(COALESCE(a.convenio_nome, ''::text)) !~~ '%assim%'::text)));

ALTER VIEW public.agenda_tita_autorizacao SET (security_invoker = true);
