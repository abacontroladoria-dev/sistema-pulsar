-- =============================================================================
-- As observacoes da Luana chegam as paginas de gestao (Central de Pacientes)
-- =============================================================================
-- O que a Luana escreve ao dar falta (`justificativa_falta`, `motivo_falta`) e ao
-- marcar sessao adiantada (`adiantada_justificativa`, com autor e instante) e
-- gravado no banco desde 20260526120000 e 20260916120000 -- e nunca foi lido por
-- ninguem. A propria Central ZERA esses campos ao reverter falta
-- (central-pacientes/page.tsx:336-343) sem jamais os ter mostrado.
--
-- O efeito e o inverso do que a justificativa obrigatoria pretendia: exige-se a
-- explicacao de quem registra e nega-se ela a quem consulta. Quem abre a falta
-- adiante ve o estado sem o porque, e reconstroi a historia por conversa.
--
-- Esta migration e ADITIVA: nenhuma coluna existente muda de nome, tipo, posicao
-- ou valor. As 47 colunas anteriores saem identicas; seis novas entram no fim.
--
-- Corpo derivado de 20260825130000 (a definicao vigente) por insercao cirurgica --
-- nao por transcricao. O que nao e a lista de colunas esta byte a byte igual.
--
-- DUAS ARMADILHAS desta vizinhanca, ambas respeitadas:
--
--   1. `listar_central_pacientes` e `RETURNS SETOF vw_central_pacientes`: a view e
--      o CONTRATO DE TIPO da funcao. A funcao cai antes da view, sempre -- e por
--      isso que todo precedente aqui faz DROP+CREATE e nao CREATE OR REPLACE.
--
--   2. DROP+CREATE de view PERDE `reloptions` CALADO, e `vw_central_pacientes` e
--      `security_invoker = true`. Sem o flip reposto, a view volta a rodar como
--      DEFINER e fica legivel pelo anon (20260914120000:21-23). O ALTER VIEW no
--      fim deste arquivo NAO e redundante: e a correcao de um efeito colateral
--      que nao emite aviso nenhum.
--
-- A Parte 2 do UNION (sessoes autorizadas direto no portal, sem linha na fila)
-- recebe NULL tipado nos seis campos. Nao e lacuna a preencher depois: nao houve
-- registro, logo nao ha observacao.
-- =============================================================================

DROP FUNCTION IF EXISTS public.listar_central_pacientes(date);
DROP VIEW IF EXISTS public.vw_central_pacientes;

-- ============================================================================
-- VIEW (contrato de tipo)
-- ============================================================================
CREATE VIEW public.vw_central_pacientes AS

-- Parte 1: registros que passaram pela fila
(
    SELECT DISTINCT ON (fa.id)
        fa.id,
        fa.agenda_id,
        fa.paciente_id,
        fa.paciente_nome,
        fa.data_atendimento,
        fa.horario,
        ((fa.data_atendimento::text || ' '::text) || fa.horario::text)::timestamp without time zone AS data_horario,
        fa.status,
        fa.status_assim,
        fa.tipo_falta,
        fa.completion_type,
        fa.numero_autorizacao,
        fa.numero_autorizacao_origem,
        fa.machine_id,
        fa.error_message,
        fa.execution_time_ms,
        fa.created_at,
        fa.updated_at,
        fa.assim_updated_at,
        fa.horario_autorizacao,
        fa.terapia_exibicao_id,
        fa.terapia_nome AS classificacao_terapia,
        fa.forma_autorizacao,
        ag.hora_inicial,
        ag.hora_final,
        ag.profissional_nome,
        ag.profissional_id,
        ag.terapia_nome,
        ag.terapia_exibicao_nome,
        ag.sala_nome,
        ag.clinica_nome,
        ag.convenio_nome,
        ag.responsavel_nome,
        ag.responsavel_telefone,
        ag.numero_carteirinha,
        ag.sala_nome AS unidade,
        ag.convenio_nome AS convenio,
        maq.nome AS usuario_nome,
        CASE
            WHEN fa.status = 'erro'::text             THEN 'erro'::text
            WHEN fa.status = 'processando'::text      THEN 'processando'::text
            WHEN fa.tipo_falta = 'terapeuta'::text    THEN 'falta_terapeuta'::text
            WHEN fa.tipo_falta = 'paciente'::text     THEN 'falta_paciente'::text
            -- (1) concluiu no fluxo ASSIM mas sem guia vinculada
            WHEN fa.status = ANY (ARRAY['concluido'::text, 'concluido_sem_guia'::text])
                 AND fa.numero_autorizacao IS NULL
                 AND COALESCE(fa.completion_type, 'automated'::text) = 'automated'::text
                                                      THEN 'concluido_sem_guia'::text
            WHEN fa.status_assim = 'autorizado'::text THEN 'autorizado'::text
            WHEN fa.status = 'concluido'::text        THEN 'autorizado'::text
            WHEN fa.status = 'pendente'::text         THEN 'pendente'::text
            ELSE COALESCE(fa.status, 'pendente'::text)
        END AS status_operacional,
        ctrl.profissional_substituto_nome,
        COALESCE(ctrl.profissional_substituto_nome, ag.profissional_nome) AS profissional_realizou_nome,
        (ctrl.profissional_substituto_id IS NOT NULL) AS is_substituicao,
        ctrl.status AS controle_status,
        ctrl.confirmado_em,
        fa.criado_por,
        ctrl.confirmado_por_nome,
        -- ── As observações. Texto livre escrito por gente, exibido como escrito.
        -- `motivo_falta` é o código/categoria e `justificativa_falta` a prosa; os
        -- dois saem porque nem toda falta tem os dois, e mostrar só um perderia
        -- o outro sem avisar ninguém.
        fa.motivo_falta,
        fa.justificativa_falta,
        fa.data_atendimento_real,
        fa.adiantada_justificativa,
        fa.adiantada_por_nome,
        fa.adiantada_em
    FROM public.fila_autorizacoes fa
    LEFT JOIN public.maquinas maq ON maq.id = fa.machine_id
    LEFT JOIN public.agenda_tita_autorizacao ag ON (
        fa.paciente_id::bigint = ag.paciente_id
        AND fa.data_atendimento = ag.data_atendimento
        AND fa.horario = ag.hora_inicial
        AND lower(TRIM(BOTH FROM COALESCE(fa.terapia_nome, ''::text))) = lower(TRIM(BOTH FROM COALESCE(ag.terapia_nome, ''::text)))
    )
    LEFT JOIN LATERAL (
        SELECT ct.status, ct.profissional_substituto_id, ct.profissional_substituto_nome, ct.confirmado_em, ct.confirmado_por_nome
        FROM public.controle_terapeutico ct
        WHERE ct.tita_agendamento_id = ag.tita_agendamento_id
        ORDER BY ct.updated_at DESC NULLS LAST
        LIMIT 1
    ) ctrl ON true
    WHERE fa.id IS NOT NULL
      AND fa.avulsa = false          -- <<< avulsa não tem sessão: viraria card sem terapia
      AND (fa.status IS NOT NULL OR fa.status_assim IS NOT NULL
           OR fa.numero_autorizacao IS NOT NULL OR fa.tipo_falta IS NOT NULL)
    ORDER BY fa.id, fa.created_at DESC NULLS LAST,
             ag.updated_at DESC NULLS LAST, ag.created_at DESC NULLS LAST
)

UNION ALL

-- Parte 2: autorizados diretamente no ASSIM sem registro em fila_autorizacoes
(
    SELECT
        p2.id,
        p2.agenda_id,
        p2.paciente_id,
        p2.paciente_nome,
        p2.data_atendimento,
        p2.horario,
        p2.data_horario,
        p2.status,
        p2.status_assim,
        p2.tipo_falta,
        p2.completion_type,
        p2.numero_autorizacao,
        p2.numero_autorizacao_origem,
        p2.machine_id,
        p2.error_message,
        p2.execution_time_ms,
        p2.created_at,
        p2.updated_at,
        p2.assim_updated_at,
        p2.horario_autorizacao,
        p2.terapia_exibicao_id,
        p2.classificacao_terapia,
        p2.forma_autorizacao,
        p2.hora_inicial,
        p2.hora_final,
        p2.profissional_nome,
        p2.profissional_id,
        p2.terapia_nome,
        p2.terapia_exibicao_nome,
        p2.sala_nome,
        p2.clinica_nome,
        p2.convenio_nome,
        p2.responsavel_nome,
        p2.responsavel_telefone,
        p2.numero_carteirinha,
        p2.unidade,
        p2.convenio,
        p2.usuario_nome,
        p2.status_operacional,
        p2.profissional_substituto_nome,
        p2.profissional_realizou_nome,
        p2.is_substituicao,
        p2.controle_status,
        p2.confirmado_em,
        p2.criado_por,
        p2.confirmado_por_nome,
        -- Parte 2 são sessões SEM linha em fila_autorizacoes: autorizadas direto
        -- no portal. Não existe observação a mostrar porque não houve registro —
        -- NULL é o valor honesto, não uma lacuna a preencher depois.
        NULL::text        AS motivo_falta,
        NULL::text        AS justificativa_falta,
        NULL::date        AS data_atendimento_real,
        NULL::text        AS adiantada_justificativa,
        NULL::text        AS adiantada_por_nome,
        NULL::timestamptz AS adiantada_em
    FROM (
        WITH
        agenda_com_tuss AS (
            SELECT
                at.id,
                at.tita_agendamento_id,
                at.paciente_id,
                at.paciente_nome,
                at.data_atendimento,
                at.hora_inicial,
                at.hora_final,
                at.profissional_id,
                at.profissional_nome,
                at.terapia_nome,
                at.terapia_exibicao_id,
                at.terapia_exibicao_nome,
                at.sala_nome,
                at.clinica_nome,
                at.convenio_nome,
                at.responsavel_nome,
                at.responsavel_telefone,
                at.numero_carteirinha,
                CASE
                    WHEN at.terapia_exibicao_nome = ANY (ARRAY['Psicologia'::text,'Psicologia ABA'::text,'Arteterapia'::text,'Arteterapia (Psicologia ABA)'::text,'Avaliação Neuropsicológica'::text,'Habilidades Sociais (Psicologia ABA)'::text]) THEN '22070384'::text
                    WHEN at.terapia_exibicao_nome = 'Fonoaudiologia'::text           THEN '22070397'::text
                    WHEN at.terapia_exibicao_nome = 'Psicomotricidade'::text         THEN '22070400'::text
                    WHEN at.terapia_exibicao_nome = 'Fisioterapia'::text             THEN '22070419'::text
                    WHEN at.terapia_exibicao_nome = 'Terapia Ocupacional'::text      THEN '22070427'::text
                    WHEN at.terapia_exibicao_nome = 'Psicopedagogia'::text           THEN '22070435'::text
                    WHEN at.terapia_exibicao_nome = 'Musicoterapia'::text            THEN '22070451'::text
                    WHEN at.terapia_exibicao_nome = ANY (ARRAY['Nutrição'::text,'Terapia Alimentar'::text]) THEN '22070460'::text
                    WHEN at.terapia_exibicao_nome = ANY (ARRAY['Hidroterapia'::text,'Fisioterapia Aquática'::text]) THEN '22070265'::text
                    WHEN at.terapia_exibicao_nome = 'Equoterapia'::text              THEN '22070257'::text
                    ELSE NULL::text
                END AS codigo_tuss
            FROM public.agenda_tita at
            WHERE at.paciente_nome <> ALL (ARRAY['Horário Administrativo'::text,'Notificação Prévia'::text])
        ),
        slots_sem_fila AS (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    PARTITION BY paciente_id, data_atendimento, codigo_tuss
                    ORDER BY hora_inicial ASC
                ) AS ordem
            FROM agenda_com_tuss
            WHERE codigo_tuss IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM public.fila_autorizacoes fa
                  WHERE fa.paciente_id::bigint = agenda_com_tuss.paciente_id
                    AND fa.data_atendimento = agenda_com_tuss.data_atendimento
                    AND fa.horario = agenda_com_tuss.hora_inicial
                    AND fa.avulsa = false   -- <<< avulsa não representa esta sessão
              )
        ),
        guias_sem_fila AS (
            SELECT
                aa.*,
                ROW_NUMBER() OVER (
                    PARTITION BY aa.paciente_id, aa.data_execucao::date, aa.codigo_tuss
                    ORDER BY aa.guia ASC
                ) AS ordem
            FROM public.autorizacoes_assim aa
            WHERE aa.codigo_tuss IS NOT NULL
              -- (2) exclusão escopada por data: o número da guia recicla
              AND NOT EXISTS (
                  SELECT 1 FROM public.fila_autorizacoes fa
                  WHERE fa.numero_autorizacao = aa.guia
                    AND fa.data_atendimento BETWEEN (aa.data_execucao::date - 7)
                                                AND (aa.data_execucao::date + 7)
              )
        )
        SELECT
            (substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),1,8) ||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),9,4) ||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),13,4)||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),17,4)||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),21,12))::uuid AS id,
            NULL::uuid                AS agenda_id,
            s.paciente_id::text       AS paciente_id,
            s.paciente_nome,
            s.data_atendimento,
            s.hora_inicial            AS horario,
            (s.data_atendimento::text||' '::text||s.hora_inicial::text)::timestamp without time zone AS data_horario,
            'concluido'::text         AS status,
            'autorizado'::text        AS status_assim,
            NULL::text                AS tipo_falta,
            'automated'::text         AS completion_type,
            g.guia                    AS numero_autorizacao,
            -- Guia SEM linha na fila: não houve solicitação pelo Pulsar, logo ela só
            -- pode ter sido tirada no portal. O `criado_por` NULL três linhas abaixo
            -- sempre disse isso; agora dá para ler.
            'relatorio'::text         AS numero_autorizacao_origem,
            NULL::text                AS machine_id,
            NULL::text                AS error_message,
            NULL::integer             AS execution_time_ms,
            g.data_autorizacao        AS created_at,
            g.updated_at,
            g.updated_at              AS assim_updated_at,
            g.data_autorizacao        AS horario_autorizacao,
            s.terapia_exibicao_id,
            s.terapia_nome            AS classificacao_terapia,
            'automatico'::text        AS forma_autorizacao,
            s.hora_inicial,
            s.hora_final,
            s.profissional_nome,
            s.profissional_id,
            s.terapia_nome,
            s.terapia_exibicao_nome,
            s.sala_nome,
            s.clinica_nome,
            s.convenio_nome,
            s.responsavel_nome,
            s.responsavel_telefone,
            s.numero_carteirinha,
            s.sala_nome               AS unidade,
            s.convenio_nome           AS convenio,
            NULL::text                AS usuario_nome,
            'autorizado'::text        AS status_operacional,
            ctrl.profissional_substituto_nome,
            COALESCE(ctrl.profissional_substituto_nome, s.profissional_nome) AS profissional_realizou_nome,
            (ctrl.profissional_substituto_id IS NOT NULL) AS is_substituicao,
            ctrl.status               AS controle_status,
            ctrl.confirmado_em,
            NULL::text                AS criado_por,
            ctrl.confirmado_por_nome,
            NULL::text                AS motivo_falta,
            NULL::text                AS justificativa_falta,
            NULL::date                AS data_atendimento_real,
            NULL::text                AS adiantada_justificativa,
            NULL::text                AS adiantada_por_nome,
            NULL::timestamptz         AS adiantada_em
        FROM slots_sem_fila s
        INNER JOIN guias_sem_fila g ON (
            g.paciente_id = s.paciente_id
            AND g.data_execucao::date = s.data_atendimento
            AND g.codigo_tuss = s.codigo_tuss
            AND g.ordem = s.ordem
        )
        LEFT JOIN LATERAL (
            SELECT ct.status, ct.profissional_substituto_id, ct.profissional_substituto_nome, ct.confirmado_em, ct.confirmado_por_nome
            FROM public.controle_terapeutico ct
            WHERE ct.tita_agendamento_id = s.tita_agendamento_id
            ORDER BY ct.updated_at DESC NULLS LAST
            LIMIT 1
        ) ctrl ON true
    ) p2
);

-- ============================================================================
-- RPC parametrizada
-- ============================================================================
CREATE OR REPLACE FUNCTION public.listar_central_pacientes(p_data date)
RETURNS SETOF public.vw_central_pacientes
LANGUAGE sql STABLE SECURITY INVOKER
AS $$

-- Parte 1: registros que passaram pela fila
(
    SELECT DISTINCT ON (fa.id)
        fa.id,
        fa.agenda_id,
        fa.paciente_id,
        fa.paciente_nome,
        fa.data_atendimento,
        fa.horario,
        ((fa.data_atendimento::text || ' '::text) || fa.horario::text)::timestamp without time zone AS data_horario,
        fa.status,
        fa.status_assim,
        fa.tipo_falta,
        fa.completion_type,
        fa.numero_autorizacao,
        fa.numero_autorizacao_origem,
        fa.machine_id,
        fa.error_message,
        fa.execution_time_ms,
        fa.created_at,
        fa.updated_at,
        fa.assim_updated_at,
        fa.horario_autorizacao,
        fa.terapia_exibicao_id,
        fa.terapia_nome AS classificacao_terapia,
        fa.forma_autorizacao,
        ag.hora_inicial,
        ag.hora_final,
        ag.profissional_nome,
        ag.profissional_id,
        ag.terapia_nome,
        ag.terapia_exibicao_nome,
        ag.sala_nome,
        ag.clinica_nome,
        ag.convenio_nome,
        ag.responsavel_nome,
        ag.responsavel_telefone,
        ag.numero_carteirinha,
        ag.sala_nome AS unidade,
        ag.convenio_nome AS convenio,
        maq.nome AS usuario_nome,
        CASE
            WHEN fa.status      = 'erro'        THEN 'erro'
            WHEN fa.status      = 'processando' THEN 'processando'
            WHEN fa.tipo_falta  = 'terapeuta'   THEN 'falta_terapeuta'
            WHEN fa.tipo_falta  = 'paciente'    THEN 'falta_paciente'
            -- (1) concluiu no fluxo ASSIM mas sem guia vinculada
            WHEN fa.status IN ('concluido', 'concluido_sem_guia')
                 AND fa.numero_autorizacao IS NULL
                 AND COALESCE(fa.completion_type, 'automated') = 'automated'
                                                THEN 'concluido_sem_guia'
            WHEN fa.status_assim = 'autorizado' THEN 'autorizado'
            WHEN fa.status      = 'concluido'   THEN 'autorizado'
            WHEN fa.status      = 'pendente'    THEN 'pendente'
            ELSE COALESCE(fa.status, 'pendente')
        END AS status_operacional,
        ctrl.profissional_substituto_nome,
        COALESCE(ctrl.profissional_substituto_nome, ag.profissional_nome) AS profissional_realizou_nome,
        (ctrl.profissional_substituto_id IS NOT NULL) AS is_substituicao,
        ctrl.status AS controle_status,
        ctrl.confirmado_em,
        fa.criado_por,
        ctrl.confirmado_por_nome,
        -- ── As observações. Texto livre escrito por gente, exibido como escrito.
        -- `motivo_falta` é o código/categoria e `justificativa_falta` a prosa; os
        -- dois saem porque nem toda falta tem os dois, e mostrar só um perderia
        -- o outro sem avisar ninguém.
        fa.motivo_falta,
        fa.justificativa_falta,
        fa.data_atendimento_real,
        fa.adiantada_justificativa,
        fa.adiantada_por_nome,
        fa.adiantada_em
    FROM public.fila_autorizacoes fa
    LEFT JOIN public.maquinas maq
        ON maq.id = fa.machine_id
    LEFT JOIN public.agenda_tita_autorizacao ag
        ON  fa.paciente_id::bigint = ag.paciente_id
        AND fa.data_atendimento    = ag.data_atendimento
        AND fa.horario             = ag.hora_inicial
        AND lower(TRIM(BOTH FROM COALESCE(fa.terapia_nome, ''::text))) =
            lower(TRIM(BOTH FROM COALESCE(ag.terapia_nome, ''::text)))
    LEFT JOIN LATERAL (
        SELECT ct.status, ct.profissional_substituto_id, ct.profissional_substituto_nome, ct.confirmado_em, ct.confirmado_por_nome
        FROM public.controle_terapeutico ct
        WHERE ct.tita_agendamento_id = ag.tita_agendamento_id
        ORDER BY ct.updated_at DESC NULLS LAST
        LIMIT 1
    ) ctrl ON true
    WHERE fa.id IS NOT NULL
      AND fa.data_atendimento = p_data
      AND fa.avulsa = false          -- <<< avulsa não tem sessão: viraria card sem terapia
      AND (fa.status IS NOT NULL OR fa.status_assim IS NOT NULL
           OR fa.numero_autorizacao IS NOT NULL OR fa.tipo_falta IS NOT NULL)
    ORDER BY fa.id,
             fa.created_at  DESC NULLS LAST,
             ag.updated_at  DESC NULLS LAST,
             ag.created_at  DESC NULLS LAST
)

UNION ALL

-- Parte 2: autorizados diretamente no ASSIM sem registro em fila_autorizacoes
(
    SELECT
        p2.id, p2.agenda_id, p2.paciente_id, p2.paciente_nome,
        p2.data_atendimento, p2.horario, p2.data_horario,
        p2.status, p2.status_assim, p2.tipo_falta, p2.completion_type,
        p2.numero_autorizacao, p2.numero_autorizacao_origem,
        p2.machine_id, p2.error_message, p2.execution_time_ms,
        p2.created_at, p2.updated_at, p2.assim_updated_at, p2.horario_autorizacao,
        p2.terapia_exibicao_id, p2.classificacao_terapia, p2.forma_autorizacao,
        p2.hora_inicial, p2.hora_final, p2.profissional_nome, p2.profissional_id,
        p2.terapia_nome, p2.terapia_exibicao_nome, p2.sala_nome, p2.clinica_nome,
        p2.convenio_nome, p2.responsavel_nome, p2.responsavel_telefone, p2.numero_carteirinha,
        p2.unidade, p2.convenio, p2.usuario_nome, p2.status_operacional,
        p2.profissional_substituto_nome, p2.profissional_realizou_nome,
        p2.is_substituicao, p2.controle_status, p2.confirmado_em,
        p2.criado_por, p2.confirmado_por_nome,
        NULL::text        AS motivo_falta,
        NULL::text        AS justificativa_falta,
        NULL::date        AS data_atendimento_real,
        NULL::text        AS adiantada_justificativa,
        NULL::text        AS adiantada_por_nome,
        NULL::timestamptz AS adiantada_em
    FROM (
        WITH
        agenda_com_tuss AS (
            SELECT
                at.id,
                at.tita_agendamento_id,
                at.paciente_id,
                at.paciente_nome,
                at.data_atendimento,
                at.hora_inicial,
                at.hora_final,
                at.profissional_id,
                at.profissional_nome,
                at.terapia_nome,
                at.terapia_exibicao_id,
                at.terapia_exibicao_nome,
                at.sala_nome,
                at.clinica_nome,
                at.convenio_nome,
                at.responsavel_nome,
                at.responsavel_telefone,
                at.numero_carteirinha,
                CASE
                    WHEN at.terapia_exibicao_nome = ANY (ARRAY['Psicologia'::text,'Psicologia ABA'::text,'Arteterapia'::text,'Arteterapia (Psicologia ABA)'::text,'Avaliação Neuropsicológica'::text,'Habilidades Sociais (Psicologia ABA)'::text]) THEN '22070384'::text
                    WHEN at.terapia_exibicao_nome = 'Fonoaudiologia'::text           THEN '22070397'::text
                    WHEN at.terapia_exibicao_nome = 'Psicomotricidade'::text         THEN '22070400'::text
                    WHEN at.terapia_exibicao_nome = 'Fisioterapia'::text             THEN '22070419'::text
                    WHEN at.terapia_exibicao_nome = 'Terapia Ocupacional'::text      THEN '22070427'::text
                    WHEN at.terapia_exibicao_nome = 'Psicopedagogia'::text           THEN '22070435'::text
                    WHEN at.terapia_exibicao_nome = 'Musicoterapia'::text            THEN '22070451'::text
                    WHEN at.terapia_exibicao_nome = ANY (ARRAY['Nutrição'::text,'Terapia Alimentar'::text]) THEN '22070460'::text
                    WHEN at.terapia_exibicao_nome = ANY (ARRAY['Hidroterapia'::text,'Fisioterapia Aquática'::text]) THEN '22070265'::text
                    WHEN at.terapia_exibicao_nome = 'Equoterapia'::text              THEN '22070257'::text
                    ELSE NULL::text
                END AS codigo_tuss
            FROM public.agenda_tita at
            WHERE at.data_atendimento = p_data
              AND at.paciente_nome <> ALL (ARRAY['Horário Administrativo'::text,'Notificação Prévia'::text])
        ),
        slots_sem_fila AS (
            SELECT
                *,
                ROW_NUMBER() OVER (
                    PARTITION BY paciente_id, data_atendimento, codigo_tuss
                    ORDER BY hora_inicial ASC
                ) AS ordem
            FROM agenda_com_tuss
            WHERE codigo_tuss IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM public.fila_autorizacoes fa
                  WHERE fa.paciente_id::bigint = agenda_com_tuss.paciente_id
                    AND fa.data_atendimento    = agenda_com_tuss.data_atendimento
                    AND fa.horario             = agenda_com_tuss.hora_inicial
                    AND fa.avulsa              = false   -- <<< avulsa não representa esta sessão
              )
        ),
        guias_sem_fila AS (
            SELECT
                aa.*,
                ROW_NUMBER() OVER (
                    PARTITION BY aa.paciente_id, aa.data_execucao::date, aa.codigo_tuss
                    ORDER BY aa.guia ASC
                ) AS ordem
            FROM public.autorizacoes_assim aa
            WHERE aa.codigo_tuss IS NOT NULL
              AND aa.data_execucao::date = p_data
              -- (2) exclusão escopada por data: o número da guia recicla
              AND NOT EXISTS (
                  SELECT 1 FROM public.fila_autorizacoes fa
                  WHERE fa.numero_autorizacao = aa.guia
                    AND fa.data_atendimento BETWEEN (aa.data_execucao::date - 7)
                                                AND (aa.data_execucao::date + 7)
              )
        )
        SELECT
            (substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),1,8)||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),9,4)||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),13,4)||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),17,4)||'-'||
             substr(md5(s.paciente_id::text||'|'||s.data_atendimento::text||'|'||s.hora_inicial::text),21,12))::uuid  AS id,
            NULL::uuid                AS agenda_id,
            s.paciente_id::text       AS paciente_id,
            s.paciente_nome,
            s.data_atendimento,
            s.hora_inicial            AS horario,
            (s.data_atendimento::text||' '::text||s.hora_inicial::text)::timestamp without time zone AS data_horario,
            'concluido'::text         AS status,
            'autorizado'::text        AS status_assim,
            NULL::text                AS tipo_falta,
            'automated'::text         AS completion_type,
            g.guia                    AS numero_autorizacao,
            -- Ver a nota do gêmeo acima: sem linha na fila, a guia veio do portal.
            'relatorio'::text         AS numero_autorizacao_origem,
            NULL::text                AS machine_id,
            NULL::text                AS error_message,
            NULL::integer             AS execution_time_ms,
            g.data_autorizacao        AS created_at,
            g.updated_at,
            g.updated_at              AS assim_updated_at,
            g.data_autorizacao        AS horario_autorizacao,
            s.terapia_exibicao_id,
            s.terapia_nome            AS classificacao_terapia,
            'automatico'::text        AS forma_autorizacao,
            s.hora_inicial,
            s.hora_final,
            s.profissional_nome,
            s.profissional_id,
            s.terapia_nome,
            s.terapia_exibicao_nome,
            s.sala_nome,
            s.clinica_nome,
            s.convenio_nome,
            s.responsavel_nome,
            s.responsavel_telefone,
            s.numero_carteirinha,
            s.sala_nome               AS unidade,
            s.convenio_nome           AS convenio,
            NULL::text                AS usuario_nome,
            'autorizado'::text        AS status_operacional,
            ctrl.profissional_substituto_nome,
            COALESCE(ctrl.profissional_substituto_nome, s.profissional_nome) AS profissional_realizou_nome,
            (ctrl.profissional_substituto_id IS NOT NULL) AS is_substituicao,
            ctrl.status               AS controle_status,
            ctrl.confirmado_em,
            NULL::text                AS criado_por,
            ctrl.confirmado_por_nome,
            NULL::text                AS motivo_falta,
            NULL::text                AS justificativa_falta,
            NULL::date                AS data_atendimento_real,
            NULL::text                AS adiantada_justificativa,
            NULL::text                AS adiantada_por_nome,
            NULL::timestamptz         AS adiantada_em
        FROM slots_sem_fila s
        INNER JOIN guias_sem_fila g
            ON  g.paciente_id       = s.paciente_id
            AND g.data_execucao::date = s.data_atendimento
            AND g.codigo_tuss       = s.codigo_tuss
            AND g.ordem             = s.ordem
        LEFT JOIN LATERAL (
            SELECT ct.status, ct.profissional_substituto_id, ct.profissional_substituto_nome, ct.confirmado_em, ct.confirmado_por_nome
            FROM public.controle_terapeutico ct
            WHERE ct.tita_agendamento_id = s.tita_agendamento_id
            ORDER BY ct.updated_at DESC NULLS LAST
            LIMIT 1
        ) ctrl ON true
    ) p2
)

$$;

GRANT EXECUTE ON FUNCTION public.listar_central_pacientes(date) TO anon, authenticated, service_role;

-- Reposicao do security_invoker perdido pelo DROP. Ver armadilha 2 no cabecalho.
ALTER VIEW public.vw_central_pacientes SET (security_invoker = true);

comment on view public.vw_central_pacientes is
  'Central de Pacientes. Desde 20260916130000 devolve tambem as observacoes escritas por gente: motivo_falta, justificativa_falta e os quatro campos de sessao adiantada. NULL na Parte 2 do UNION -- sessao sem linha na fila nao tem observacao porque nao houve registro.';
