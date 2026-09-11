-- =============================================================================
-- `biofacial` na auditoria diária, e a forma volta a ser a resposta da ASSIM
-- =============================================================================
--
-- O CASO
-- ADRIAN ARAUJO NERY, 01/09/2026 10:00, guia 5665. No extrato da ASSIM:
--
--   biofacial = '8-DISPOSITIVO INDISPONIVEL'
--   token     = (vazio)
--   status    = Liberado
--
-- Na aba /auditoria-assim?tab=auditoria a linha não oferece o seletor de
-- conferência, e o modal de detalhamento exibe FORMA = 'Token' — numa sessão
-- que não teve token nenhum. Duas afirmações erradas sobre a mesma sessão.
--
-- Pela regra que 20260903000000 estabeleceu, `8-` SEM token é exatamente o caso
-- que deixa papel: sem dispositivo, a ASSIM cai no #checkBday e emite a
-- filipeta. A sessão TEM papel a conferir, e `get_tokens_mensal` já a cobra no
-- modal de Conferência de Filipetas desde 03/09 (20260910130000:1107). Só a aba
-- Auditoria discorda — e as duas pontas falam do MESMO papel.
--
-- A CAUSA — dois defeitos que se sustentam
--
-- 1. `forma_autorizacao` tinha a precedência invertida. A RPC diária ficou em
--    `COALESCE(fo.forma_autorizacao, forma_validacao_do_biofacial(mt...))`, e
--    `fo.forma_autorizacao` — o clique da recepção no modal do robô, registrado
--    ANTES de a ASSIM responder — nunca é nulo quando a sessão foi solicitada
--    pelo Pulsar. O ramo do biofacial jamais era avaliado. É precisamente o bug
--    que 20260903010000 diagnosticou e corrigiu... só em `get_tokens_mensal`.
--    A diária nunca recebeu a correção.
--
--    O ramo do VÍNCULO, que 20260827000004:442-448 tinha, também sumiu no
--    caminho — e não podia voltar, porque o LATERAL `vin` daqui projeta apenas
--    `guia, guia_original, vinculado_por, vinculado_em, data_execucao`. Sem
--    `vin.biofacial`/`vin.teve_token` no escopo, o degrau era inescrevível.
--
-- 2. `biofacial` não saía da função. O campo circula internamente (alimenta
--    `forma_validacao_do_biofacial`) e morre ali: não está no RETURNS TABLE. O
--    frontend não tinha como aplicar a regra do `8-` nem se quisesse, porque o
--    dado não chegava.
--
-- A CORREÇÃO
-- (a) O LATERAL `vin` ganha `teve_token`, `token` e `biofacial` — o mesmo
--     desenho que o `vin` de get_tokens_mensal já tem (20260910130000:1051).
--     Aliases `vin_*` porque aqui esses nomes são colunas de SAÍDA.
-- (b) `forma_autorizacao` passa a ter os três degraus canônicos:
--     vínculo → posicional → fila. Idêntico a get_tokens_mensal:1031-1039.
-- (c) `biofacial` passa a ser devolvido, já resolvido por
--     `COALESCE(vin, mt)` — a precedência mora no SQL, não duplicada em TS.
--
-- O QUE MUDA EM TELA
-- A sessão do Adrian (e suas semelhantes) passa a ler FORMA = 'Dispositivo
-- indisponível' e a exibir o pill "Conferir". Nenhuma linha PERDE o pill: a
-- mudança do gate é estritamente aditiva, e ela faz a aba Auditoria concordar
-- com a Conferência de Filipetas, que já cobrava esses papéis.
--
-- Efeito colateral aceito conscientemente: onde a recepção clicou "erro no
-- reconhecimento facial" e a ASSIM respondeu outra coisa, a legenda deixa de
-- repetir a intenção da recepção e passa a dizer a resposta da ASSIM. É o
-- objetivo da correção — a resposta é mais informativa que a intenção.
--
-- DÍVIDA DEIXADA DE PROPÓSITO
-- `teve_token` e `token` continuam `mt.*` CRUS, sem `COALESCE(vin.*, mt.*)`,
-- divergindo de get_tokens_mensal (20260910130000:1021, 1071). Alinhá-los faria
-- o primeiro ramo de `temPapelParaConferir` (`if (item.teve_token)`) disparar em
-- todo bloco com vínculo ativo — pills apareceriam por um caminho que NÃO é o
-- que este bug pede. É correção legítima, mas é outro assunto e merece a própria
-- contraprova: quantos blocos com vínculo mudam de estado.
--
-- Corpo idêntico à definição viva (20260910130000), exceto (a), (b) e (c).
-- `get_auditoria_assim(date)` é recriada OBRIGATORIAMENTE junto: ela é
-- `SELECT * FROM get_auditoria_assim_periodo(...)`, e uma coluna a mais na
-- função interna sem o mesmo RETURNS TABLE no wrapper derruba a tela diária com
-- "structure of query does not match function result type".
--
-- Nenhuma das duas funções tem `proconfig` hoje (medido em 2026-09-11: nulo nas
-- duas; só get_tokens_mensal tem `statement_timeout=30s`). Nada a replicar aqui,
-- e nada a acrescentar: ganhar um timeout que não existia seria mudança de
-- comportamento não pedida.
--
-- POR QUE DROP E NÃO `CREATE OR REPLACE`
-- As colunas de um `RETURNS TABLE` são parâmetros OUT, e trocar a assinatura por
-- REPLACE é recusado com 42P13 ("cannot change return type of existing
-- function"). Acrescentar `biofacial` exige DROP + CREATE. Mesmo caminho que
-- 20260825010000:64-65 e 20260828190000:47-48 já percorreram em produção, com
-- estes mesmos chamadores no ar.
--
-- A ORDEM IMPORTA: o wrapper primeiro, a função de período depois — o inverso
-- deixaria o wrapper apontando para uma função inexistente. E o DROP APAGA OS
-- GRANTS, por isso os `GRANT EXECUTE ... TO anon, authenticated` são re-emitidos
-- ao fim de cada CREATE. Sem eles a tela inteira responde 403.
--
-- Sem CASCADE, de propósito: as 5 funções que chamam estas duas
-- (detect_r2_sessao_sem_autorizacao, get_candidatas_vinculo,
-- fn_alertas_avaliar_assim, reclassificar_situacao,
-- refresh_auditoria_assim_resumo) selecionam COLUNAS NOMEADAS e sobrevivem à
-- coluna nova; chamada dentro de corpo de função não registra dependência em
-- pg_depend, então nada bloqueia o DROP. Se o DROP reclamar de dependência, é
-- porque surgiu uma VIEW nova sobre a função — pare e investigue, não force
-- CASCADE.

DROP FUNCTION IF EXISTS public.get_auditoria_assim(date);
DROP FUNCTION IF EXISTS public.get_auditoria_assim_periodo(date, date);

CREATE OR REPLACE FUNCTION public.get_auditoria_assim_periodo(p_data_inicio date, p_data_fim date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, empresa text, matricula text, dep text, carteirinha text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint, guia text, status_assim text, codigo_erro text, descricao_erro text, data_execucao timestamp with time zone, autorizacao_updated_at timestamp with time zone, diferenca_minutos numeric, situacao text, prioridade integer, dias_atraso integer, possui_autorizacao boolean, possui_solicitacao boolean, observacao text, motivo_glosa text, teve_token boolean, token text, biofacial text, criado_por text, forma_autorizacao text, horario_autorizacao timestamp without time zone, guia_origem text, reclassificacao_situacao_anterior text, reclassificacao_justificativa text, reclassificacao_por text, reclassificacao_em timestamp with time zone)
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
        public.tuss_da_sessao(at.terapia_exibicao_nome, at.terapia_id, at.terapia_nome) AS codigo_tuss
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
          AND (
            (f.status IS DISTINCT FROM 'glosa'
             AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
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
        (f.status IS DISTINCT FROM 'glosa'
         AND upper(COALESCE(f.status_assim, '')) LIKE '%FALTA%')
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%PACIENTE%'
        OR upper(COALESCE(f.tipo_falta, '')) LIKE '%TERAPEUTA%'
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
    ovr.reclassificado_em                                  AS reclassificacao_em
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
    WHERE v.bloco_id = b.bloco_id
      AND v.desfeito_em IS NULL
      AND v.tipo = 'vinculo'
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
$function$
;

comment on function public.get_auditoria_assim_periodo(date, date) is
  'Conferência ASSIM por período. Considera public.autorizacoes_vinculos e public.auditoria_situacao_overrides. Devolve guia_origem e os metadados crus da reclassificação ativa (reclassificacao_situacao_anterior, reclassificacao_justificativa, reclassificacao_por, reclassificacao_em), para o detalhamento mostrar a decisão em vez de só a situação final.';

GRANT EXECUTE ON FUNCTION public.get_auditoria_assim_periodo(date, date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_auditoria_assim(p_data date)
 RETURNS TABLE(bloco_id text, paciente_id text, paciente_nome text, empresa text, matricula text, dep text, carteirinha text, data_atendimento date, hora_inicial time without time zone, codigo_tuss text, convenio_nome text, terapias text, profissionais text, quantidade_sessoes bigint, guia text, status_assim text, codigo_erro text, descricao_erro text, data_execucao timestamp with time zone, autorizacao_updated_at timestamp with time zone, diferenca_minutos numeric, situacao text, prioridade integer, dias_atraso integer, possui_autorizacao boolean, possui_solicitacao boolean, observacao text, motivo_glosa text, teve_token boolean, token text, biofacial text, criado_por text, forma_autorizacao text, horario_autorizacao timestamp without time zone, guia_origem text, reclassificacao_situacao_anterior text, reclassificacao_justificativa text, reclassificacao_por text, reclassificacao_em timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT * FROM public.get_auditoria_assim_periodo(p_data, p_data)
$function$
;

GRANT EXECUTE ON FUNCTION public.get_auditoria_assim(date) TO anon, authenticated;
