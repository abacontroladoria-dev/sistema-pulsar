-- =============================================================================
-- vw_faltas_pacientes passa a respeitar a reversão
-- =============================================================================
-- Achado colateral da auditoria de 20260916120000, e um bug pré-existente: a
-- view conta como falta qualquer linha com status='falta' e tipo_falta='paciente',
-- sem olhar falta_revertida_em. A definição canônica de assiduidade
-- (contar_faltas_do_paciente, 20260908100200:81-110) olha:
--
--     and status = 'falta' and tipo_falta = 'paciente' and falta_revertida_em is null
--
-- As duas divergem hoje para toda falta revertida. Na prática o caminho de
-- reversão (central-pacientes/page.tsx:300 e reverter_falta_em_lote) também muda
-- status para 'cancelado' e zera tipo_falta, então a linha sai da view por
-- consequência — mas por consequência, não por leitura. Uma reversão futura que
-- preservasse o status já contaria a falta duas vezes em lugares diferentes.
--
-- Alinhar custa uma linha e tira a divergência do caminho.
--
-- CREATE OR REPLACE VIEW, nunca DROP: DROP VIEW perde reloptions, e com elas
-- security_invoker, que morre calado e abre a view ao anon
-- (reference_drop_view_perde_reloptions). A lista de colunas é idêntica à de
-- 20260703173820:72-91, na mesma ordem — CREATE OR REPLACE exige isso.
-- =============================================================================

create or replace view "public"."vw_faltas_pacientes" as  SELECT id,
    paciente_id,
    paciente_nome,
    data_atendimento,
    horario,
    data_horario,
    terapia_falta,
    terapia_nome,
    justificativa_falta,
    tipo_falta,
    nome_medico,
    crm,
    machine_id,
    tita_agendamento_id,
    status_assim,
    assim_updated_at,
    created_at,
    updated_at
   FROM public.fila_autorizacoes
  WHERE ((status = 'falta'::text) AND (tipo_falta = 'paciente'::text)
     AND (falta_revertida_em IS NULL));

comment on view public.vw_faltas_pacientes is
  'Faltas de paciente ainda válidas. Alinhada a contar_faltas_do_paciente: falta revertida não conta (20260916120500).';
