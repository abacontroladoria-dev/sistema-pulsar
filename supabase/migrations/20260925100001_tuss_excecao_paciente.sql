-- Exceção de TUSS por paciente.
--
-- Samuel Soares Do Nascimento (11723) e Miguel Rodrigues De Queiroz (11692):
-- Aplicador ABA (AE) (terapia 2260) e Arteterapia (2314) são solicitados à ASSIM
-- com o TUSS de Terapia Ocupacional (22070427), não com o de Psicologia
-- (22070384). Regra de convênio desses dois pacientes, sem prazo.
--
-- Por que no MAPA e não num leitor: o TUSS entra em bloco_id, no pareamento
-- posicional (partição por codigo_tuss) e em fila_autorizacoes.tuss via
-- /solicitar. Se só a /solicitar mudasse, a guia de TO que a ASSIM devolve não
-- casaria com a sessão na auditoria, e a sessão apareceria como não autorizada.
-- Então TODO leitor de agenda_tita passa a chamar a versão por paciente.
--
-- Os leitores vivos (pg_proc/pg_views em 25/09/2026, prosrc ILIKE
-- '%tuss_da_sessao%') eram só quatro: a view agenda_tita_autorizacao,
-- fn_blocos_assim, get_auditoria_assim_periodo e get_tokens_mensal. O resto
-- (conferências, get_auditoria_assim, central) consome fn_blocos_assim ou a
-- view. listar_terapias_tuss() fica na versão de 3 argumentos: lista pares
-- terapia -> TUSS sem paciente.
--
-- As definições abaixo são as de PRODUÇÃO (pg_get_functiondef / pg_get_viewdef),
-- com uma única mudança: a chamada ganha `paciente_id, data_atendimento`.
--
-- vigente_desde = 25/09/2026: até ontem essas sessões foram autorizadas como
-- 22070384 (autorizacoes_assim confirma). Sem a data, o passado seria recalculado
-- como 22070427, mudaria de bloco_id e despareiaria das guias já emitidas.

set lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tabela de exceções
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tuss_excecao_paciente (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  paciente_id    bigint  NOT NULL,
  terapia_id     bigint  NOT NULL,
  codigo_tuss    text    NOT NULL,
  vigente_desde  date    NOT NULL,
  motivo         text,
  ativo          boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paciente_id, terapia_id)
);

COMMENT ON TABLE public.tuss_excecao_paciente IS
  'TUSS que substitui o do mapa tuss_da_sessao() para um paciente+terapia (por terapia_id, a AÇÃO). Lida só pela sobrecarga de 5 argumentos de tuss_da_sessao(). Incluir paciente = INSERT aqui; nada mais muda.';

ALTER TABLE public.tuss_excecao_paciente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tuss_excecao_paciente FROM PUBLIC, anon, authenticated;

INSERT INTO public.tuss_excecao_paciente (paciente_id, terapia_id, codigo_tuss, vigente_desde, motivo) VALUES
  (11723, 2260, '22070427', '2026-09-25', 'Samuel Soares Do Nascimento — Aplicador ABA (AE) autorizado como Terapia Ocupacional'),
  (11723, 2314, '22070427', '2026-09-25', 'Samuel Soares Do Nascimento — Arteterapia autorizada como Terapia Ocupacional'),
  (11692, 2260, '22070427', '2026-09-25', 'Miguel Rodrigues De Queiroz — Aplicador ABA (AE) autorizado como Terapia Ocupacional'),
  (11692, 2314, '22070427', '2026-09-25', 'Miguel Rodrigues De Queiroz — Arteterapia autorizada como Terapia Ocupacional')
ON CONFLICT (paciente_id, terapia_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Sobrecarga por paciente
--
-- SECURITY DEFINER para que nenhum papel precise ler a tabela: os leitores são
-- INVOKER e uma tabela sem grant filtraria calado (a exceção sumiria sem erro
-- para um papel e não para outro). Sem DEFAULT nos argumentos novos, para não
-- tornar ambígua a chamada de 3 argumentos.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tuss_da_sessao(
  p_terapia_exibicao_nome text,
  p_terapia_id            bigint,
  p_terapia_nome          text,
  p_paciente_id           bigint,
  p_data_atendimento      date
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT e.codigo_tuss
       FROM public.tuss_excecao_paciente e
      WHERE e.ativo
        AND e.paciente_id   = p_paciente_id
        AND e.terapia_id    = p_terapia_id
        AND e.vigente_desde <= p_data_atendimento
      LIMIT 1),
    public.tuss_da_sessao(p_terapia_exibicao_nome, p_terapia_id, p_terapia_nome)
  );
$function$;

COMMENT ON FUNCTION public.tuss_da_sessao(text, bigint, text, bigint, date) IS
  'Mapa de TUSS com exceção por paciente (tuss_excecao_paciente). Todo leitor de agenda_tita que tem o paciente usa esta; a de 3 argumentos é o mapa por terapia.';

REVOKE ALL ON FUNCTION public.tuss_da_sessao(text, bigint, text, bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tuss_da_sessao(text, bigint, text, bigint, date) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) View agenda_tita_autorizacao — CREATE OR REPLACE, nunca DROP (dependentes);
--    security_invoker reafirmado explicitamente.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.agenda_tita_autorizacao WITH (security_invoker = true) AS
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
   FROM agenda_tita a
     LEFT JOIN LATERAL ( SELECT o.crm,
            o.nome_medico
           FROM agenda_orbita o
          WHERE o.paciente_nome = a.paciente_nome
         LIMIT 1) ao ON true
     CROSS JOIN LATERAL ( SELECT public.tuss_da_sessao(a.terapia_exibicao_nome, a.terapia_id, a.terapia_nome, a.paciente_id, a.data_atendimento) AS codigo_tuss) tu
  WHERE a.ativo = true AND (a.paciente_nome <> ALL (ARRAY['Horário Administrativo'::text, 'Notificação Prévia'::text])) AND tu.codigo_tuss IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) fn_blocos_assim
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_blocos_assim(p_de date, p_ate date)
 RETURNS TABLE(bloco_id text, paciente_id bigint, paciente_nome text, empresa text, matricula text, dep text, data_atendimento date, data_atendimento_real date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with agenda_tita_tuss as (
    select
      at.paciente_id,
      at.paciente_nome,
      at.data_atendimento,
      at.hora_inicial,
      at.terapia_nome,
      at.terapia_exibicao_nome,
      at.profissional_nome,
      at.convenio_nome,
      substring(at.numero_carteirinha, 1, 6)                         as empresa,
      substring(at.numero_carteirinha, 7, 7)                         as matricula,
      right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2) as dep,
      public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome, at.paciente_id, at.data_atendimento) as codigo_tuss
    from public.agenda_tita at
    where at.data_atendimento between p_de and p_ate
      and at.ativo = true
      and at.convenio_nome ilike '%assim%'
      and at.paciente_nome <> all (array['Horário Administrativo','Notificação Prévia'])
  ),
  agenda_filtrada as (
    select a.* from agenda_tita_tuss a
    where a.codigo_tuss is not null
      and not exists (
        select 1 from public.config_regras_terapias r
        where r.categoria = 'BLACKLIST_AUTORIZACAO'
          and r.ativo = true
          and a.terapia_nome ilike ('%' || r.terapia_nome || '%')
      )
  ),
  agenda_sem_falta as (
    select a.* from agenda_filtrada a
    where not exists (
      select 1 from public.fila_autorizacoes f
      -- O cast está sobre a coluna da AGENDA, não sobre a da fila. Invertido, o
      -- planner perde `paciente_id` como chave de junção, sobra só
      -- `data_atendimento` (7 valores distintos numa semana), e o merge join
      -- rebobina o lado interno 19 vezes — 119.712 linhas para descartar 114.012.
      -- Deste lado, as três igualdades casam com unique_fila_agendamento.
      where f.paciente_id = a.paciente_id::text
        and f.data_atendimento = a.data_atendimento
        and f.horario = a.hora_inicial
        -- Sessão adiantada não é falta: houve atendimento, em outra data. Ela
        -- volta à Conferência para poder receber o vínculo da guia órfã
        -- (20260916120000).
        and f.data_atendimento_real is null
        and (
          -- Linha em 'glosa' não é falta: o motivo por extenso pode conter a
          -- palavra FALTA ("FALTA DE COBERTURA CONTRATUAL") e a sessão sumiria
          -- da tela justamente quando mais precisa ser vista. Guarda idêntica à
          -- da RPC (20260820150000:211-218).
          (f.status is distinct from 'glosa'
           and upper(coalesce(f.status_assim, '')) like '%FALTA%')
          or upper(coalesce(f.tipo_falta, '')) like '%PACIENTE%'
          or upper(coalesce(f.tipo_falta, '')) like '%TERAPEUTA%'
        )
    )
      and a.terapia_nome not ilike '%Aplicador ABA Escola%'
      and a.terapia_nome not ilike '%Aplicador ABA Casa%'
      and a.terapia_nome not ilike '%Aplicador Suporte%'
      and a.terapia_nome not ilike '%Supervisão ABA%'
  )
  select
    concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) as bloco_id,
    asf.paciente_id,
    asf.paciente_nome,
    asf.empresa,
    asf.matricula,
    asf.dep,
    asf.data_atendimento,
    -- A data real da linha daquela sessão. Lateral porque a fila pode ter mais
    -- de uma linha para o mesmo horário quando o TUSS difere; pega a mais
    -- recente, como faz get_candidatas_vinculo (20260821000000:506-515).
    dr.data_atendimento_real,
    asf.hora_inicial,
    asf.codigo_tuss,
    asf.convenio_nome,
    string_agg(distinct asf.terapia_exibicao_nome, ' | ' order by asf.terapia_exibicao_nome) as terapias,
    string_agg(distinct asf.profissional_nome,     ' | ' order by asf.profissional_nome)     as profissionais,
    count(*) as quantidade_sessoes
  from agenda_sem_falta asf
  left join lateral (
    select f.data_atendimento_real
    from public.fila_autorizacoes f
    where f.paciente_id      = asf.paciente_id::text
      and f.data_atendimento = asf.data_atendimento
      and f.horario          = asf.hora_inicial
      and f.data_atendimento_real is not null
    order by coalesce(f.updated_at, f.created_at) desc
    limit 1
  ) dr on true
  group by asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
           asf.data_atendimento, dr.data_atendimento_real, asf.hora_inicial,
           asf.codigo_tuss, asf.convenio_nome
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) get_auditoria_assim_periodo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_auditoria_assim_periodo(p_data_inicio date, p_data_fim date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, empresa text, matricula text, dep text, carteirinha text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint, guia text, status_assim text, codigo_erro text, descricao_erro text, data_execucao timestamp with time zone, autorizacao_updated_at timestamp with time zone, diferenca_minutos numeric, situacao text, prioridade integer, dias_atraso integer, possui_autorizacao boolean, possui_solicitacao boolean, observacao text, motivo_glosa text, teve_token boolean, token text, biofacial text, criado_por text, forma_autorizacao text, horario_autorizacao timestamp without time zone, guia_origem text, reclassificacao_situacao_anterior text, reclassificacao_justificativa text, reclassificacao_por text, reclassificacao_em timestamp with time zone, motivo_falta text, justificativa_falta text, data_atendimento_real date, adiantada_justificativa text, adiantada_por_nome text, adiantada_em timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  WITH avulsas AS (
    SELECT guia, horario_autorizacao FROM public.guias_avulsas(p_data_inicio, p_data_fim)
  ),
  blocos_auditoria AS (
    WITH agenda_tita_tuss AS (
      SELECT
        at.paciente_id,
        at.paciente_nome,
        at.data_atendimento,
        at.hora_inicial,
        at.terapia_nome,
        at.terapia_exibicao_nome,
        at.profissional_nome,
        at.convenio_nome,
        at.numero_carteirinha,
        substring(at.numero_carteirinha, 1, 6)                                   AS empresa,
        substring(at.numero_carteirinha, 7, 7)                                   AS matricula,
        right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)           AS dep,
        public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome, at.paciente_id, at.data_atendimento) AS codigo_tuss
      FROM agenda_tita at
      WHERE at.data_atendimento BETWEEN p_data_inicio AND p_data_fim
        AND at.ativo = true
        AND at.convenio_nome ILIKE '%assim%'
        AND at.paciente_nome <> ALL (ARRAY['Horário Administrativo','Notificação Prévia'])
    ),
    agenda_filtrada AS (
      SELECT a.*
      FROM agenda_tita_tuss a
      WHERE a.codigo_tuss IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM config_regras_terapias r
          WHERE r.categoria = 'BLACKLIST_AUTORIZACAO'
            AND r.ativo = true
            AND a.terapia_nome ILIKE ('%' || r.terapia_nome || '%')
        )
    ),
    agenda_sem_falta AS (
      SELECT a.*
      FROM agenda_filtrada a
      WHERE NOT EXISTS (
        SELECT 1 FROM fila_autorizacoes f
        WHERE f.paciente_id::bigint = a.paciente_id
          AND f.data_atendimento = a.data_atendimento
          AND f.horario = a.hora_inicial
          -- Sessao adiantada nao e falta: houve atendimento, em outra data
          -- (20260916120000). Ela volta a Conferencia com a data efetiva.
          AND f.data_atendimento_real IS NULL
          AND (
            (f.status IS DISTINCT FROM 'glosa'
             AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%UNIDADE%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.autorizacoes_vinculos vs
            WHERE vs.fila_id = f.id AND vs.desfeito_em IS NULL
              AND vs.tipo = 'substituicao'
          )
      )
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Escola%'
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Casa%'
        AND a.terapia_nome NOT ILIKE '%Aplicador Suporte%'
        AND a.terapia_nome NOT ILIKE '%Supervisão ABA%'
    )
    SELECT
      concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) AS bloco_id,
      asf.paciente_id::text,
      asf.paciente_nome,
      asf.empresa,
      asf.matricula,
      asf.dep,
      concat_ws('.', asf.empresa, asf.matricula, asf.dep) AS carteirinha,
      asf.data_atendimento,
      asf.hora_inicial,
      asf.codigo_tuss,
      asf.convenio_nome,
      string_agg(DISTINCT asf.terapia_exibicao_nome, ' | ' ORDER BY asf.terapia_exibicao_nome) AS terapias,
      string_agg(DISTINCT asf.profissional_nome,     ' | ' ORDER BY asf.profissional_nome)     AS profissionais,
      count(*) AS quantidade_sessoes
    FROM agenda_sem_falta asf
    GROUP BY asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
             asf.data_atendimento, asf.hora_inicial, asf.codigo_tuss, asf.convenio_nome
  ),
  fila_operacional AS (
    SELECT DISTINCT ON (f.paciente_id, f.data_atendimento, f.horario, f.tuss)
      f.empresa, f.matricula, f.dep, f.paciente_id, f.data_atendimento, f.horario,
      f.tuss AS codigo_tuss,
      COALESCE(f.updated_at, f.created_at) AS ultimo_updated_at,
      f.criado_por,
      f.forma_autorizacao,
      f.horario_autorizacao,
      f.status,
      f.status_assim,
      f.numero_autorizacao,
      f.numero_autorizacao_origem,
      f.error_message,
      -- As observacoes escritas por gente. A CTE ja le a linha inteira da fila;
      -- carregar mais seis colunas nao custa uma varredura a mais.
      f.motivo_falta,
      f.justificativa_falta,
      f.data_atendimento_real,
      f.adiantada_justificativa,
      f.adiantada_por_nome,
      f.adiantada_em,
      CASE
        WHEN f.status = 'glosa' AND f.status_assim ~ '^\s*\d{3,5}\s*-'
          THEN btrim(split_part(f.status_assim, '-', 1))
      END AS glosa_codigo,
      CASE
        WHEN f.status = 'glosa'
          THEN nullif(btrim(regexp_replace(f.status_assim, '^\s*\d{3,5}\s*-\s*', '')), '')
      END AS glosa_descricao
    FROM fila_autorizacoes f
    WHERE f.data_atendimento BETWEEN p_data_inicio AND p_data_fim
      AND NOT (
        f.data_atendimento_real IS NULL
        AND (
          (f.status IS DISTINCT FROM 'glosa'
           AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
          OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
          OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%UNIDADE%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.autorizacoes_vinculos vs
            WHERE vs.fila_id = f.id AND vs.desfeito_em IS NULL
              AND vs.tipo = 'substituicao'
          )
      )
    ORDER BY f.paciente_id, f.data_atendimento, f.horario, f.tuss,
             COALESCE(f.updated_at, f.created_at) DESC
  ),
  match_temporal AS (
    WITH sessoes AS (
      SELECT
        b1.bloco_id, b1.paciente_id, b1.paciente_nome, b1.empresa, b1.matricula, b1.dep,
        b1.carteirinha, b1.data_atendimento, b1.hora_inicial, b1.codigo_tuss,
        b1.convenio_nome, b1.terapias, b1.profissionais, b1.quantidade_sessoes,
        row_number() OVER (
          PARTITION BY b1.empresa, b1.matricula, b1.dep, b1.data_atendimento, b1.codigo_tuss
          ORDER BY b1.hora_inicial
        ) AS ordem_sessao
      FROM blocos_auditoria b1
    ),
    autorizacoes AS (
      SELECT
        aa.guia, aa.matricula, aa.paciente_nome, aa.data_execucao, aa.data_autorizacao,
        aa.status, aa.codigo_tuss, aa.codigo_erro, aa.descricao_erro,
        aa.teve_token, aa.updated_at, aa.token, aa.status_tratado, aa.matricula_limpa, aa.paciente_id,
        aa.biofacial,
        split_part(aa.matricula, '.', 1)               AS empresa,
        split_part(aa.matricula, '.', 2)               AS matricula_base,
        split_part(aa.matricula, '.', 3)               AS dep,
        row_number() OVER (
          PARTITION BY split_part(aa.matricula,'.',1), split_part(aa.matricula,'.',2),
                       split_part(aa.matricula,'.',3), date(aa.data_execucao), aa.codigo_tuss
          -- A AVULSA por último: ela não corresponde a sessão nenhuma
          -- (20260825130000:54), então não pode disputar posição com quem
          -- corresponde. `false` ordena antes de `true`. Mesma ordem de
          -- get_guias_orfas, obrigatoriamente (20260910130000).
          ORDER BY (av.guia IS NOT NULL), aa.data_execucao
        ) AS ordem_autorizacao
      FROM autorizacoes_assim aa
      -- Marca sem EXCLUIR: tirar a avulsa da partição renumeraria as outras.
      -- Por guia + tempo, porque o número da guia recicla.
      LEFT JOIN avulsas av
        ON  av.guia = aa.guia
        AND av.horario_autorizacao BETWEEN aa.data_execucao - interval '5 minutes'
                                       AND aa.data_execucao + interval '5 minutes'
      WHERE date(aa.data_execucao) BETWEEN p_data_inicio AND p_data_fim
        AND NOT EXISTS (
          SELECT 1 FROM public.autorizacoes_vinculos v
          WHERE v.guia = aa.guia AND v.desfeito_em IS NULL
        )
    )
    SELECT DISTINCT ON (s.bloco_id)
      s.bloco_id,
      a.guia, a.status, a.codigo_erro, a.descricao_erro, a.data_execucao, a.updated_at,
      a.teve_token, a.token, a.biofacial,
      EXTRACT(epoch FROM a.data_execucao::time - s.hora_inicial) / 60 AS diferenca_minutos
    FROM sessoes s
    LEFT JOIN autorizacoes a
      ON  a.empresa        = s.empresa
      AND a.matricula_base  = s.matricula
      AND a.dep            = s.dep
      AND date(a.data_execucao) = s.data_atendimento
      AND a.codigo_tuss    = s.codigo_tuss
      AND a.ordem_autorizacao = s.ordem_sessao
    ORDER BY s.bloco_id, a.updated_at DESC
  )
  SELECT
    b.bloco_id,
    b.paciente_id,
    b.paciente_nome,
    b.empresa,
    b.matricula,
    b.dep,
    b.carteirinha,
    b.data_atendimento,
    b.hora_inicial,
    b.codigo_tuss,
    b.convenio_nome,
    b.terapias,
    b.profissionais,
    b.quantidade_sessoes,
    COALESCE(mt.guia, fo.numero_autorizacao)               AS guia,
    COALESCE(mt.status, fo.status_assim)                   AS status_assim,
    er.codigo                                              AS codigo_erro,
    ed.descricao                                           AS descricao_erro,
    mt.data_execucao AT TIME ZONE 'America/Sao_Paulo'     AS data_execucao,
    mt.updated_at    AT TIME ZONE 'America/Sao_Paulo'     AS autorizacao_updated_at,
    mt.diferenca_minutos,
    CASE
      WHEN ovr.situacao_nova IS NOT NULL               THEN ovr.situacao_nova
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA'  THEN 'GLOSA_RESOLVIDA'
      WHEN vin.guia IS NOT NULL                        THEN 'LIBERADA'
      ELSE sb.base
    END                                                   AS situacao,
    CASE
      WHEN ovr.situacao_nova IN ('FALTA', 'FALTA_TERAPEUTA') THEN 7
      WHEN ovr.situacao_nova = 'CANCELADA'            THEN 5
      WHEN ovr.situacao_nova = 'NAO_SOLICITADA'       THEN 1
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA' THEN 6
      WHEN vin.guia IS NOT NULL                       THEN 6
      WHEN sb.base = 'GLOSA'                          THEN 2
      WHEN sb.base = 'CANCELADA'                      THEN 5
      WHEN sb.base = 'LIBERADA'                       THEN 6
      WHEN sb.base = 'SOLICITACAO_CANCELADA'          THEN 1
      WHEN sb.base = 'SINCRONIZANDO'                  THEN 4
      WHEN sb.base = 'RETORNO_NAO_CONFIRMADO'         THEN 3
      WHEN sb.base = 'NAO_SOLICITADA'                 THEN 1
      ELSE 1
    END                                                   AS prioridade,
    (CURRENT_DATE - b.data_atendimento)::integer          AS dias_atraso,
    ((mt.status = 'Liberado')
      OR (fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL)
      OR vin.guia IS NOT NULL)                            AS possui_autorizacao,
    (fo.paciente_id IS NOT NULL)                          AS possui_solicitacao,
    CASE
      WHEN ovr.situacao_nova IS NOT NULL
        THEN concat(ob.base, ' · Reclassificado de ', ovr.situacao_anterior,
                    ' para ', ovr.situacao_nova, ' por ', ovr.reclassificado_por,
                    ' em ', to_char(ovr.reclassificado_em AT TIME ZONE 'America/Sao_Paulo',
                                    'DD/MM/YYYY HH24:MI'),
                    ' — ', ovr.justificativa)
      WHEN vin.guia IS NOT NULL AND sb.base = 'GLOSA'
        THEN concat(ob.base, ' · Coberta pela guia ', vin.guia,
                    ' de ', to_char(vin.data_execucao, 'DD/MM/YYYY HH24:MI'),
                    ' — vínculo por ', vin.vinculado_por)
      WHEN vin.guia IS NOT NULL
        THEN concat('Autorização confirmada pela ASSIM (guia ', vin.guia,
                    ', vínculo por ', vin.vinculado_por, ')')
      ELSE ob.base
    END                                                   AS observacao,
    agm.motivo_glosa,
    mt.teve_token,
    mt.token,
    -- ── `biofacial`, para a tela poder ver o `8-` ──────────────────────────
    -- Já resolvido pela precedência vínculo → posicional, como `guia` e
    -- `status_assim` também chegam: a regra de precedência mora aqui, não
    -- duplicada em TypeScript. O frontend compara por PREFIXO (o extrato trunca
    -- o rótulo em 25 chars e o vocabulário não é fechado) e nunca pelo texto de
    -- `forma_validacao_do_biofacial`, que devolve 'Token' quando o `8-` veio com
    -- token — casar pelo rótulo perderia 97 dos 106 casos medidos.
    COALESCE(vin.vin_biofacial, mt.biofacial)             AS biofacial,
    fo.criado_por,
    -- ── Ordem do COALESCE: a RESPOSTA da ASSIM antes da INTENÇÃO da recepção ──
    -- Mesma precedência que 20260903010000 estabeleceu e que get_tokens_mensal
    -- roda em produção desde 03/09 (20260910130000:1031-1039). Aqui ela nunca
    -- chegou: a RPC diária ficou com `fo` na frente, e `fo.forma_autorizacao`
    -- nunca é nulo quando a sessão foi solicitada pelo Pulsar — então o ramo do
    -- biofacial jamais era avaliado e a tela mostrava o clique da recepção como
    -- se fosse a resposta da ASSIM.
    --
    -- Caso real: ADRIAN ARAUJO NERY, 01/09/2026 10:00, guia 5665, biofacial
    -- '8-DISPOSITIVO INDISPONIVEL', SEM token, status Liberado. O modal lia
    -- FORMA = 'Token' numa sessão que não teve token nenhum.
    --
    -- `fo` continua como último degrau: quando a ASSIM não respondeu
    -- (RETORNO_NAO_CONFIRMADO, `mt` todo nulo), o registro da recepção é a única
    -- evidência que existe. O degrau do meio só é alcançável porque
    -- `forma_validacao_do_biofacial` devolve NULL — e não uma string — para
    -- biofacial nulo ou código desconhecido (20260821080000:109-111).
    COALESCE(
      public.forma_validacao_do_biofacial(vin.vin_biofacial, vin.vin_teve_token),
      public.forma_validacao_do_biofacial(mt.biofacial,      mt.teve_token),
      fo.forma_autorizacao
    )                                                     AS forma_autorizacao,
    fo.horario_autorizacao,
    CASE
      WHEN fo.numero_autorizacao IS NOT NULL THEN fo.numero_autorizacao_origem
      WHEN mt.guia               IS NOT NULL THEN 'relatorio'
      ELSE NULL
    END                                                   AS guia_origem,
    -- ── Metadados crus da reclassificação, para o modal montar sua própria
    -- seção em vez de depender só da frase concatenada em `observacao`.
    -- NULL em todo bloco sem reclassificação ativa.
    ovr.situacao_anterior                                 AS reclassificacao_situacao_anterior,
    ovr.justificativa                                      AS reclassificacao_justificativa,
    ovr.reclassificado_por                                 AS reclassificacao_por,
    ovr.reclassificado_em                                  AS reclassificacao_em,
    -- ── As observacoes, cruas, ao lado dos metadados da reclassificacao. Saem de
    -- `fo` (a linha da fila), entao sao NULL em bloco sem contraparte na fila --
    -- que e o mesmo caso em que nao houve ninguem para escrever nada.
    fo.motivo_falta,
    fo.justificativa_falta,
    fo.data_atendimento_real,
    fo.adiantada_justificativa,
    fo.adiantada_por_nome,
    fo.adiantada_em
  FROM blocos_auditoria b
  LEFT JOIN match_temporal mt        ON mt.bloco_id = b.bloco_id
  LEFT JOIN fila_operacional fo
    ON  fo.paciente_id      = b.paciente_id
    AND fo.data_atendimento = b.data_atendimento
    AND fo.codigo_tuss      = b.codigo_tuss
    AND fo.horario          = b.hora_inicial
  LEFT JOIN auditoria_glosa_motivos agm ON agm.bloco_id = b.bloco_id
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(
        mt.codigo_erro,
        CASE WHEN mt.status ~ '^\s*\d{3,5}\s*-'
             THEN btrim(split_part(mt.status, '-', 1)) END,
        fo.glosa_codigo
      ) AS codigo,
      CASE WHEN mt.status ~ '^\s*\d{3,5}\s*-'
           THEN nullif(btrim(regexp_replace(
                  regexp_replace(mt.status, '^\s*\d{3,5}\s*-\s*', ''),
                  '\s*\*\s*$', '')), '')
      END AS descricao_relatorio
  ) er ON true
  LEFT JOIN public.glosa_codigos gc ON gc.codigo = er.codigo
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      mt.descricao_erro,
      gc.descricao,
      fo.glosa_descricao,
      er.descricao_relatorio,
      fo.error_message
    ) AS descricao
  ) ed ON true
  LEFT JOIN LATERAL (
    SELECT v.guia, v.guia_original, v.vinculado_por, v.vinculado_em, aa2.data_execucao,
           -- ── As colunas que faltavam para o vínculo poder opinar ───────────
           -- O `vin` de get_tokens_mensal já as projeta (20260910130000:1051).
           -- Sem elas, o ramo do vínculo em `forma_autorizacao` era literalmente
           -- inescrevível — foi assim que ele sumiu entre 20260827000004 e hoje.
           --
           -- Alias `vin_*` porque `teve_token` é nome de COLUNA DE SAÍDA desta
           -- função; get_tokens_mensal não precisa disso porque lá esse nome não
           -- é emitido. `aa2.token` fica de fora: `token` continua saindo cru de
           -- `mt` (ver a dívida no cabeçalho), então projetá-lo aqui seria peso
           -- morto — e mudar isso é o outro assunto, não este.
           aa2.teve_token AS vin_teve_token,
           aa2.biofacial  AS vin_biofacial
    FROM public.autorizacoes_vinculos v
    JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia
    WHERE (v.bloco_id = b.bloco_id OR v.fila_id IN (SELECT f2.id FROM public.fila_autorizacoes f2 /*vs_fila*/ WHERE f2.paciente_id::bigint = b.paciente_id::bigint AND f2.data_atendimento = b.data_atendimento AND f2.horario = b.hora_inicial AND f2.tuss = b.codigo_tuss))
      AND v.desfeito_em IS NULL
      -- OS DOIS TIPOS QUE AFIRMAM COBERTURA (2026-09-22).
      --
      -- Era `= 'vinculo'` sozinho, e era o Defeito 1 do cabecalho: a sessao com
      -- substituto voltava FALTA_TERAPEUTA e o KPI contava falta de um horario
      -- atendido. `falta_terapeuta` fica de fora e e o par disto -- ali ninguem
      -- assumiu, nao ha cobertura a afirmar. Espelha `TIPOS_QUE_COBREM` em
      -- frontend/components/auditoria-assim/reconciliacao/cobertura.ts.
      AND v.tipo IN ('vinculo', 'substituicao')
    LIMIT 1
  ) vin ON true
  LEFT JOIN LATERAL (
    SELECT o.situacao_anterior, o.situacao_nova, o.justificativa,
           o.reclassificado_por, o.reclassificado_em
    FROM public.auditoria_situacao_overrides o
    WHERE o.bloco_id = b.bloco_id
      AND o.desfeito_em IS NULL
    LIMIT 1
  ) ovr ON true
  LEFT JOIN LATERAL (
    SELECT
    CASE
          WHEN mt.codigo_erro IS NOT NULL
            OR (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado','Liberado *']))
                                                              THEN 'GLOSA'
          WHEN mt.status = 'Liberado *'                      THEN 'CANCELADA'
          WHEN mt.status = 'Liberado'                        THEN 'LIBERADA'
          WHEN fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL
                                                              THEN 'LIBERADA'
          WHEN fo.status = 'glosa'                            THEN 'GLOSA'
          WHEN fo.status IN ('erro', 'cancelado')             THEN 'SOLICITACAO_CANCELADA'
          WHEN fo.paciente_id IS NOT NULL
            AND fo.ultimo_updated_at IS NOT NULL
            AND (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) <= INTERVAL '10 minutes'
                                                              THEN 'SINCRONIZANDO'
          WHEN fo.paciente_id IS NOT NULL
            AND (fo.ultimo_updated_at IS NULL
                 OR (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) > INTERVAL '10 minutes')
                                                              THEN 'RETORNO_NAO_CONFIRMADO'
          ELSE                                                     'NAO_SOLICITADA'
    END AS base
  ) sb ON true
  LEFT JOIN LATERAL (
    SELECT
    CASE
          WHEN mt.codigo_erro IS NOT NULL
            OR (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado','Liberado *']))
            THEN concat('Glosa: ',
                   COALESCE(er.codigo, mt.status, 'Erro não identificado'),
                   CASE WHEN ed.descricao IS NOT NULL THEN concat(' - ', ed.descricao) ELSE '' END)
          WHEN mt.status = 'Liberado' AND mt.teve_token = true
            THEN concat('TOKEN - ', mt.token)
          WHEN mt.status = 'Liberado'    THEN 'Autorização confirmada pela ASSIM'
          WHEN mt.status = 'Liberado *'  THEN 'Autorização cancelada'
          WHEN fo.status = 'concluido' AND fo.numero_autorizacao IS NOT NULL
            THEN 'Autorização confirmada pela ASSIM'
          WHEN fo.status = 'glosa'
            THEN concat('Glosa: ',
                   COALESCE(
                     nullif(concat_ws(' - ', er.codigo, ed.descricao), ''),
                     fo.error_message,
                     'Erro não identificado'))
          WHEN fo.status = 'erro'
            THEN COALESCE(fo.error_message, 'A solicitação não chegou ao fim na ASSIM.')
          WHEN fo.status = 'cancelado'
            THEN COALESCE(fo.error_message, 'Solicitação cancelada antes da conclusão.')
          WHEN fo.paciente_id IS NOT NULL
            AND fo.ultimo_updated_at IS NOT NULL
            AND (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) <= INTERVAL '10 minutes'
            THEN 'Solicitação enviada.'
          WHEN fo.paciente_id IS NOT NULL
            AND (fo.ultimo_updated_at IS NULL
                 OR (now() - (fo.ultimo_updated_at AT TIME ZONE 'UTC')) > INTERVAL '10 minutes')
            THEN 'Solicitação enviada, mas o retorno da ASSIM ainda não foi confirmado.'
          ELSE 'Nenhuma solicitação encontrada'
    END AS base
  ) ob ON true
  WHERE COALESCE(b.terapias, '') NOT ILIKE '%Equoterapia%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Fisioterapia Aquática%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Avaliação Neuropsicológica%'
  ORDER BY prioridade, hora_inicial
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) get_tokens_mensal (5 chamadas)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tokens_mensal(p_mes date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, terapias text, profissionais text, guia text, token text, data_execucao timestamp with time zone, criado_por text, forma_autorizacao text)
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '30s'
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH avulsas AS (
    SELECT guia, horario_autorizacao
    FROM public.guias_avulsas(
      date_trunc('month', p_mes)::date,
      (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date
    )
  ),
  auth_mes AS (
    SELECT
      aa.guia, aa.matricula, aa.data_execucao, aa.status, aa.codigo_tuss,
      aa.codigo_erro, aa.descricao_erro, aa.teve_token, aa.token, aa.updated_at,
      -- Projetado a partir de 20260903000000: as Sementes 1-3 nunca precisaram
      -- do biofacial de uma guia sem vínculo; a Semente 4 precisa.
      aa.biofacial,
      split_part(aa.matricula, '.', 1) AS empresa,
      split_part(aa.matricula, '.', 2) AS matricula_base,
      split_part(aa.matricula, '.', 3) AS dep,
      date(aa.data_execucao)           AS dia
    FROM autorizacoes_assim aa
    WHERE date(aa.data_execucao) >= date_trunc('month', p_mes)::date
      AND date(aa.data_execucao) <  (date_trunc('month', p_mes) + interval '1 month')::date
  ),
  -- Semente 1: partições que tiveram filipeta.
  chaves_token AS (
    SELECT DISTINCT empresa, matricula_base, dep, dia, codigo_tuss
    FROM auth_mes
    WHERE teve_token = true
  ),
  -- Semente 2: sessões validadas com erro de reconhecimento facial. A forma
  -- vive na fila (é onde a recepção grava), e a fila não tem carteirinha —
  -- então a chave de partição vem da agenda, pela mesma derivação usada no
  -- resto da função. ILIKE por tolerância a acento/caixa da opção gravada.
  fila_facial AS (
    SELECT DISTINCT f.paciente_id, f.data_atendimento, f.tuss
    FROM fila_autorizacoes f
    WHERE f.data_atendimento >= date_trunc('month', p_mes)::date
      AND f.data_atendimento <  (date_trunc('month', p_mes) + interval '1 month')::date
      AND f.forma_autorizacao ILIKE '%reconhecimento facial%'
  ),
  chaves_facial AS (
    SELECT DISTINCT
      substring(at.numero_carteirinha, 1, 6)                         AS empresa,
      substring(at.numero_carteirinha, 7, 7)                         AS matricula_base,
      right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)  AS dep,
      at.data_atendimento                                            AS dia,
      public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome, at.paciente_id, at.data_atendimento) AS codigo_tuss
    FROM agenda_tita at
    JOIN fila_facial ff
      ON  ff.paciente_id::bigint = at.paciente_id
      AND ff.data_atendimento    = at.data_atendimento
    WHERE at.ativo = true
      AND at.convenio_nome ILIKE '%assim%'
      AND public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome, at.paciente_id, at.data_atendimento)
            IS NOT DISTINCT FROM ff.tuss
  ),
  -- Semente 3: blocos cobertos por vínculo cuja guia VINCULADA teve filipeta ou
  -- erro facial. A fila (Semente 2) só enxerga a forma que a RECEPÇÃO gravou
  -- para a guia GLOSADA — nunca sabe que aquela glosa foi resolvida por outra
  -- guia. A chave de partição vem de agenda_tita, pela mesma derivação das
  -- outras sementes.
  vinculos_mes AS (
    SELECT
      v.bloco_id, v.guia,
      aa.teve_token, aa.biofacial
    FROM public.autorizacoes_vinculos v
    JOIN public.autorizacoes_assim aa ON aa.guia = v.guia
    WHERE v.desfeito_em IS NULL
      AND v.tipo = 'vinculo'
      AND date(aa.data_execucao) >= date_trunc('month', p_mes)::date
      AND date(aa.data_execucao) <  (date_trunc('month', p_mes) + interval '1 month')::date
      AND (
        aa.teve_token = true
        OR public.forma_validacao_do_biofacial(aa.biofacial, aa.teve_token)
             ILIKE '%reconhecimento facial%'
        -- Prefixo `8-`, com ou sem token (20260903000000).
        OR split_part(btrim(COALESCE(aa.biofacial, '')), '-', 1) = '8'
      )
  ),
  chaves_vinculo AS (
    SELECT DISTINCT
      substring(at.numero_carteirinha, 1, 6)                         AS empresa,
      substring(at.numero_carteirinha, 7, 7)                         AS matricula_base,
      right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)  AS dep,
      at.data_atendimento                                            AS dia,
      public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome, at.paciente_id, at.data_atendimento) AS codigo_tuss
    FROM agenda_tita at
    JOIN vinculos_mes vm
      ON  vm.bloco_id = concat_ws('_', at.paciente_id, at.data_atendimento,
            public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome, at.paciente_id, at.data_atendimento),
            at.hora_inicial)
    WHERE at.ativo = true
      AND at.convenio_nome ILIKE '%assim%'
  ),
  -- Semente 4: partições cujo biofacial diz `8-DISPOSITIVO INDISPONIVEL`,
  -- COM OU SEM TOKEN. Sem dispositivo a ASSIM cai no #checkBday e emite a
  -- filipeta (20260821080000:101-105): o papel é consequência do `8-`, e o
  -- token é consequência do papel. Quando o token existe a Semente 1 já pegava;
  -- quando não existe (9 de 106 casos medidos em 21/08/2026) a partição não
  -- entrava por porta nenhuma, e a sessão sumia calada.
  --
  -- Casa pelo PREFIXO: o rótulo vem truncado em 25 chars e o vocabulário não é
  -- fechado (reference_biofacial_no_extrato_assim).
  chaves_dispositivo AS (
    SELECT DISTINCT empresa, matricula_base, dep, dia, codigo_tuss
    FROM auth_mes
    WHERE split_part(btrim(COALESCE(biofacial, '')), '-', 1) = '8'
  ),
  chaves AS (
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_token
    UNION
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_facial
    WHERE codigo_tuss IS NOT NULL
    UNION
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_vinculo
    WHERE codigo_tuss IS NOT NULL
    UNION
    SELECT empresa, matricula_base, dep, dia, codigo_tuss FROM chaves_dispositivo
    WHERE codigo_tuss IS NOT NULL
  ),
  dias_alvo AS (
    SELECT DISTINCT dia FROM chaves
  ),
  autorizacoes AS (
    SELECT
      a.guia, a.status, a.codigo_erro, a.descricao_erro, a.data_execucao,
      a.updated_at, a.teve_token, a.token, a.codigo_tuss,
      -- Carregado a partir de 20260903000000 para o WHERE final poder ler o
      -- biofacial da guia pareada por POSIÇÃO (e não só o da vinculada).
      a.biofacial,
      a.empresa, a.matricula_base, a.dep,
      row_number() OVER (
        PARTITION BY a.empresa, a.matricula_base, a.dep, a.dia, a.codigo_tuss
        -- A AVULSA por último: ela não corresponde a sessão nenhuma
        -- (20260825130000:54). Com ela na posição errada, a filipeta era
        -- atribuída à sessão errada, porque `mt.*` (a guia pareada por
        -- POSIÇÃO) é o fallback do COALESCE que decide papel e forma.
        -- Mesma regra de get_guias_orfas (20260910130000).
        ORDER BY (av.guia IS NOT NULL), a.data_execucao
      ) AS ordem_autorizacao
    FROM auth_mes a
    -- Marca sem EXCLUIR: tirar a avulsa da partição renumeraria as outras.
    LEFT JOIN avulsas av
      ON  av.guia = a.guia
      AND av.horario_autorizacao BETWEEN a.data_execucao - interval '5 minutes'
                                     AND a.data_execucao + interval '5 minutes'
    JOIN chaves k
      ON  k.empresa        = a.empresa
      AND k.matricula_base = a.matricula_base
      AND k.dep            = a.dep
      AND k.dia            = a.dia
      AND k.codigo_tuss    IS NOT DISTINCT FROM a.codigo_tuss
  ),
  blocos_auditoria AS (
    WITH agenda_tita_tuss AS (
      SELECT
        at.paciente_id,
        at.paciente_nome,
        at.data_atendimento,
        at.hora_inicial,
        at.terapia_nome,
        at.terapia_exibicao_nome,
        at.profissional_nome,
        at.convenio_nome,
        at.numero_carteirinha,
        substring(at.numero_carteirinha, 1, 6)                                   AS empresa,
        substring(at.numero_carteirinha, 7, 7)                                   AS matricula,
        right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)           AS dep,
        public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome, at.paciente_id, at.data_atendimento) AS codigo_tuss
      FROM agenda_tita at
      WHERE at.data_atendimento IN (SELECT dia FROM dias_alvo)
        AND at.ativo = true
        AND at.convenio_nome ILIKE '%assim%'
        AND at.paciente_nome <> ALL (ARRAY['Horário Administrativo','Notificação Prévia'])
        -- Semi-join contra o conjunto de carteirinhas alvo: derruba a maior
        -- parte das linhas ANTES dos NOT EXISTS caros abaixo.
        AND EXISTS (
          SELECT 1 FROM chaves k
          WHERE k.empresa        = substring(at.numero_carteirinha, 1, 6)
            AND k.matricula_base = substring(at.numero_carteirinha, 7, 7)
            AND k.dep            = right(regexp_replace(at.numero_carteirinha, '\D', '', 'g'), 2)
        )
    ),
    agenda_filtrada AS (
      SELECT a.*
      FROM agenda_tita_tuss a
      WHERE a.codigo_tuss IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM config_regras_terapias r
          WHERE r.categoria = 'BLACKLIST_AUTORIZACAO'
            AND r.ativo = true
            AND a.terapia_nome ILIKE ('%' || r.terapia_nome || '%')
        )
    ),
    agenda_sem_falta AS (
      SELECT a.*
      FROM agenda_filtrada a
      WHERE NOT EXISTS (
        SELECT 1 FROM fila_autorizacoes f
        WHERE f.paciente_id::bigint = a.paciente_id
          AND f.data_atendimento = a.data_atendimento
          AND f.horario = a.hora_inicial
          AND (
            upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
            OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
          )
      )
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Escola%'
        AND a.terapia_nome NOT ILIKE '%Aplicador ABA Casa%'
        AND a.terapia_nome NOT ILIKE '%Aplicador Suporte%'
        AND a.terapia_nome NOT ILIKE '%Supervisão ABA%'
    )
    SELECT
      concat_ws('_', asf.paciente_id, asf.data_atendimento, asf.codigo_tuss, asf.hora_inicial) AS bloco_id,
      asf.paciente_id::text,
      asf.paciente_nome,
      asf.empresa,
      asf.matricula,
      asf.dep,
      asf.data_atendimento,
      asf.hora_inicial,
      asf.codigo_tuss,
      string_agg(DISTINCT asf.terapia_exibicao_nome, ' | ' ORDER BY asf.terapia_exibicao_nome) AS terapias,
      string_agg(DISTINCT asf.profissional_nome,     ' | ' ORDER BY asf.profissional_nome)     AS profissionais
    FROM agenda_sem_falta asf
    -- convenio_nome entra no GROUP BY só para manter paridade exata com
    -- get_auditoria_assim_periodo: sem ele, dois convênios "assim" grafados
    -- diferente fundiriam num bloco só e mudariam a numeração do pareamento.
    GROUP BY asf.paciente_id, asf.paciente_nome, asf.empresa, asf.matricula, asf.dep,
             asf.data_atendimento, asf.hora_inicial, asf.codigo_tuss, asf.convenio_nome
  ),
  fila_operacional AS (
    SELECT DISTINCT ON (f.paciente_id, f.data_atendimento, f.horario, f.tuss)
      f.paciente_id, f.data_atendimento, f.horario,
      f.tuss AS codigo_tuss,
      f.criado_por,
      f.forma_autorizacao
    FROM fila_autorizacoes f
    WHERE f.data_atendimento IN (SELECT dia FROM dias_alvo)
      AND NOT (
        upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%'
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
      )
    ORDER BY f.paciente_id, f.data_atendimento, f.horario, f.tuss,
             COALESCE(f.updated_at, f.created_at) DESC
  ),
  match_temporal AS (
    WITH sessoes AS (
      SELECT
        b1.*,
        row_number() OVER (
          PARTITION BY b1.empresa, b1.matricula, b1.dep, b1.data_atendimento, b1.codigo_tuss
          ORDER BY b1.hora_inicial
        ) AS ordem_sessao
      FROM blocos_auditoria b1
    )
    SELECT DISTINCT ON (s.bloco_id)
      s.bloco_id,
      -- `a.biofacial` carregado a partir de 20260903000000.
      a.guia, a.status, a.teve_token, a.token, a.data_execucao, a.biofacial
    FROM sessoes s
    LEFT JOIN autorizacoes a
      ON  a.empresa        = s.empresa
      AND a.matricula_base = s.matricula
      AND a.dep            = s.dep
      AND date(a.data_execucao) = s.data_atendimento
      AND a.codigo_tuss    = s.codigo_tuss
      AND a.ordem_autorizacao = s.ordem_sessao
    ORDER BY s.bloco_id, a.updated_at DESC
  )
  SELECT
    b.bloco_id,
    b.paciente_id,
    b.paciente_nome,
    b.data_atendimento,
    b.hora_inicial,
    b.codigo_tuss,
    b.terapias,
    b.profissionais,
    -- ── Guia, token e forma seguem o vínculo quando ele existe ────────────────
    -- Mesma ordem que get_auditoria_assim_periodo estabeleceu em 20260827000004:
    -- vínculo primeiro (é quem de fato autorizou e deixou o papel), posicional
    -- como fallback de sempre. Bloco sem vínculo não muda — `vin.*` vem tudo
    -- NULL e o COALESCE cai direto no valor de `mt`.
    COALESCE(vin.guia, mt.guia)             AS guia,
    COALESCE(vin.token, mt.token)           AS token,
    mt.data_execucao,
    fo.criado_por,
    -- ── Ordem do COALESCE: vínculo PRIMEIRO ────────────────────────────────
    -- Mesmo erro que 20260827000003 cometeu e 20260827000004 corrigiu na RPC
    -- diária: `fo.forma_autorizacao` é a resposta que a recepção deu para a
    -- guia GLOSADA (aqui, 'QR Code' da 9229) e nunca é nula quando a sessão foi
    -- solicitada pelo Pulsar — então um COALESCE com `fo` na frente nunca chega
    -- a avaliar `vin`. O vínculo tem de vir primeiro; `fo` continua como
    -- fallback para todo bloco sem vínculo, que é a maioria.
    COALESCE(
      public.forma_validacao_do_biofacial(vin.biofacial, vin.teve_token),
      -- Degrau que faltava (20260903010000): o biofacial da guia pareada por
      -- POSIÇÃO. Sem ele, bloco sem vínculo caía direto em `fo` e a tela
      -- mostrava o clique da recepção no lugar da resposta da ASSIM — 4 das 6
      -- linhas do `8-` sem token liam 'Token'/'QR Code' sem ter token.
      public.forma_validacao_do_biofacial(mt.biofacial,  mt.teve_token),
      fo.forma_autorizacao
    )                                        AS forma_autorizacao
  FROM blocos_auditoria b
  JOIN match_temporal mt ON mt.bloco_id = b.bloco_id
  LEFT JOIN fila_operacional fo
    ON  fo.paciente_id      = b.paciente_id
    AND fo.data_atendimento = b.data_atendimento
    AND fo.codigo_tuss      = b.codigo_tuss
    AND fo.horario          = b.hora_inicial
  -- ── Vínculo ativo deste bloco ──────────────────────────────────────────────
  -- Mesmo desenho do LATERAL `vin` de get_auditoria_assim_periodo: por bloco,
  -- não por partição, porque o vínculo é uma afirmação sobre UMA sessão.
  LEFT JOIN LATERAL (
    SELECT v.guia, aa2.teve_token, aa2.token, aa2.biofacial
    FROM public.autorizacoes_vinculos v
    JOIN public.autorizacoes_assim aa2 ON aa2.guia = v.guia
    WHERE v.bloco_id = b.bloco_id
      AND v.desfeito_em IS NULL
      AND v.tipo = 'vinculo'
    LIMIT 1
  ) vin ON true
  -- ── Reclassificação manual ────────────────────────────────────────────────
  -- A mesma tabela que get_auditoria_assim_periodo já consome desde
  -- 20260827000001, e que esta função passou a consumir em 20260828170000.
  -- Nenhum destino de reclassificação mantém o bloco como "papel a conferir".
  LEFT JOIN LATERAL (
    SELECT o.situacao_nova
    FROM public.auditoria_situacao_overrides o
    WHERE o.bloco_id = b.bloco_id
      AND o.desfeito_em IS NULL
    LIMIT 1
  ) ovr ON true
  WHERE (
      COALESCE(vin.teve_token, mt.teve_token) = true
      -- ── O ramo da FILA exclui a RECUSA ───────────────────────────────────
      -- Ver o cabeçalho desta migration: `fo.forma_autorizacao` é intenção da
      -- recepção, registrada ANTES da resposta da ASSIM. Sob recusa não saiu
      -- filipeta, e pedir conferência de um papel inexistente não tem resposta
      -- possível.
      --
      -- O teste de `vin.guia` preserva a Semente 3 — bloco com vínculo não é
      -- julgado pelo status da guia glosada que `mt` pareou.
      OR (
        fo.forma_autorizacao ILIKE '%reconhecimento facial%'
        AND vin.guia IS NULL
        -- Testa RECUSA, não liberação — e a diferença entre as duas é o que
        -- salva 19 linhas de julho/2026. Sem guia pareada, `mt.status` é NULL:
        -- a resposta da ASSIM é DESCONHECIDA, não negativa. É o
        -- RETORNO_NAO_CONFIRMADO, onde o registro da recepção é a única
        -- evidência que existe e o papel provavelmente está lá. Só a recusa
        -- explícita prova que filipeta não saiu.
        --
        -- Mesma forma do CASE de `situacao` em get_auditoria_assim_periodo
        -- (`status <> ALL (ARRAY[...])`), para as duas RPCs classificarem a
        -- resposta da ASSIM pela mesma régua. 'Liberado *' (cancelada) fica:
        -- a guia existiu e o papel saiu antes do cancelamento.
        AND NOT (mt.status IS NOT NULL AND mt.status <> ALL (ARRAY['Liberado', 'Liberado *']))
      )
      OR public.forma_validacao_do_biofacial(vin.biofacial, vin.teve_token)
           ILIKE '%reconhecimento facial%'
      -- ── `8-DISPOSITIVO INDISPONIVEL` exige filipeta (20260903000000) ─────
      -- Vínculo primeiro, posicional como fallback — a mesma precedência de
      -- guia/token/forma acima. Sem gate de recusa: biofacial é campo do
      -- RELATÓRIO da ASSIM (resposta), não do modal da recepção (intenção);
      -- ver o cabeçalho desta migration.
      --
      -- Pelo PREFIXO, não pelo rótulo de `forma_validacao_do_biofacial`, que
      -- devolve 'Token' quando o `8-` veio com token e perderia 97 dos 106
      -- casos medidos — justamente o inverso do pedido.
      OR split_part(btrim(COALESCE(vin.biofacial, mt.biofacial, '')), '-', 1) = '8'
    )
    AND ovr.situacao_nova IS NULL
    AND COALESCE(b.terapias, '') NOT ILIKE '%Equoterapia%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Fisioterapia Aquática%'
    AND COALESCE(b.terapias, '') NOT ILIKE '%Avaliação Neuropsicológica%'
  ORDER BY b.data_atendimento, b.hora_inicial, b.paciente_nome
$function$;

