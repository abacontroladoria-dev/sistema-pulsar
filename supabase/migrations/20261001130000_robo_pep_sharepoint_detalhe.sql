-- Robô SharePoint → PEP: "O que o robô leu", execução por execução.
--
-- Pedido do usuário (30/09/2026, depois da 1ª execução real): os cards da
-- linha do tempo dizem "91 arquivos", "5 planilhas", "62 pacientes" — quais?
-- Até aqui o banco só guardava as EVIDÊNCIAS (sp_pep_itens) e a planilha
-- escolhida de cada prestador; planilhas preteridas e arquivos ignorados
-- (pastas 6/7, soltos) sumiam depois da contagem.
--
-- 1. sp_pep_execucao_arquivos: uma linha por arquivo lido EM CADA execução —
--    inclusive planilha e ignorado — com o detalhe da planilha (sem CPF: só o
--    nome do paciente e se o dígito verificador bateu). Gravado FORA do bloco
--    de simulação, então o inventário também deixa o que leu à vista.
--    Guarda 180 dias.
-- 2. robo_pep_registrar_lote passa a aceitar planilha/ignorado em p_arquivos:
--    só evidência e fora do padrão viram sugestão (sp_pep_itens), como antes.
-- 3. Duas leituras agregadas (jsonb numa linha só: o PostgREST corta lista
--    em 1000 linhas sem avisar): sp_pep_resumo_execucao e
--    sp_pep_situacao_reconhecimento.
--
-- ORDEM: aplicar ANTES do redeploy do robô. O robô novo manda tipo 'planilha'
-- e 'ignorado'; o banco antigo os tentaria gravar como sugestão e recusaria.
-- O robô antigo continua funcionando com este banco.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Registro por execução
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.sp_pep_execucao_arquivos (
  execucao_id         uuid        NOT NULL REFERENCES public.sp_pep_execucoes(id) ON DELETE CASCADE,
  sp_id               text        NOT NULL,
  nome                text        NOT NULL,
  caminho             text,
  web_url             text,
  tipo                text        NOT NULL CHECK (tipo IN ('evidencia', 'planilha', 'ignorado', 'fora_padrao', 'removido')),
  motivo              text,
  sigla               text,
  prestador_pasta_id  text,
  paciente_pasta_id   text,
  tamanho             bigint,
  criado_em_sp        timestamptz,
  modificado_em_sp    timestamptz,
  criado_por          text,
  competencia         text,
  -- Planilha: {usada, ilegivel, razao_social, cnpj_valido, pacientes:[{nome, cpfValido}],
  --            planejamento_linhas, avisos} ou {usada:false, motivo}
  detalhe             jsonb,
  PRIMARY KEY (execucao_id, sp_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_exec_arquivos_tipo
  ON public.sp_pep_execucao_arquivos (execucao_id, tipo);
CREATE INDEX IF NOT EXISTS idx_sp_pep_exec_arquivos_prestador
  ON public.sp_pep_execucao_arquivos (execucao_id, prestador_pasta_id);

ALTER TABLE public.sp_pep_execucao_arquivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sp_pep_execucao_arquivos_select ON public.sp_pep_execucao_arquivos;
CREATE POLICY sp_pep_execucao_arquivos_select ON public.sp_pep_execucao_arquivos
  FOR SELECT TO authenticated USING (public.usuario_tem_permissao('robo_sharepoint'));

REVOKE ALL ON public.sp_pep_execucao_arquivos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sp_pep_execucao_arquivos FROM authenticated;
GRANT SELECT ON public.sp_pep_execucao_arquivos TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Lote: aceita tudo o que foi lido, registra, e só as evidências viram sugestão
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.robo_pep_registrar_lote(
  p_token               text,
  p_execucao_id         uuid,
  p_drive_id            text,
  p_delta_link          text,
  p_completo            boolean,
  p_final               boolean,
  p_pastas              jsonb,
  p_pastas_removidas    jsonb,
  p_arquivos            jsonb,
  p_arquivos_removidos  jsonb,
  p_planilhas           jsonb,
  p_simular             boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_maquina   text := public.robo_autenticar(p_token);
  v_t0        timestamptz := clock_timestamp();
  v_exec      sp_pep_execucoes%ROWTYPE;
  v_novos     integer := 0;
  v_removidos integer := 0;
  v_resumo    jsonb;
  v_resultado jsonb;
BEGIN
  SELECT * INTO v_exec FROM sp_pep_execucoes WHERE id = p_execucao_id AND maquina_id = v_maquina;
  IF NOT FOUND OR v_exec.status <> 'executando' THEN
    RAISE EXCEPTION 'execucao inexistente ou encerrada' USING ERRCODE = '22023';
  END IF;

  BEGIN
    -- ── Pastas ──────────────────────────────────────────────────────────────
    INSERT INTO sp_pep_pastas (id, nome, pai_id, papel, prestador_pasta_id, ultima_execucao_id, atualizado_em)
    SELECT x.id, x.nome, x.pai_id, x.papel, x.prestador_pasta_id, p_execucao_id, now()
      FROM jsonb_to_recordset(COALESCE(p_pastas, '[]'::jsonb))
           AS x(id text, nome text, pai_id text, papel text, prestador_pasta_id text)
    ON CONFLICT (id) DO UPDATE
       SET nome = EXCLUDED.nome, pai_id = EXCLUDED.pai_id, papel = EXCLUDED.papel,
           prestador_pasta_id = EXCLUDED.prestador_pasta_id,
           ultima_execucao_id = EXCLUDED.ultima_execucao_id, atualizado_em = now();

    DELETE FROM sp_pep_pastas
     WHERE id IN (SELECT jsonb_array_elements_text(COALESCE(p_pastas_removidas, '[]'::jsonb)));

    -- ── Planilhas ───────────────────────────────────────────────────────────
    INSERT INTO sp_pep_prestadores (
      pasta_id, planilha_sp_id, planilha_nome, planilha_web_url, planilha_modificada_em,
      razao_social_planilha, cnpj, cnpj_informado, pacientes, planejamento, avisos, atualizado_em)
    SELECT x.prestador_pasta_id, x.sp_id, x.nome, x.web_url, x.modificado_em,
           x.razao_social, x.cnpj, COALESCE(x.cnpj_informado, false),
           COALESCE(x.pacientes, '[]'::jsonb), COALESCE(x.planejamento, '[]'::jsonb),
           COALESCE(ARRAY(SELECT jsonb_array_elements_text(x.avisos)), '{}'), now()
      FROM jsonb_to_recordset(COALESCE(p_planilhas, '[]'::jsonb)) AS x(
             prestador_pasta_id text, sp_id text, nome text, web_url text, modificado_em timestamptz,
             razao_social text, cnpj text, cnpj_informado boolean, pacientes jsonb, planejamento jsonb, avisos jsonb)
     WHERE x.prestador_pasta_id IS NOT NULL
    ON CONFLICT (pasta_id) DO UPDATE
       SET planilha_sp_id = EXCLUDED.planilha_sp_id, planilha_nome = EXCLUDED.planilha_nome,
           planilha_web_url = EXCLUDED.planilha_web_url, planilha_modificada_em = EXCLUDED.planilha_modificada_em,
           razao_social_planilha = EXCLUDED.razao_social_planilha, cnpj = EXCLUDED.cnpj,
           cnpj_informado = EXCLUDED.cnpj_informado, pacientes = EXCLUDED.pacientes,
           planejamento = EXCLUDED.planejamento, avisos = EXCLUDED.avisos, atualizado_em = now();

    -- ── Arquivos → sugestões (só evidência e fora do padrão) ────────────────
    WITH entrada AS (
      SELECT * FROM jsonb_to_recordset(COALESCE(p_arquivos, '[]'::jsonb)) AS x(
        sp_id text, nome text, caminho text, web_url text, tamanho bigint, e_tag text,
        criado_em timestamptz, modificado_em timestamptz, criado_por text, modificado_por text,
        tipo text, motivo text, prestador_pasta_id text, paciente_pasta_id text, sigla text,
        competencia text, competencia_fonte text)
       WHERE x.tipo IN ('evidencia', 'fora_padrao')
    ), gravados AS (
      INSERT INTO sp_pep_itens AS i (
        sp_id, nome, caminho, web_url, tamanho, e_tag, criado_em_sp, modificado_em_sp, criado_por, modificado_por,
        tipo, motivo_classificacao, prestador_pasta_id, paciente_pasta_id, sigla, competencia, competencia_fonte,
        primeira_execucao_id, ultima_execucao_id)
      SELECT sp_id, left(nome, 400), caminho, web_url, tamanho, e_tag, criado_em, modificado_em,
             left(criado_por, 200), left(modificado_por, 200), tipo, motivo, prestador_pasta_id, paciente_pasta_id,
             sigla, competencia, competencia_fonte, p_execucao_id, p_execucao_id
        FROM entrada
      ON CONFLICT (sp_id) DO UPDATE
         SET nome = EXCLUDED.nome, caminho = EXCLUDED.caminho, web_url = EXCLUDED.web_url,
             tamanho = EXCLUDED.tamanho, e_tag = EXCLUDED.e_tag, modificado_em_sp = EXCLUDED.modificado_em_sp,
             modificado_por = EXCLUDED.modificado_por, tipo = EXCLUDED.tipo,
             motivo_classificacao = EXCLUDED.motivo_classificacao,
             prestador_pasta_id = EXCLUDED.prestador_pasta_id, paciente_pasta_id = EXCLUDED.paciente_pasta_id,
             sigla = EXCLUDED.sigla,
             competencia = CASE WHEN i.status IN ('confirmado', 'ignorado') THEN i.competencia ELSE EXCLUDED.competencia END,
             competencia_fonte = CASE WHEN i.status IN ('confirmado', 'ignorado') THEN i.competencia_fonte ELSE EXCLUDED.competencia_fonte END,
             status = CASE WHEN i.status = 'removido' THEN 'nao_reconhecido' ELSE i.status END,
             removido_em = NULL,
             ultima_execucao_id = EXCLUDED.ultima_execucao_id,
             atualizado_em = now()
      RETURNING (xmax = 0) AS novo
    )
    SELECT count(*) FILTER (WHERE novo) INTO v_novos FROM gravados;

    -- ── Removidos ───────────────────────────────────────────────────────────
    WITH alvo AS (
      SELECT sp_id FROM sp_pep_itens
       WHERE sp_id IN (SELECT jsonb_array_elements_text(COALESCE(p_arquivos_removidos, '[]'::jsonb)))
      UNION
      SELECT sp_id FROM sp_pep_itens
       WHERE p_final AND p_completo
         AND ultima_execucao_id IS DISTINCT FROM p_execucao_id
         AND (v_exec.escopo_pasta_id IS NULL OR prestador_pasta_id = v_exec.escopo_pasta_id)
    ), marcados AS (
      UPDATE sp_pep_itens i
         SET status = CASE WHEN i.status IN ('sugerido', 'nao_reconhecido') THEN 'removido' ELSE i.status END,
             removido_em = now(), atualizado_em = now()
        FROM alvo
       WHERE i.sp_id = alvo.sp_id AND i.removido_em IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_removidos FROM marcados;

    IF p_final AND p_completo AND v_exec.modo = 'producao' THEN
      DELETE FROM sp_pep_pastas WHERE ultima_execucao_id IS DISTINCT FROM p_execucao_id;
    END IF;

    -- ── Reconhecimento (só na última parte) ─────────────────────────────────
    IF p_final THEN
      v_resumo := public.sp_pep_reavaliar();
    ELSE
      v_resumo := '{}'::jsonb;
    END IF;

    v_resultado := v_resumo || jsonb_build_object(
      'novos', v_novos,
      'removidos', v_removidos,
      'simulado', p_simular,
      'ms_banco', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000));

    IF p_simular THEN
      RAISE EXCEPTION USING ERRCODE = 'PSIM1', MESSAGE = v_resultado::text;
    END IF;
  EXCEPTION WHEN SQLSTATE 'PSIM1' THEN
    v_resultado := SQLERRM::jsonb;
  END;

  -- ── Registro do que foi lido (fora do bloco: vale também na simulação) ────
  INSERT INTO sp_pep_execucao_arquivos (
    execucao_id, sp_id, nome, caminho, web_url, tipo, motivo, sigla, prestador_pasta_id, paciente_pasta_id,
    tamanho, criado_em_sp, modificado_em_sp, criado_por, competencia, detalhe)
  SELECT p_execucao_id, x.sp_id, left(x.nome, 400), x.caminho, x.web_url, x.tipo, x.motivo, x.sigla,
         x.prestador_pasta_id, x.paciente_pasta_id, x.tamanho, x.criado_em, x.modificado_em,
         left(x.criado_por, 200), x.competencia, x.detalhe
    FROM jsonb_to_recordset(COALESCE(p_arquivos, '[]'::jsonb)) AS x(
           sp_id text, nome text, caminho text, web_url text, tamanho bigint,
           criado_em timestamptz, modificado_em timestamptz, criado_por text,
           tipo text, motivo text, prestador_pasta_id text, paciente_pasta_id text, sigla text,
           competencia text, detalhe jsonb)
   WHERE x.sp_id IS NOT NULL
     AND x.tipo IN ('evidencia', 'planilha', 'ignorado', 'fora_padrao')
  ON CONFLICT (execucao_id, sp_id) DO NOTHING;

  -- Apagados no SharePoint nesta leitura (só os que o banco conhecia pelo nome).
  INSERT INTO sp_pep_execucao_arquivos (
    execucao_id, sp_id, nome, caminho, web_url, tipo, sigla, prestador_pasta_id, paciente_pasta_id, competencia)
  SELECT p_execucao_id, i.sp_id, i.nome, i.caminho, i.web_url, 'removido', i.sigla,
         i.prestador_pasta_id, i.paciente_pasta_id, i.competencia
    FROM sp_pep_itens i
   WHERE i.sp_id IN (SELECT jsonb_array_elements_text(COALESCE(p_arquivos_removidos, '[]'::jsonb)))
  ON CONFLICT (execucao_id, sp_id) DO NOTHING;

  IF p_final AND NOT p_simular AND v_exec.modo = 'producao' THEN
    INSERT INTO sp_pep_estado (id, drive_id, delta_link, ultima_leitura_completa_em, atualizado_em)
    VALUES (1, p_drive_id, p_delta_link, CASE WHEN p_completo THEN now() END, now())
    ON CONFLICT (id) DO UPDATE
       SET drive_id = EXCLUDED.drive_id,
           delta_link = COALESCE(EXCLUDED.delta_link, sp_pep_estado.delta_link),
           ultima_leitura_completa_em = COALESCE(EXCLUDED.ultima_leitura_completa_em, sp_pep_estado.ultima_leitura_completa_em),
           atualizado_em = now();
  END IF;

  -- Guarda 180 dias de registro por arquivo (a execução em si fica).
  IF p_final THEN
    DELETE FROM sp_pep_execucao_arquivos a
     USING sp_pep_execucoes e
     WHERE a.execucao_id = e.id AND e.iniciado_em < now() - interval '180 days';
  END IF;

  v_resultado := jsonb_set(v_resultado, '{ms_banco}',
                   to_jsonb(round(extract(epoch FROM clock_timestamp() - v_t0) * 1000)));
  UPDATE sp_pep_execucoes SET resumo = v_resultado WHERE id = p_execucao_id;
  RETURN v_resultado;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.robo_pep_registrar_lote(text, uuid, text, text, boolean, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.robo_pep_registrar_lote(text, uuid, text, text, boolean, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) TO anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Leituras do painel (uma linha jsonb cada; permissão conferida dentro)
-- ═════════════════════════════════════════════════════════════════════════════

-- O que UMA execução leu, agregado: por tipo, por item do PEP, motivos dos
-- ignorados e a conta por prestador (arquivos lidos + pastas de paciente +
-- se tem planilha).
CREATE OR REPLACE FUNCTION public.sp_pep_resumo_execucao(p_execucao_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.usuario_tem_permissao('robo_sharepoint') THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;

  WITH a AS (SELECT * FROM sp_pep_execucao_arquivos WHERE execucao_id = p_execucao_id),
  por_prestador AS (
    SELECT pa.id AS pasta_id, pa.nome,
           count(a.sp_id)                                             AS arquivos,
           count(a.sp_id) FILTER (WHERE a.tipo = 'evidencia')         AS evidencias,
           count(a.sp_id) FILTER (WHERE a.tipo = 'planilha')          AS planilhas,
           count(a.sp_id) FILTER (WHERE a.tipo IN ('ignorado', 'fora_padrao')) AS ignorados,
           (SELECT count(*) FROM sp_pep_pastas p2 WHERE p2.papel = 'paciente' AND p2.prestador_pasta_id = pa.id) AS pastas_paciente,
           EXISTS (SELECT 1 FROM sp_pep_prestadores pr WHERE pr.pasta_id = pa.id AND pr.planilha_sp_id IS NOT NULL) AS tem_planilha
      FROM sp_pep_pastas pa
      LEFT JOIN a ON a.prestador_pasta_id = pa.id
     WHERE pa.papel = 'prestador'
     GROUP BY pa.id, pa.nome
  )
  SELECT jsonb_build_object(
    'registrado',   EXISTS (SELECT 1 FROM a),
    'total',        (SELECT count(*) FROM a WHERE tipo <> 'removido'),
    'por_tipo',     COALESCE((SELECT jsonb_object_agg(tipo, n) FROM (SELECT tipo, count(*) n FROM a GROUP BY tipo) t), '{}'::jsonb),
    'por_sigla',    COALESCE((SELECT jsonb_object_agg(sigla, n) FROM (
                      SELECT sigla, count(*) n FROM a WHERE tipo = 'evidencia' AND sigla IS NOT NULL GROUP BY sigla) t), '{}'::jsonb),
    'motivos',      COALESCE((SELECT jsonb_agg(jsonb_build_object('tipo', tipo, 'motivo', motivo, 'n', n) ORDER BY n DESC) FROM (
                      SELECT tipo, COALESCE(motivo, 'sem_motivo') motivo, count(*) n FROM a
                       WHERE tipo IN ('ignorado', 'fora_padrao') GROUP BY tipo, motivo) t), '[]'::jsonb),
    'sem_prestador', (SELECT count(*) FROM a WHERE prestador_pasta_id IS NULL),
    'prestadores',  COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.nome) FROM por_prestador p), '[]'::jsonb),
    'pastas', jsonb_build_object(
      'total',       (SELECT count(*) FROM sp_pep_pastas),
      'prestadores', (SELECT count(*) FROM sp_pep_pastas WHERE papel = 'prestador'),
      'pacientes',   (SELECT count(*) FROM sp_pep_pastas WHERE papel = 'paciente'))
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.sp_pep_resumo_execucao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_resumo_execucao(uuid) TO authenticated;

-- Situação ATUAL do reconhecimento (depois da última execução gravada):
-- prestadores, pastas de paciente, sugestões e os motivos do que ficou preso.
CREATE OR REPLACE FUNCTION public.sp_pep_situacao_reconhecimento()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.usuario_tem_permissao('robo_sharepoint') THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'prestadores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'pasta_id', pr.pasta_id, 'nome_pasta', pa.nome, 'prestador_nome', pr.prestador_nome,
               'status', pr.status, 'motivo', pr.motivo, 'sinais', pr.sinais,
               'planilha_nome', pr.planilha_nome, 'planilha_web_url', pr.planilha_web_url)
             ORDER BY (pr.status = 'reconhecido') DESC, pa.nome)
        FROM sp_pep_prestadores pr JOIN sp_pep_pastas pa ON pa.id = pr.pasta_id), '[]'::jsonb),
    'pacientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'pasta_id', pc.pasta_id, 'prestador_pasta_id', pc.prestador_pasta_id, 'nome_pasta', pa.nome,
               'paciente_nome', pc.paciente_nome, 'status', pc.status, 'motivo', pc.motivo,
               'origem', pc.origem, 'sinais', pc.sinais,
               'arquivos', (SELECT count(*) FROM sp_pep_itens i WHERE i.paciente_pasta_id = pc.pasta_id))
             ORDER BY pa.nome)
        FROM sp_pep_pacientes pc JOIN sp_pep_pastas pa ON pa.id = pc.pasta_id), '[]'::jsonb),
    'sugestoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'sp_id', i.sp_id, 'nome', i.nome, 'web_url', i.web_url, 'sigla', i.sigla,
               'paciente_nome', i.paciente_nome, 'prestador_nome', i.prestador_nome,
               'competencia', i.competencia, 'criado_em_sp', i.criado_em_sp)
             ORDER BY i.prestador_nome, i.paciente_nome, i.sigla)
        FROM (SELECT * FROM sp_pep_itens WHERE status = 'sugerido' ORDER BY criado_em_sp DESC LIMIT 500) i), '[]'::jsonb),
    'itens_por_status', COALESCE((
      SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM sp_pep_itens GROUP BY status) t), '{}'::jsonb),
    'itens_motivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('motivo', motivo, 'n', n) ORDER BY n DESC) FROM (
        SELECT COALESCE(motivo, 'sem_motivo') motivo, count(*) n FROM sp_pep_itens
         WHERE status = 'nao_reconhecido' GROUP BY motivo) t), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.sp_pep_situacao_reconhecimento() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_situacao_reconhecimento() TO authenticated;
