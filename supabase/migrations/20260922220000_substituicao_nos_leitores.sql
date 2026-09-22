-- =============================================================================
-- A substituição chega aos leitores — e a falta capturada volta para a triagem
-- =============================================================================
--
-- Três defeitos com a MESMA raiz, reportados da tela em 22/09 logo depois de
-- 20260922210000 criar o tipo `substituicao`. Vão juntos porque consertá-los
-- separados deixaria a tela coerente num lugar e mentindo no outro.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFEITO 1 — a aba Auditoria ainda conta "Falta Terapeuta: 1"
--
-- `get_auditoria_assim_periodo` resolve a `situacao` por um LATERAL que filtra
-- `v.tipo = 'vinculo'`. O tipo `substituicao` não passa, a linha volta com
-- FALTA_TERAPEUTA, e o KPI conta a falta de um horário em que a sessão
-- aconteceu. A Reconciliação já mostrava a sessão como coberta — as duas telas
-- discordando sobre o mesmo bloco.
--
-- A causa é a que a memória deste projeto já registra: o CHECK protege a
-- escrita e nada protege a leitura. 20260922210000 ampliou os escritores e
-- `get_candidatas_vinculo`, e deixou os demais leitores para trás.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFEITO 2 — "Liberada além do agendado" sem botão de vínculo (guia 81418)
--
-- Medido em produção: paciente 12488, 03/09, Psicopedagogia (TUSS 22070435).
-- Uma sessão às 16:20, que virou FALTA. A guia 81418 saiu às 16:40 para aquele
-- horário, capturada pelo próprio Pulsar (`fila_autorizacoes.numero_autorizacao`).
--
-- O cartão acusava pendência e não oferecia ação nenhuma:
--   - o placar conta excedente, porque a falta não entra em `agendadas`
--     (SITUACOES_SEM_SESSAO) e a liberação fica sem sessão embaixo;
--   - `get_guias_orfas` NÃO devolve a guia, porque existe captura não-avulsa —
--     e o filtro lê captura como "esta guia já está reconciliada";
--   - o botão só aparece em `estado = 'sem-vinculo'`, que vem da fila de órfãs.
--
-- Beco sem saída: a grade marca o cartão de âmbar e não há gesto que o resolva.
--
-- O PREDICADO ESTAVA CERTO PELA PREMISSA ERRADA. O comentário de 20260910120000
-- diz: "guia capturada pelo próprio Pulsar PARA UMA SESSÃO sai da fila — a linha
-- da fila É a sessão que ela cobre". A premissa é o "PARA UMA SESSÃO". Quando
-- essa linha está em `status = 'falta'`, não há sessão: a captura prova de onde
-- veio a guia, não que ela cobriu algo. A guia continua precisando de desfecho
-- (ninguém assumiu, ou houve substituto), exatamente como a avulsa.
--
-- Decidido com o usuário (22/09): guia capturada sobre falta deve ser triável na
-- Reconciliação, pela mesma porta da avulsa. As duas rotas levavam ao mesmo
-- fato e só uma tinha saída pela tela.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEFEITO 3 — assimetrias residuais de 20260922210000
--
-- `reclassificar_situacao` e `vincular_autorizacao_falta` continuam vendo só
-- `'vinculo'` / `'falta_terapeuta'`. A primeira deixaria reclassificar uma
-- sessão coberta por substituição (o vínculo deve vencer o override, como já
-- vence para `vinculo`); a segunda barra pelo índice único, mas com erro de
-- constraint cru em vez da mensagem que a tela sabe mostrar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION NÃO FAZ
--
-- `get_tokens_mensal` fica FORA, de propósito. Ele decide filipeta/token do mês,
-- que encosta em faturamento, e o usuário pediu para medir o impacto antes. As
-- linhas de `substituicao` existentes hoje são poucas (o tipo nasceu em 22/09),
-- então adiar não acumula dívida — mas fica registrado que ele é o ÚLTIMO leitor
-- vivo ainda cego ao tipo novo.
--
-- A falta do titular continua registrada em `fila_autorizacoes`, como sempre:
-- nada aqui a desfaz. Ver 20260922210000.
-- =============================================================================


-- =============================================================================
-- 1. get_auditoria_assim_periodo — a substituição cobre o bloco
-- =============================================================================
-- Corpo idêntico ao de 20260916130100 exceto por UMA linha: o LATERAL `vin`
-- passa a aceitar os dois tipos que afirmam cobertura. Recriada inteira porque
-- não há como alterar um predicado dentro de uma função sql.
--
-- O `CASE` de `situacao` não muda e não precisa mudar: ele já pergunta
-- "`vin.guia IS NOT NULL`?", e agora essa pergunta inclui a substituição. A
-- sessão vira LIBERADA (ou GLOSA_RESOLVIDA, se havia glosa), sai dos cards de
-- falta e entra no total — que é o que "a sessão aconteceu" significa.
--
-- `forma_autorizacao` segue junto pelo mesmo LATERAL (`vin_teve_token`,
-- `vin_biofacial`): a filipeta que vale é a da guia que de fato autorizou.

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
          -- Sessao adiantada nao e falta: houve atendimento, em outra data
          -- (20260916120000). Ela volta a Conferencia com a data efetiva.
          AND f.data_atendimento_real IS NULL
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
    WHERE v.bloco_id = b.bloco_id
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

COMMENT ON FUNCTION public.get_auditoria_assim_periodo(date, date) IS
  'A Conferencia ASSIM de um periodo. A cobertura por triagem manual entra pelos tipos que AFIRMAM cobertura -- vinculo e substituicao (20260922220000) --, nunca por falta_terapeuta, onde ninguem assumiu a sessao. O pareamento posicional continua excluindo TODA guia triada, de qualquer tipo.';

REVOKE ALL ON FUNCTION public.get_auditoria_assim_periodo(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_auditoria_assim_periodo(date, date) TO authenticated;


-- =============================================================================
-- 2. get_guias_orfas -- captura sobre FALTA nao reconcilia nada
-- =============================================================================
-- Recriada a partir do corpo vivo (20260910130000), com UMA clausula a mais no
-- predicado da captura. Ver o Defeito 2 no cabecalho.
--
-- O que NAO muda: captura sobre linha normal continua tirando a guia da fila.
-- E o filtro que sustenta 4.796 das 4.820 exclusoes medidas em 40 dias
-- (20260910120000), e continua valendo onde a premissa dele vale.

CREATE OR REPLACE FUNCTION public.get_guias_orfas(p_de date, p_ate date)
RETURNS TABLE (
  guia                text,
  carteirinha         text,
  paciente_id         bigint,
  paciente_nome       text,
  data_execucao       timestamp without time zone,
  codigo_tuss         text,
  status              text,
  teve_token          boolean,
  token               text,
  biofacial           text,
  ordem_autorizacao   bigint,
  sessoes_na_particao bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
-- Declarado aqui dentro, e não por ALTER FUNCTION: `create or replace` descarta
-- o proconfig posto de fora, calado (20260817:CREATE OR REPLACE perde proconfig).
SET statement_timeout = '15s'
AS $$
  with n_sessoes as (
    select b.empresa, b.matricula, b.dep, b.data_atendimento, b.codigo_tuss,
           count(*) as n
    from public.fn_blocos_assim(p_de, p_ate) b
    group by 1,2,3,4,5
  ),
  avulsas as (
    select guia, horario_autorizacao from public.guias_avulsas(p_de, p_ate)
  ),
  guias as (
    select
      aa.guia,
      aa.matricula as carteirinha,
      aa.paciente_id,
      aa.paciente_nome,
      aa.data_execucao,
      aa.codigo_tuss,
      aa.status,
      aa.teve_token,
      aa.token,
      aa.biofacial,
      split_part(aa.matricula, '.', 1) as empresa,
      split_part(aa.matricula, '.', 2) as matricula_base,
      split_part(aa.matricula, '.', 3) as dep,
      row_number() over (
        partition by split_part(aa.matricula,'.',1), split_part(aa.matricula,'.',2),
                     split_part(aa.matricula,'.',3), date(aa.data_execucao), aa.codigo_tuss
        -- A AVULSA por último. `false` ordena antes de `true`, então a guia
        -- normal fica com as sessões e a avulsa cai no excedente — onde ela
        -- pertence, porque não cobre sessão nenhuma (20260825130000:54). Sem
        -- isto, uma refação tirada de manhã tomava a sessão da tarde e a guia
        -- legítima virava "Não identificada" (caso Ysadora, 02/09).
        order by (av.guia is not null), aa.data_execucao
      ) as ordem_autorizacao
    from public.autorizacoes_assim aa
    -- Marca a avulsa SEM tirá-la da partição: excluí-la renumeraria as outras e
    -- a faria deixar de contar como excedente, que é justamente o mecanismo que
    -- a leva para a triagem. Casamento por guia + tempo porque o número recicla.
    left join avulsas av
      on  av.guia = aa.guia
      and av.horario_autorizacao between aa.data_execucao - interval '5 minutes'
                                     and aa.data_execucao + interval '5 minutes'
    -- Nada de filtro de `status` aqui: o WHERE roda antes da função de janela, e
    -- tirar a glosa da partição faria a liberação posterior virar ordem 1 e
    -- deixar de ser excedente — o caso da Kourtney desapareceria da tela.
    -- `status` e `codigo_tuss` são filtrados no WHERE final.
    where aa.data_execucao is not null      -- há 2 linhas de teste em produção
                                            -- (TESTE123/TESTE999) com tudo nulo
      and date(aa.data_execucao) between p_de and p_ate
      -- Idêntica à da CTE `autorizacoes` de get_auditoria_assim_periodo
      -- (20260821030000): guia já triada não compete por posição. Se as duas
      -- divergirem, a Reconciliação oferece guia que a Conferência já casou.
      and not exists (
        select 1 from public.autorizacoes_vinculos v
        where v.guia = aa.guia and v.desfeito_em is null
      )
  )
  select
    g.guia, g.carteirinha, g.paciente_id, g.paciente_nome, g.data_execucao,
    g.codigo_tuss, g.status, g.teve_token, g.token, g.biofacial,
    g.ordem_autorizacao, coalesce(ns.n, 0) as sessoes_na_particao
  from guias g
  left join n_sessoes ns
    on  ns.empresa          = g.empresa
    and ns.matricula        = g.matricula_base
    and ns.dep              = g.dep
    and ns.data_atendimento = date(g.data_execucao)
    and ns.codigo_tuss      = g.codigo_tuss
  where g.status = 'Liberado'        -- 'Liberado *' = cancelada; o resto é glosa
    and g.codigo_tuss is not null
    and g.ordem_autorizacao > coalesce(ns.n, 0)
    -- Guia capturada pelo próprio Pulsar PARA UMA SESSÃO sai da fila de órfãs —
    -- a linha da fila É a sessão que ela cobre. Só que essa leitura vale onde a
    -- premissa vale: quando as liberações do dia EXCEDEM as sessões conhecidas
    -- (`ns.n >= 1` junto do `ordem > n` acima), uma delas não cobre nada por
    -- aritmética, e a captura não diz qual — então a guia volta a precisar de
    -- triagem manual. Com `ns.n = 0` a grade não sabe de sessão nenhuma e o
    -- excedente é aparente, não medido: é o ramo que sustenta o filtro (4.796
    -- das 4.820 descartas medidas em 40 dias são desse tipo). Ver 20260910120000.
    --
    -- Comparação SEMPRE qualificada por tempo: o número da guia recicla
    -- (20260805170300:99-107). Escrita como faixa sobre a coluna crua, e não como
    -- `abs(extract(epoch ...)) <= 300`, para caber em
    -- idx_fila_autorizacoes_guia_horario (20260824000000).
    and (
      coalesce(ns.n, 0) >= 1
      or not exists (
        select 1 from public.fila_autorizacoes fa
        where fa.numero_autorizacao = g.guia
          and fa.horario_autorizacao between g.data_execucao - interval '5 minutes'
                                         and g.data_execucao + interval '5 minutes'
          -- A linha AVULSA não conta como captura: ela não representa sessão
          -- nenhuma (20260825130000:54), então a guia dela não está reconciliada
          -- com nada e é justamente a que precisa de vínculo manual
          -- (20260903100000).
          and fa.avulsa = false
          -- A LINHA EM FALTA NAO RECONCILIA (2026-09-22, guia 81418).
          --
          -- O predicado le captura como "a linha da fila E a sessao que esta
          -- guia cobre". Numa falta nao ha sessao: a captura diz de ONDE VEIO a
          -- guia, nao que algo foi coberto. Sem esta clausula a guia sumia da
          -- fila de orfas e o cartao ficava ambar sem botao -- o placar
          -- acusando excedente (a falta nao entra em `agendadas`) e nenhuma
          -- porta para tria-la. Medido: paciente 12488, 03/09, TUSS 22070435,
          -- 1 liberacao para 1 sessao que virou falta.
          and fa.status <> 'falta'
      )
    )
  order by g.data_execucao desc, g.guia
$$;

COMMENT ON FUNCTION public.get_guias_orfas(date, date) IS
  'Guias da ASSIM que sobraram do pareamento posicional e pedem triagem manual. Captura pelo proprio Pulsar tira a guia da fila SO quando a linha capturada e uma sessao de verdade: linha em `falta` nao reconcilia nada (20260922220000), e a guia volta para a triagem como a avulsa.';

REVOKE ALL ON FUNCTION public.get_guias_orfas(date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_guias_orfas(date, date) TO authenticated;


-- =============================================================================
-- 3. As duas guardas de escrita que ficaram para tras
-- =============================================================================

-- 3a) reclassificar_situacao -- a substituicao tambem vence o override.
--     Corpo do original (20260827000000) com o predicado da guarda 5 ampliado.

create or replace function public.reclassificar_situacao(
  p_bloco_id      text,
  p_situacao_nova text,
  p_justificativa text
)
returns uuid
language plpgsql
security definer
set search_path = public
-- A validação (3) chama get_auditoria_assim_periodo de UM dia, que é a chamada
-- que sempre respondeu (a de sete dias é que estoura — 20260821000000:158-162).
-- O teto existe para o dia patológico não pendurar a tela.
set statement_timeout = '55s'
as $$
declare
  v_role  text := public.fn_usuario_role();
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_data  date;
  v_atual text;
  v_id    uuid;
begin
  if v_role is null or v_role not in ('admin', 'autorizacao') then
    raise exception 'Sem permissão para reclassificar situações'
      using errcode = '42501';
  end if;
  select nome into v_nome from public.usuarios where id = v_uid;

  -- 1) justificativa de verdade. O NOT NULL da coluna não basta: string vazia e
  --    um espaço passariam por ele, e é exatamente o que um formulário manda
  --    quando o campo não foi preenchido.
  if nullif(btrim(coalesce(p_justificativa, '')), '') is null then
    raise exception 'Justificativa é obrigatória para reclassificar uma situação'
      using errcode = '22023';
  end if;
  if length(btrim(p_justificativa)) < 10 then
    raise exception 'Justificativa muito curta (mínimo 10 caracteres) — descreva o que de fato aconteceu'
      using errcode = '22023';
  end if;

  -- 2) destino dentro do conjunto seguro. A constraint da tabela já garante,
  --    mas o erro dela é ilegível para quem está na tela; este diz o que fazer.
  if p_situacao_nova not in ('FALTA', 'FALTA_TERAPEUTA', 'CANCELADA', 'NAO_SOLICITADA') then
    raise exception 'Situação de destino inválida: %. Permitidas: FALTA, FALTA_TERAPEUTA, CANCELADA, NAO_SOLICITADA. Para afirmar cobertura use a aba Reconciliação, que exige uma guia real.',
      coalesce(p_situacao_nova, '(nulo)') using errcode = '22023';
  end if;

  -- 3) o bloco existe de fato, e qual é a situação que ele mostra HOJE.
  --    O dia sai do próprio bloco_id (`pacienteId_YYYY-MM-DD_TUSS_HH:MM:SS`),
  --    que é o que permite chamar a RPC de um dia só em vez de varrer período.
  begin
    v_data := split_part(p_bloco_id, '_', 2)::date;
  exception when others then
    raise exception 'bloco_id malformado: % (esperado pacienteId_YYYY-MM-DD_TUSS_HH:MM:SS)', p_bloco_id
      using errcode = '22023';
  end;

  select a.situacao into v_atual
  from public.get_auditoria_assim_periodo(v_data, v_data) a
  where a.bloco_id = p_bloco_id;

  if not found then
    raise exception 'Sessão % não existe na Conferência de % (sessão inativa, reagendada ou fora do recorte ASSIM)',
      p_bloco_id, v_data using errcode = 'P0002';
  end if;

  -- 4) não reclassificar para o que já é. Sem esta guarda a constraint estouraria
  --    com uma mensagem que ninguém entende.
  if v_atual = p_situacao_nova then
    raise exception 'Sessão % já está como %', p_bloco_id, p_situacao_nova
      using errcode = '22023';
  end if;

  -- 5) uma sessão coberta por vínculo não se reclassifica.
  --    A ordem entre as duas camadas é decidida AQUI, na escrita, e não na
  --    leitura: o vínculo aponta uma guia real da ASSIM cobrindo aquele
  --    atendimento, e dizer "faltou" sobre uma sessão que o convênio autorizou e
  --    vai pagar é uma contradição, não uma correção. Se a guia estiver errada,
  --    o caminho é desfazer o vínculo primeiro — e aí esta porta abre.
  if exists (
    select 1 from public.autorizacoes_vinculos v
    where v.bloco_id = p_bloco_id and v.desfeito_em is null
      -- OS DOIS TIPOS QUE AFIRMAM COBERTURA (2026-09-22). A substituicao diz
      -- que a sessao ACONTECEU com outro profissional; dizer 'faltou' sobre
      -- ela e a mesma contradicao que o comentario acima descreve.
      and v.tipo in ('vinculo', 'substituicao')
  ) then
    raise exception 'Sessão % está coberta por uma guia vinculada. Desfaça o vínculo antes de reclassificar.',
      p_bloco_id using errcode = '22023';
  end if;

  -- 6) uma reclassificação ativa por sessão
  if exists (
    select 1 from public.auditoria_situacao_overrides o
    where o.bloco_id = p_bloco_id and o.desfeito_em is null
  ) then
    raise exception 'Sessão % já foi reclassificada. Desfaça a reclassificação atual antes de refazer.',
      p_bloco_id using errcode = '23505';
  end if;

  insert into public.auditoria_situacao_overrides
    (bloco_id, situacao_anterior, situacao_nova, justificativa,
     reclassificado_por, reclassificado_por_id)
  values
    (p_bloco_id, v_atual, p_situacao_nova, btrim(p_justificativa),
     coalesce(v_nome, 'Usuário'), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;


REVOKE ALL ON FUNCTION public.reclassificar_situacao(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reclassificar_situacao(text, text, text) TO authenticated;


-- 3b) vincular_autorizacao_falta — mensagem legível quando a falta já foi triada.
--
-- A guarda 10 via só `falta_terapeuta`. O índice único já barra o caso (ele foi
-- ampliado em 20260922210000), mas o erro chegava como 23505 cru em vez da
-- frase que a tela sabe mostrar. Uma guarda que não cobre o que o índice cobre
-- só existe para produzir erro feio.
--
-- Só a linha do predicado muda; o corpo é o de 20260921100000.
CREATE OR REPLACE FUNCTION public.vincular_autorizacao_falta(
  p_guia        text,
  p_fila_id     uuid,
  p_observacao  text    default null,
  p_janela_dias integer default 7
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '30s'
AS $$
declare
  v_role  text := public.fn_usuario_role();
  v_uid   uuid := auth.uid();
  v_nome  text;
  v_g     record;
  v_f     record;
  v_bloco text;
  v_id    uuid;
begin
  if v_role is null or v_role not in ('admin', 'autorizacao', 'recepcao') then
    raise exception 'Sem permissão para vincular autorizações' using errcode = '42501';
  end if;
  select nome into v_nome from public.usuarios where id = v_uid;

  if p_janela_dias is null or p_janela_dias < 0 or p_janela_dias > 60 then
    raise exception 'Janela inválida: % (esperado 0..60)', p_janela_dias using errcode = '22023';
  end if;

  select aa.guia, aa.matricula, aa.data_execucao, aa.codigo_tuss, aa.status, aa.paciente_id
    into v_g
  from public.autorizacoes_assim aa where aa.guia = p_guia;
  if not found then
    raise exception 'Guia % não existe em autorizacoes_assim', p_guia using errcode = 'P0002';
  end if;
  if v_g.status is distinct from 'Liberado' then
    raise exception 'Guia % não está liberada (status: %). Só autorização liberada cobre sessão.',
      p_guia, coalesce(v_g.status, '(nulo)') using errcode = '22023';
  end if;
  if v_g.data_execucao is null or v_g.codigo_tuss is null then
    raise exception 'Guia % sem data_execucao ou TUSS', p_guia using errcode = '22023';
  end if;

  if exists (select 1 from public.autorizacoes_vinculos v
             where v.guia = p_guia and v.desfeito_em is null) then
    raise exception 'Guia % já foi triada. Desfaça o vínculo atual antes de refazer.', p_guia
      using errcode = '23505';
  end if;

  select f.id, f.paciente_id, f.paciente_nome, f.data_atendimento, f.horario,
         f.tuss, f.tipo_falta, f.data_atendimento_real, f.numero_autorizacao
    into v_f
  from public.fila_autorizacoes f where f.id = p_fila_id;
  if not found then
    raise exception 'Linha de fila % não existe', p_fila_id using errcode = 'P0002';
  end if;

  if coalesce(v_f.tipo_falta, '') not ilike '%terapeuta%' then
    raise exception 'Só falta de TERAPEUTA pode receber a autorização de uma guia (esta é: %)',
      coalesce(nullif(btrim(v_f.tipo_falta), ''), '(sem tipo de falta)') using errcode = '22023';
  end if;

  if v_f.data_atendimento_real is not null then
    raise exception 'Esta sessão foi marcada como adiantada para % — ela voltou à Conferência como sessão, e o vínculo correto é o de sessão.',
      v_f.data_atendimento_real using errcode = '22023';
  end if;

  if v_f.tuss is distinct from v_g.codigo_tuss then
    raise exception 'TUSS divergente: guia % é %, falta é %',
      p_guia, v_g.codigo_tuss, coalesce(v_f.tuss, '(nulo)') using errcode = '22023';
  end if;

  if v_f.paciente_id::bigint is distinct from v_g.paciente_id then
    raise exception 'Beneficiário divergente: guia % é do paciente %, falta é do paciente %',
      p_guia, v_g.paciente_id, v_f.paciente_id using errcode = '22023';
  end if;

  if v_f.data_atendimento > date(v_g.data_execucao)
  or v_f.data_atendimento < date(v_g.data_execucao) - p_janela_dias then
    raise exception 'Falta de % fora da janela de % dias da autorização (%)',
      v_f.data_atendimento, p_janela_dias, date(v_g.data_execucao) using errcode = '22023';
  end if;

  -- OS DOIS TIPOS DE TRIAGEM DE FALTA (2026-09-22) — par do índice único
  -- autorizacoes_vinculos_falta_ativa_uq, ampliado em 20260922210000.
  if exists (select 1 from public.autorizacoes_vinculos v
             where v.fila_id = p_fila_id and v.desfeito_em is null
               and v.tipo in ('falta_terapeuta', 'substituicao')) then
    raise exception 'Esta falta já tem uma autorização registrada' using errcode = '23505';
  end if;

  v_bloco := 'falta_' || v_f.paciente_id::text
                      || '_' || v_f.data_atendimento::text
                      || '_' || v_f.horario::text
                      || '_' || v_f.tuss;

  insert into public.autorizacoes_vinculos
    (guia, tipo, bloco_id, fila_id, guia_original, observacao,
     vinculado_por, vinculado_por_id)
  values
    (p_guia, 'falta_terapeuta', v_bloco, p_fila_id, v_f.numero_autorizacao,
     nullif(btrim(p_observacao), ''), coalesce(v_nome, 'Usuário'), v_uid)
  returning id into v_id;

  return v_id;
end;
$$;

REVOKE ALL ON FUNCTION public.vincular_autorizacao_falta(text, uuid, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.vincular_autorizacao_falta(text, uuid, text, integer) TO authenticated;
