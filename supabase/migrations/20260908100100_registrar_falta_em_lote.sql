-- Falta em lote: registrar_falta_em_lote() e reverter_falta_em_lote().
--
-- Depende de 20260908100000 (motivo_falta, falta_lote_id).
--
-- ─── Por que uma RPC e não um laço no cliente ────────────────────────────────
--
-- A RLS já deixa a recepção escrever direto na fila (fila_autorizacoes_recepcao_
-- insert/_update, de 20260610000011). Então SECURITY DEFINER aqui NÃO é sobre
-- privilégio. É sobre quatro coisas que o laço client-side não entrega:
--
--   Atomicidade   Um feriado são centenas de sessões. O caminho individual faz
--                 SELECT → UPDATE (ou INSERT → UPDATE) por sessão, sequencial,
--                 sem transação. Aba fechada, Wi-Fi caído ou token expirado no
--                 meio deixa metade do dia em falta e metade não, e ninguém sabe
--                 onde parou. Aqui é tudo ou nada.
--
--   Round-trips   300 sessões × 2–3 chamadas = 600–900 requisições HTTP. Uma.
--
--   Autoria       auth.uid() → usuarios.nome resolvido no servidor, não um valor
--                 que o cliente manda (e que resolverNomeUsuario devolve NULL
--                 quando não há sessão).
--
--   Recorte       O conjunto elegível é calculado na MESMA transação em que é
--                 escrito. O listaDia do browser pode estar minutos velho, e
--                 outra atendente pode ter concluído uma sessão nesse intervalo.
--
-- ─── A contrapartida do DEFINER ──────────────────────────────────────────────
--
-- DEFINER desliga a RLS. Então esta função precisa fazer no corpo o que as
-- policies fariam:
--
--   1. Gate de papel explícito (abaixo).
--   2. ISOLAMENTO POR UNIDADE. listar_central_autorizacoes filtra por
--      usuarios.unidades × sala_nome ILIKE na leitura. Sem replicar isso aqui,
--      uma recepcionista de uma unidade fecharia o dia inteiro de outra. É o
--      maior risco desta função e o bloco está copiado literal de lá.
--
-- ─── Granularidade ───────────────────────────────────────────────────────────
--
-- Escreve UMA LINHA POR SLOT (paciente, data, horário, tuss) — a granularidade
-- real da fila. O fluxo individual casa só `tuss = codigos_tuss[0]` e por isso
-- perde a segunda terapia de um horário; ver a nota em 20260908100000.
--
-- Rollback:
--   drop function if exists public.registrar_falta_em_lote(date,text,text,text,text,time,text,boolean,uuid);
--   drop function if exists public.reverter_falta_em_lote(uuid);

-- ═══════════════════════════════════════════════════════════════════════════
-- registrar_falta_em_lote
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.registrar_falta_em_lote(
  p_data          date,
  p_motivo        text,
  p_justificativa text,
  -- 'unidade' por padrão: o lote existe para feriado e afins, em que a clínica
  -- não abriu. Marcar isso como falta DO PACIENTE seria registrar uma ausência
  -- de quem não faltou — e é exatamente o que contamina a assiduidade.
  p_tipo_falta    text    DEFAULT 'unidade',
  p_unidade       text    DEFAULT NULL,
  p_horario       time without time zone DEFAULT NULL,
  p_convenio_nome text    DEFAULT NULL,
  p_dry_run       boolean DEFAULT true,
  p_lote_id       uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- Declarado aqui dentro de propósito: CREATE OR REPLACE descarta o proconfig
-- posto por ALTER FUNCTION, e o search_path sumiria calado numa reaplicação.
SET search_path = public
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_nome         text;
  v_lote         uuid := COALESCE(p_lote_id, gen_random_uuid());
  v_atualizadas  integer := 0;
  v_criadas      integer := 0;
  v_ignoradas    jsonb;
  v_total_ign    integer := 0;
  v_aplicaveis   integer := 0;
BEGIN
  -- ── 1. Gate de papel ──────────────────────────────────────────────────────
  SELECT u.nome INTO v_nome
  FROM public.usuarios u
  WHERE u.id = v_uid
    AND u.ativo
    AND u.role IN ('recepcao', 'autorizacao', 'admin', 'diretoria');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sem permissão para lançar falta em lote'
      USING ERRCODE = '42501';
  END IF;

  -- ── 2. Validação de entrada ───────────────────────────────────────────────
  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Data é obrigatória' USING ERRCODE = '22004';
  END IF;

  IF p_motivo IS NULL OR p_motivo NOT IN (
       'feriado','ponto_facultativo','falta_energia','evento_climatico','outro') THEN
    RAISE EXCEPTION 'Motivo inválido: %', COALESCE(p_motivo, '(nulo)')
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(btrim(p_justificativa), '') = '' THEN
    RAISE EXCEPTION 'Justificativa é obrigatória' USING ERRCODE = '22004';
  END IF;

  IF p_tipo_falta IS NULL OR p_tipo_falta NOT IN ('paciente','terapeuta','unidade') THEN
    RAISE EXCEPTION 'Tipo de falta inválido: %', COALESCE(p_tipo_falta, '(nulo)')
      USING ERRCODE = '22023';
  END IF;

  -- Guarda de duplo clique: se este lote_id já escreveu, não escreve de novo.
  -- O cliente manda o mesmo id no dry-run e na confirmação justamente para que
  -- um retry por timeout de rede reentre aqui em vez de duplicar o lançamento.
  IF NOT p_dry_run AND EXISTS (
       SELECT 1 FROM public.fila_autorizacoes WHERE falta_lote_id = v_lote) THEN
    RAISE EXCEPTION 'Este lote já foi aplicado (%)', v_lote
      USING ERRCODE = '23505';
  END IF;

  -- ── 3. Recorte ────────────────────────────────────────────────────────────
  -- As CTEs abaixo replicam a elegibilidade de listar_central_autorizacoes
  -- (20260821060000), porém POR SLOT em vez de agrupado por card.
  --
  -- Temp table (mesmo padrão de reconciliar_guias_por_janela) porque o recorte é
  -- lido quatro vezes: contagem de aplicáveis, contagem de ignoradas, UPDATE e
  -- INSERT. Repetir as CTEs em cada um significaria recalcular o pareamento
  -- posicional quatro vezes e, pior, correr o risco de os quatro discordarem.
  --
  -- ON COMMIT DROP some no fim da transação, mas isso não basta aqui: ao
  -- contrário da reconciliação (service_role, uma execução por vez via cron),
  -- esta função é chamada pelo PostgREST sobre um pool de conexões reaproveitadas
  -- — o dry-run roda a cada clique em Salvar. Se uma transação anterior abortar
  -- de um jeito que deixe a temp table para trás, a próxima chamada na mesma
  -- conexão bateria em "relation already exists" e o lote falharia por um motivo
  -- que não tem nada a ver com o lote. O DROP explícito torna a função reentrante.
  --
  -- client_min_messages abaixado só neste bloco: no caminho normal a tabela nunca
  -- existe, e o NOTICE "does not exist, skipping" apareceria em toda chamada —
  -- inclusive a cada dry-run. Ruído recorrente no log é como um aviso real passa
  -- despercebido.
  SET LOCAL client_min_messages = warning;
  DROP TABLE IF EXISTS _lote_slots;
  RESET client_min_messages;

  CREATE TEMP TABLE _lote_slots ON COMMIT DROP AS
  WITH
  usuario_atual AS (
    -- Subquery escalar garante 1 linha mesmo quando auth.uid() não bate; um
    -- SELECT com WHERE devolveria 0 linhas e o CROSS JOIN zeraria tudo.
    SELECT (SELECT unidades FROM public.usuarios WHERE id = v_uid) AS unidades
  ),

  -- fallback_pat — copiado literal da RPC de leitura.
  -- Sem ele as faltas criadas nascem sem matricula/empresa/dep, e
  -- ma_consumos_falta (que casa por matricula+dep+codigo_tuss) não as enxerga:
  -- a falta deixa de contar como consumo na Auditoria, em silêncio.
  fallback_pat AS (
    SELECT
      p.paciente_id,
      ag.cpf,
      ag.data_nascimento,
      ag.convenio_id,
      ag.convenio_nome,
      ag.numero_carteirinha,
      substring(ag.numero_carteirinha, 1, 6)                          AS empresa,
      substring(ag.numero_carteirinha, 7, 7)                          AS matricula,
      right(regexp_replace(ag.numero_carteirinha, '\D', '', 'g'), 2)  AS dep
    FROM (
      SELECT DISTINCT paciente_id
      FROM   public.agenda_tita_autorizacao
      WHERE  data_atendimento = p_data
        AND  (cpf IS NULL OR numero_carteirinha IS NULL OR convenio_id IS NULL)
    ) p
    CROSS JOIN LATERAL (
      SELECT cpf, data_nascimento, convenio_id, convenio_nome, numero_carteirinha
      FROM   public.agenda_tita
      WHERE  paciente_id = p.paciente_id
        AND  (cpf IS NOT NULL OR numero_carteirinha IS NOT NULL)
      ORDER BY
        (origem = 'grade')                                      DESC,
        (cpf IS NOT NULL AND numero_carteirinha IS NOT NULL)    DESC,
        updated_at                                              DESC
      LIMIT 1
    ) ag
  ),

  raw_slots AS (
    SELECT
      ag.paciente_id,
      ag.paciente_nome,
      ag.data_atendimento,
      ag.hora_inicial,
      ag.terapia_nome,
      ag.terapia_exibicao_id,
      ag.sala_nome,
      ag.codigo_tuss,
      ag.tita_agendamento_id,
      COALESCE(ag.convenio_nome, fp.convenio_nome) AS convenio_nome,
      COALESCE(ag.empresa,       fp.empresa)       AS empresa,
      COALESCE(ag.matricula,     fp.matricula)     AS matricula,
      COALESCE(ag.dep,           fp.dep)           AS dep,
      ag.crm,
      ag.nome_medico
    FROM public.agenda_tita_autorizacao ag
    LEFT JOIN fallback_pat fp ON fp.paciente_id = ag.paciente_id
    CROSS JOIN usuario_atual ua
    WHERE ag.data_atendimento = p_data
      -- Blacklist de terapias — literal da RPC de leitura. lower() exato, COM acento.
      AND lower(COALESCE(ag.terapia_nome, '')) <> ALL (ARRAY[
            'aplicador aba escola'::text, 'aplicador aba casa'::text,
            'aplicador suporte'::text, 'apoio operacional'::text,
            'especialista técnico de área'::text, 'estágio'::text,
            'facilitador técnico'::text, 'operações clínicas'::text,
            'supervisão aba'::text, 'técnico terapêutico particular'::text,
            'triagem'::text])
      AND lower(COALESCE(ag.paciente_nome, '')) <> 'horário bloqueado'::text
      AND lower(COALESCE(ag.sala_nome,     '')) NOT LIKE '%sala teste%'::text
      -- TERAPIAS_OCULTAS — espelha frontend/app/(dashboard)/solicitar/page.tsx
      -- (const TERAPIAS_OCULTAS). Lista SEPARADA da blacklist acima, elas não se
      -- sobrepõem. Estas terapias não aparecem na Central de Atendimentos, e
      -- lançar falta no que a recepção não vê seria surpresa pura.
      -- ⚠️ Duplicada em dois lugares: ao mexer numa, mexa na outra.
      AND lower(COALESCE(ag.terapia_nome, '')) <> ALL (ARRAY[
            'equoterapia'::text,
            'fisioterapia aquática'::text,
            'fisioterapia aquatica'::text])
      -- Isolamento por unidade — literal da RPC de leitura. NÃO REMOVER:
      -- a função é DEFINER, então este bloco é a única coisa entre uma
      -- recepcionista e o dia inteiro de outra unidade.
      AND (
        ua.unidades IS NULL
        OR cardinality(ua.unidades) = 0
        OR EXISTS (
          SELECT 1 FROM unnest(ua.unidades) un
          WHERE ag.sala_nome ILIKE '%' || un || '%'
        )
      )
      -- Filtros do lote. NULL = "todos", vindo das opções "Todas as unidades" /
      -- "Todos os horários" / "Todos os convênios" do modal.
      AND (p_horario       IS NULL OR ag.hora_inicial = p_horario)
      AND (p_unidade       IS NULL OR ag.sala_nome ILIKE '%' || p_unidade || '%')
      AND (p_convenio_nome IS NULL OR COALESCE(ag.convenio_nome, fp.convenio_nome) = p_convenio_nome)
  ),

  -- ma_blocos / ma_auths / ma_matches_* — pareamento posicional guia↔sessão,
  -- literal da RPC de leitura. Uma sessão já casada com guia da ASSIM está
  -- autorizada por fora e não pode virar falta.
  ma_blocos AS (
    SELECT
      rs.paciente_id,
      rs.data_atendimento,
      rs.hora_inicial,
      rs.codigo_tuss,
      rs.matricula,
      rs.dep,
      row_number() OVER (
        PARTITION BY rs.matricula, rs.dep, rs.data_atendimento, rs.codigo_tuss
        ORDER BY rs.hora_inicial
      ) AS ordem_consumo
    FROM raw_slots rs
    GROUP BY
      rs.paciente_id, rs.data_atendimento, rs.hora_inicial,
      rs.codigo_tuss, rs.matricula, rs.dep
  ),

  ma_consumos_falta AS (
    SELECT DISTINCT
      bo.matricula, bo.dep, bo.data_atendimento, bo.codigo_tuss, bo.ordem_consumo
    FROM ma_blocos bo
    JOIN public.fila_autorizacoes fa
      ON  fa.matricula          = bo.matricula
      AND COALESCE(fa.dep, '')  = COALESCE(bo.dep, '')
      AND fa.data_atendimento   = bo.data_atendimento
      AND fa.horario            = bo.hora_inicial
      AND fa.tuss               = bo.codigo_tuss
      AND fa.status             = 'falta'
  ),

  ma_auths AS (
    SELECT
      aa.matricula_limpa                  AS matricula,
      right(aa.matricula, 2)              AS dep,
      aa.codigo_tuss,
      date(aa.data_execucao)              AS data_atendimento,
      row_number() OVER (
        PARTITION BY aa.matricula_limpa, right(aa.matricula, 2),
                     date(aa.data_execucao), aa.codigo_tuss
        ORDER BY aa.data_execucao
      )                                   AS ordem_autorizacao
    FROM public.autorizacoes_assim aa
    WHERE date(aa.data_execucao) = p_data
      AND NOT EXISTS (
        SELECT 1
        FROM public.fila_autorizacoes fa
        WHERE fa.numero_autorizacao = aa.guia
          AND fa.data_atendimento BETWEEN (date(aa.data_execucao) - 7)
                                      AND (date(aa.data_execucao) + 7)
      )
  ),

  match_assim AS (
    SELECT bo.paciente_id, bo.data_atendimento, bo.hora_inicial AS horario, bo.codigo_tuss
    FROM ma_blocos bo
    JOIN ma_auths an
      ON  an.matricula         = bo.matricula
      AND COALESCE(an.dep, '') = COALESCE(bo.dep, '')
      AND an.data_atendimento  = bo.data_atendimento
      AND an.codigo_tuss       = bo.codigo_tuss
      AND an.ordem_autorizacao = bo.ordem_consumo
    UNION
    SELECT bo.paciente_id, bo.data_atendimento, bo.hora_inicial AS horario, bo.codigo_tuss
    FROM ma_blocos bo
    JOIN ma_consumos_falta cf
      ON  cf.matricula         = bo.matricula
      AND COALESCE(cf.dep, '') = COALESCE(bo.dep, '')
      AND cf.data_atendimento  = bo.data_atendimento
      AND cf.codigo_tuss       = bo.codigo_tuss
      AND cf.ordem_consumo     = bo.ordem_consumo
  ),

  -- ultima_fila por (paciente, data, horário) — MESMA granularidade da RPC de
  -- leitura, e não por tuss.
  --
  -- Isto não é escolha de estilo: `unique_fila_agendamento` é
  -- UNIQUE (paciente_id, data_atendimento, horario), sem o tuss. O banco só
  -- admite UMA linha por horário. Uma versão anterior desta função tentou
  -- gravar uma linha por terapia (por parecer mais fiel ao fato de o card
  -- agregar N terapias) e o lote inteiro abortava com 23505 assim que aparecia
  -- um paciente com duas terapias no mesmo horário — que é o caso comum.
  --
  -- A consequência é que a linha de falta representa o HORÁRIO, não a terapia.
  -- É também o que o fluxo individual (handleFalta) sempre fez, então as duas
  -- escritas continuam consistentes entre si.
  ultima_fila AS (
    SELECT DISTINCT ON (paciente_id, data_atendimento, horario)
      id, paciente_id, data_atendimento, horario, tuss, status
    FROM public.fila_autorizacoes
    WHERE data_atendimento = p_data
    ORDER BY paciente_id, data_atendimento, horario, created_at DESC
  ),

  -- Uma linha por (paciente, data, horário) — a granularidade que
  -- `unique_fila_agendamento` permite. As terapias do mesmo horário são
  -- agregadas, como o card da tela já as agrega.
  slots_do_horario AS (
    SELECT
      rs.paciente_id,
      rs.paciente_nome,
      rs.data_atendimento,
      rs.hora_inicial,
      -- ' + ' é o mesmo separador de terapia_falta no fluxo individual
      -- (p.terapias.join(' + ') em handleFalta), para as duas escritas
      -- produzirem o mesmo texto.
      string_agg(DISTINCT rs.terapia_nome, ' + ' ORDER BY rs.terapia_nome) AS terapia_nome,
      -- Primeiro tuss do horário, como o fluxo individual (codigos_tuss[0]).
      (array_agg(rs.codigo_tuss ORDER BY rs.codigo_tuss))[1]          AS codigo_tuss,
      (array_agg(rs.terapia_exibicao_id ORDER BY rs.codigo_tuss))[1]  AS terapia_exibicao_id,
      min(rs.tita_agendamento_id)                                     AS tita_agendamento_id,
      min(rs.empresa)   AS empresa,
      min(rs.matricula) AS matricula,
      min(rs.dep)       AS dep,
      min(rs.crm)       AS crm,
      min(rs.nome_medico) AS nome_medico,
      -- Se QUALQUER terapia do horário já tem guia da ASSIM, o horário inteiro
      -- está autorizado por fora: como só há uma linha por horário, marcar falta
      -- aqui contradiria a guia emitida.
      bool_or(ma.paciente_id IS NOT NULL) AS tem_guia_assim
    FROM raw_slots rs
    LEFT JOIN match_assim ma
      ON  ma.paciente_id      = rs.paciente_id
      AND ma.data_atendimento = rs.data_atendimento
      AND ma.horario          = rs.hora_inicial
      AND ma.codigo_tuss      = rs.codigo_tuss
    GROUP BY rs.paciente_id, rs.paciente_nome, rs.data_atendimento, rs.hora_inicial
  )

  SELECT
    s.paciente_id,
    s.paciente_nome,
    s.data_atendimento,
    s.hora_inicial,
    s.terapia_nome,
    s.terapia_exibicao_id,
    s.codigo_tuss,
    s.tita_agendamento_id,
    s.empresa,
    s.matricula,
    s.dep,
    s.crm,
    s.nome_medico,
    uf.id     AS fila_id,
    uf.status AS fila_status,
    CASE
      -- Guia da ASSIM já pareada: autorizada por fora.
      WHEN s.tem_guia_assim                          THEN 'autorizado_externo'
      WHEN uf.status = 'falta'                       THEN 'falta'
      WHEN uf.status = 'concluido'                   THEN 'concluido'
      WHEN uf.status = 'concluido_sem_guia'          THEN 'concluido_sem_guia'
      WHEN uf.status = 'glosa'                       THEN 'glosa'
      -- Corrida ativa: o robô está com a janela aberta na ASSIM neste instante.
      -- Sobrescrever aqui divergiria portal × banco — a guia sai lá e o Pulsar
      -- diz falta. Fica de fora e é reportado.
      WHEN uf.status IN ('processando','executando') THEN 'em_processamento'
      ELSE NULL   -- elegível: sem linha, ou pendente / cancelado / erro
    END AS motivo_ignorada
  FROM slots_do_horario s
  LEFT JOIN ultima_fila uf
    ON  uf.paciente_id::bigint = s.paciente_id
    AND uf.data_atendimento    = s.data_atendimento
    AND uf.horario             = s.hora_inicial;

  -- ── 4. Contagens ──────────────────────────────────────────────────────────
  SELECT count(*) FILTER (WHERE motivo_ignorada IS NULL)
    INTO v_aplicaveis
  FROM _lote_slots;

  SELECT
    COALESCE(jsonb_object_agg(motivo_ignorada, n), '{}'::jsonb),
    COALESCE(sum(n), 0)
  INTO v_ignoradas, v_total_ign
  FROM (
    SELECT motivo_ignorada, count(*)::int AS n
    FROM _lote_slots
    WHERE motivo_ignorada IS NOT NULL
    GROUP BY motivo_ignorada
  ) q;

  -- ── 5. Dry-run: sai antes de escrever ─────────────────────────────────────
  -- É o que alimenta a confirmação da tela: o browser não
  -- consegue contar as ignoradas sozinho porque listaDia só recebe cards com
  -- mostrar_na_tela = true — as já autorizadas nunca chegam lá.
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'lote_id',              v_lote,
      'dry_run',              true,
      'aplicadas',            v_aplicaveis,
      'atualizadas',          (SELECT count(*) FROM _lote_slots WHERE motivo_ignorada IS NULL AND fila_id IS NOT NULL),
      'criadas',              (SELECT count(*) FROM _lote_slots WHERE motivo_ignorada IS NULL AND fila_id IS NULL),
      'ignoradas',            v_total_ign,
      'ignoradas_por_motivo', v_ignoradas
    );
  END IF;

  -- ── 6. Escrita ────────────────────────────────────────────────────────────
  -- UPDATE nas que já têm linha.
  UPDATE public.fila_autorizacoes f
     SET status              = 'falta',
         tipo_falta          = p_tipo_falta,
         motivo_falta        = p_motivo,
         justificativa_falta = p_justificativa,
         terapia_falta       = s.terapia_nome,
         falta_lote_id       = v_lote,
         criado_por          = v_nome
    FROM _lote_slots s
   WHERE f.id = s.fila_id
     AND s.motivo_ignorada IS NULL;
  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;

  -- INSERT só onde NÃO havia linha (fila_id IS NULL). Inserir onde já existe
  -- criaria uma linha mais recente que passaria a mandar no DISTINCT ON
  -- created_at DESC, tornando a antiga invisível sem tê-la corrigido.
  --
  -- Sem cpf/data_nascimento/convenio_nome: essas colunas NÃO existem em
  -- fila_autorizacoes (verificado contra produção). É por isso que
  -- criarAutorizacao tem o fallback semDadosPacienteComplementares.
  --
  -- machine_id = 'WEB' é inatingível pelo robô por dois motivos independentes:
  -- robo_buscar_tarefa exige status='pendente' E um machine_id registrado em
  -- maquinas, e nenhuma máquina tem id 'WEB'. Redundância desejável — mesmo que
  -- alguém reverta a falta para pendente por engano, o 'WEB' segura.
  --
  -- horario_autorizacao fica NULL de propósito: falta não é autorização, e a
  -- coluna guarda wall time de São Paulo enquanto o resto da tabela é UTC.
  INSERT INTO public.fila_autorizacoes (
    paciente_id, paciente_nome, data_atendimento, horario,
    terapia_nome, terapia_exibicao_id, tuss, tuss1, tita_agendamento_id,
    empresa, matricula, dep, crm, nome_medico,
    status, tipo_falta, motivo_falta, justificativa_falta, terapia_falta,
    falta_lote_id, criado_por, usuario_id, machine_id
  )
  SELECT
    s.paciente_id::text, s.paciente_nome, s.data_atendimento, s.hora_inicial,
    s.terapia_nome, s.terapia_exibicao_id, s.codigo_tuss, s.codigo_tuss,
    s.tita_agendamento_id,
    s.empresa, s.matricula, s.dep, s.crm, s.nome_medico,
    'falta', p_tipo_falta, p_motivo, p_justificativa, s.terapia_nome,
    v_lote, v_nome, v_uid::text, 'WEB'
  FROM _lote_slots s
  WHERE s.motivo_ignorada IS NULL
    AND s.fila_id IS NULL;
  GET DIAGNOSTICS v_criadas = ROW_COUNT;

  RETURN jsonb_build_object(
    'lote_id',              v_lote,
    'dry_run',              false,
    'aplicadas',            v_atualizadas + v_criadas,
    'atualizadas',          v_atualizadas,
    'criadas',              v_criadas,
    'ignoradas',            v_total_ign,
    'ignoradas_por_motivo', v_ignoradas
  );
END;
$function$;

COMMENT ON FUNCTION public.registrar_falta_em_lote(date,text,text,text,text,time without time zone,text,boolean,uuid) IS
  'Lança falta em todas as sessões elegíveis de uma data, opcionalmente recortada '
  'por unidade / horário / convênio (NULL = todas). Pula o que já está autorizado, '
  'concluído, glosado, em falta ou em processamento, e devolve a contagem do que '
  'pulou e por quê. Com p_dry_run = true não escreve nada — é assim que a tela '
  'monta a confirmação. Escreve uma linha por slot (paciente, data, horário, tuss).';

-- ═══════════════════════════════════════════════════════════════════════════
-- reverter_falta_em_lote
-- ═══════════════════════════════════════════════════════════════════════════
-- Uma ação que escreve centenas de linhas precisa ser desfazível como unidade.
--
-- Volta para 'cancelado', não 'pendente': parte das linhas do lote foi CRIADA
-- por ele, e devolvê-las a 'pendente' não restaura o estado anterior — viram
-- solicitações que o robô vai pegar. 'cancelado' tem mostrar_na_tela = true em
-- listar_central_autorizacoes, então a sessão reaparece na /solicitar e a
-- recepção age normalmente. Um estado só, sem precisar inferir quais linhas
-- foram INSERT e quais foram UPDATE.
CREATE OR REPLACE FUNCTION public.reverter_falta_em_lote(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_nome       text;
  v_revertidas integer := 0;
  v_total      integer := 0;
BEGIN
  SELECT u.nome INTO v_nome
  FROM public.usuarios u
  WHERE u.id = v_uid
    AND u.ativo
    AND u.role IN ('recepcao', 'autorizacao', 'admin', 'diretoria');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sem permissão para reverter falta em lote'
      USING ERRCODE = '42501';
  END IF;

  IF p_lote_id IS NULL THEN
    RAISE EXCEPTION 'Lote é obrigatório' USING ERRCODE = '22004';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.fila_autorizacoes
  WHERE falta_lote_id = p_lote_id;

  -- `status = 'falta'` é essencial: se alguém já corrigiu uma linha à mão
  -- depois do lote, a reversão em massa não pode atropelar essa correção.
  UPDATE public.fila_autorizacoes
     SET status                   = 'cancelado',
         tipo_falta               = NULL,
         motivo_falta             = NULL,
         justificativa_falta      = NULL,
         terapia_falta            = NULL,
         falta_revertida_por_nome = v_nome,
         falta_revertida_em       = now(),
         falta_lote_id            = NULL
   WHERE falta_lote_id = p_lote_id
     AND status = 'falta';
  GET DIAGNOSTICS v_revertidas = ROW_COUNT;

  RETURN jsonb_build_object(
    'lote_id',    p_lote_id,
    'revertidas', v_revertidas,
    'ignoradas',  v_total - v_revertidas
  );
END;
$function$;

COMMENT ON FUNCTION public.reverter_falta_em_lote(uuid) IS
  'Desfaz um lançamento de registrar_falta_em_lote inteiro pelo falta_lote_id. '
  'Volta as linhas para cancelado (não pendente: parte delas foi criada pelo lote '
  'e viraria tarefa para o robô). Só toca em linhas ainda com status falta, para '
  'não atropelar correção feita à mão depois.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants
-- ═══════════════════════════════════════════════════════════════════════════
-- authenticated apenas: o gate de papel dentro das funções decide o resto.
-- anon nunca — são funções DEFINER que escrevem.
REVOKE ALL ON FUNCTION public.registrar_falta_em_lote(date,text,text,text,text,time without time zone,text,boolean,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverter_falta_em_lote(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.registrar_falta_em_lote(date,text,text,text,text,time without time zone,text,boolean,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_falta_em_lote(uuid) TO authenticated;
