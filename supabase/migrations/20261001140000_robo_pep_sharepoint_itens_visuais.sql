-- Robô SharePoint → PEP: cada número vira a lista dos itens que ele conta.
--
-- Pedido do usuário (30/09/2026): "quais são os 91 arquivos? quais são as
-- 1.769 pastas? quais são as 72 evidências?" — ver item por item, não só a
-- contagem. Este arquivo dá ao painel o que faltava para desenhar isso:
--
-- 1. sp_pep_pastas ganha web_url e criado_em_sp: toda pasta abre no SharePoint.
-- 2. robo_pep_registrar_lote grava esses dois campos (robô 0.3 manda; o antigo
--    não manda e nada quebra).
-- 3. vw_sp_pep_arquivos_lidos: cada arquivo lido + a situação dele no Pulsar
--    (sugerido/não reconhecido/confirmado, motivo, paciente, competência) e se
--    foi visto pela 1ª vez nesta execução.
-- 4. sp_pep_arvore_pastas: os filhos de uma pasta (com nº de arquivos e de
--    subpastas), para o explorador abrir nível por nível.
-- 5. sp_pep_matriz_evidencias: prestador × paciente × item × situação.
-- 6. sp_pep_pacientes_detalhe: planilha × pasta × cadastro, paciente por
--    paciente (sem CPF).
--
-- Tudo em jsonb numa linha (o PostgREST corta lista em 1000 linhas sem
-- avisar) e com a permissão conferida dentro. Só acrescenta; a versão
-- anterior segue funcionando.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Link e data das pastas
-- ═════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.sp_pep_pastas
  ADD COLUMN IF NOT EXISTS web_url      text,
  ADD COLUMN IF NOT EXISTS criado_em_sp timestamptz;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Lote (idêntico ao de 20261001130000, só as pastas levam link e data)
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
    -- web_url/criado_em chegam do robô 0.3; robô antigo não manda e o valor
    -- guardado não é apagado (COALESCE).
    INSERT INTO sp_pep_pastas (id, nome, pai_id, papel, prestador_pasta_id, web_url, criado_em_sp, ultima_execucao_id, atualizado_em)
    SELECT x.id, x.nome, x.pai_id, x.papel, x.prestador_pasta_id, x.web_url, x.criado_em, p_execucao_id, now()
      FROM jsonb_to_recordset(COALESCE(p_pastas, '[]'::jsonb))
           AS x(id text, nome text, pai_id text, papel text, prestador_pasta_id text, web_url text, criado_em timestamptz)
    ON CONFLICT (id) DO UPDATE
       SET nome = EXCLUDED.nome, pai_id = EXCLUDED.pai_id, papel = EXCLUDED.papel,
           prestador_pasta_id = EXCLUDED.prestador_pasta_id,
           web_url = COALESCE(EXCLUDED.web_url, sp_pep_pastas.web_url),
           criado_em_sp = COALESCE(EXCLUDED.criado_em_sp, sp_pep_pastas.criado_em_sp),
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
-- 3. Arquivos lidos + situação no Pulsar
-- ═════════════════════════════════════════════════════════════════════════════
-- security_invoker: quem consulta passa pela RLS das duas tabelas (as duas
-- exigem robo_sharepoint, ou a PEP, no caso de sp_pep_itens).
CREATE OR REPLACE VIEW public.vw_sp_pep_arquivos_lidos
WITH (security_invoker = true) AS
SELECT a.execucao_id, a.sp_id, a.nome, a.caminho, a.web_url, a.tipo, a.motivo, a.sigla,
       a.prestador_pasta_id, a.paciente_pasta_id, a.tamanho, a.criado_em_sp, a.modificado_em_sp,
       a.criado_por, a.competencia, a.detalhe,
       i.status               AS situacao,
       i.motivo               AS motivo_pulsar,
       i.paciente_nome,
       i.prestador_nome,
       i.competencia          AS competencia_pulsar,
       i.sinais,
       i.resolvido_por_nome,
       i.resolvido_em,
       i.criado_em            AS visto_primeiro_em,
       (i.primeira_execucao_id = a.execucao_id) AS novo
  FROM public.sp_pep_execucao_arquivos a
  LEFT JOIN public.sp_pep_itens i ON i.sp_id = a.sp_id;

REVOKE ALL ON public.vw_sp_pep_arquivos_lidos FROM anon;
GRANT SELECT ON public.vw_sp_pep_arquivos_lidos TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Explorador de pastas: os filhos de uma pasta
-- ═════════════════════════════════════════════════════════════════════════════
-- p_pasta_pai NULL = o nível dos prestadores. Para cada filho: nº de subpastas,
-- nº de arquivos desta execução embaixo dele (qualquer profundidade) e os
-- arquivos que estão direto nele. O caminho de cada pasta é montado pelos
-- nomes (é o que o robô grava no arquivo), então funciona também para as
-- execuções que não mandaram o id da pasta de cada arquivo.
CREATE OR REPLACE FUNCTION public.sp_pep_arvore_pastas(p_execucao_id uuid, p_pasta_pai text)
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

  WITH RECURSIVE caminhos AS (
    SELECT p.id, p.nome::text AS caminho
      FROM sp_pep_pastas p
     WHERE p.papel = 'prestador'
    UNION ALL
    SELECT f.id, c.caminho || '/' || f.nome
      FROM sp_pep_pastas f
      JOIN caminhos c ON f.pai_id = c.id
  ),
  filhos AS (
    SELECT f.id, f.nome, f.papel, f.web_url, f.criado_em_sp, c.caminho
      FROM sp_pep_pastas f
      JOIN caminhos c ON c.id = f.id
     WHERE (p_pasta_pai IS NULL AND f.papel = 'prestador')
        OR (p_pasta_pai IS NOT NULL AND f.pai_id = p_pasta_pai)
  ),
  arq AS (
    SELECT sp_id, nome, caminho, web_url, tipo, motivo, sigla, criado_em_sp, criado_por
      FROM sp_pep_execucao_arquivos
     WHERE execucao_id = p_execucao_id AND tipo <> 'removido'
  ),
  pai AS (SELECT caminho FROM caminhos WHERE id = p_pasta_pai)
  SELECT jsonb_build_object(
    'pastas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', f.id, 'nome', f.nome, 'papel', f.papel, 'web_url', f.web_url, 'criado_em_sp', f.criado_em_sp,
               'subpastas', (SELECT count(*) FROM sp_pep_pastas s WHERE s.pai_id = f.id),
               'arquivos', (SELECT count(*) FROM arq WHERE starts_with(arq.caminho, f.caminho || '/')),
               'evidencias', (SELECT count(*) FROM arq WHERE arq.tipo = 'evidencia' AND starts_with(arq.caminho, f.caminho || '/'))
             ) ORDER BY f.nome)
        FROM filhos f), '[]'::jsonb),
    'arquivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'sp_id', arq.sp_id, 'nome', arq.nome, 'web_url', arq.web_url, 'tipo', arq.tipo, 'motivo', arq.motivo,
               'sigla', arq.sigla, 'criado_em_sp', arq.criado_em_sp, 'criado_por', arq.criado_por) ORDER BY arq.nome)
        FROM arq, pai
       WHERE starts_with(arq.caminho, pai.caminho || '/')
         AND position('/' IN substr(arq.caminho, length(pai.caminho) + 2)) = 0), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.sp_pep_arvore_pastas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_arvore_pastas(uuid, text) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Matriz de evidências: prestador × paciente × item × situação
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sp_pep_matriz_evidencias(p_execucao_id uuid)
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
      SELECT jsonb_agg(jsonb_build_object('pasta_id', pa.id, 'nome', pa.nome, 'web_url', pa.web_url,
               'prestador_nome', pr.prestador_nome, 'status', pr.status) ORDER BY pa.nome)
        FROM sp_pep_pastas pa LEFT JOIN sp_pep_prestadores pr ON pr.pasta_id = pa.id
       WHERE pa.papel = 'prestador'), '[]'::jsonb),
    'pacientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pasta_id', pa.id, 'prestador_pasta_id', pa.prestador_pasta_id,
               'nome', pa.nome, 'web_url', pa.web_url, 'paciente_nome', pc.paciente_nome,
               'status', COALESCE(pc.status, 'nao_reconhecido'), 'motivo', pc.motivo) ORDER BY pa.nome)
        FROM sp_pep_pastas pa LEFT JOIN sp_pep_pacientes pc ON pc.pasta_id = pa.id
       WHERE pa.papel = 'paciente'), '[]'::jsonb),
    'celulas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('prestador_pasta_id', t.prestador_pasta_id, 'paciente_pasta_id', t.paciente_pasta_id,
               'sigla', t.sigla, 'situacao', t.situacao, 'n', t.n))
        FROM (
          SELECT a.prestador_pasta_id, a.paciente_pasta_id, a.sigla,
                 COALESCE(i.status, 'nao_reconhecido') AS situacao, count(*) AS n
            FROM sp_pep_execucao_arquivos a
            LEFT JOIN sp_pep_itens i ON i.sp_id = a.sp_id
           WHERE a.execucao_id = p_execucao_id AND a.tipo = 'evidencia'
           GROUP BY 1, 2, 3, 4) t), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.sp_pep_matriz_evidencias(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_matriz_evidencias(uuid) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Pacientes: planilha × pasta × cadastro (sem CPF)
-- ═════════════════════════════════════════════════════════════════════════════
-- Uma linha por paciente da aba "Pacientes" de cada planilha, casada com a
-- pasta de mesmo nome (normalizado) daquele prestador; mais as pastas que não
-- têm linha na planilha (inclusive as dos prestadores sem planilha).
CREATE OR REPLACE FUNCTION public.sp_pep_pacientes_detalhe()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.usuario_tem_permissao('robo_sharepoint') THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;

  WITH planilha AS (
    SELECT pr.pasta_id AS prestador_pasta_id, e.value->>'nome' AS nome,
           COALESCE((e.value->>'cpfValido')::boolean, false) AS cpf_valido,
           COALESCE((e.value->>'cpfInformado')::boolean, false) AS cpf_informado,
           public.normalizar_nome_paciente(e.value->>'nome') AS chave
      FROM sp_pep_prestadores pr, jsonb_array_elements(COALESCE(pr.pacientes, '[]'::jsonb)) e
  ),
  pastas AS (
    SELECT pa.id AS pasta_id, pa.prestador_pasta_id, pa.nome AS nome_pasta, pa.web_url,
           public.normalizar_nome_paciente(pa.nome) AS chave,
           pc.paciente_nome, pc.status, pc.motivo, pc.origem, pc.sinais
      FROM sp_pep_pastas pa LEFT JOIN sp_pep_pacientes pc ON pc.pasta_id = pa.id
     WHERE pa.papel = 'paciente'
  ),
  juntos AS (
    SELECT COALESCE(pl.prestador_pasta_id, ps.prestador_pasta_id) AS prestador_pasta_id,
           COALESCE(pl.nome, ps.nome_pasta) AS nome,
           pl.nome IS NOT NULL AS na_planilha,
           pl.cpf_valido, pl.cpf_informado,
           ps.pasta_id, ps.nome_pasta, ps.web_url,
           ps.paciente_nome, COALESCE(ps.status, 'nao_reconhecido') AS status,
           CASE WHEN ps.pasta_id IS NULL THEN 'sem_pasta_no_sharepoint' ELSE ps.motivo END AS motivo,
           ps.origem, ps.sinais
      FROM planilha pl
      FULL JOIN pastas ps ON ps.prestador_pasta_id = pl.prestador_pasta_id AND ps.chave = pl.chave
  )
  SELECT jsonb_build_object(
    'pacientes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'prestador_pasta_id', j.prestador_pasta_id,
               'prestador_nome_pasta', pp.nome,
               'nome', j.nome, 'na_planilha', j.na_planilha, 'cpf_valido', j.cpf_valido, 'cpf_informado', j.cpf_informado,
               'pasta_id', j.pasta_id, 'nome_pasta', j.nome_pasta, 'web_url', j.web_url,
               'paciente_nome', j.paciente_nome, 'status', j.status, 'motivo', j.motivo, 'origem', j.origem, 'sinais', j.sinais,
               'arquivos_por_sigla', COALESCE((
                 SELECT jsonb_object_agg(s.sigla, s.n) FROM (
                   SELECT i.sigla, count(*) n FROM sp_pep_itens i
                    WHERE i.paciente_pasta_id = j.pasta_id AND i.status <> 'removido' AND i.sigla IS NOT NULL
                    GROUP BY i.sigla) s), '{}'::jsonb),
               'planejamento', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('sigla', l->>'sigla', 'competencia', l->>'competencia'))
                   FROM sp_pep_prestadores pr2, jsonb_array_elements(COALESCE(pr2.planejamento, '[]'::jsonb)) l
                  WHERE pr2.pasta_id = j.prestador_pasta_id
                    AND public.normalizar_nome_paciente(l->>'paciente') = public.normalizar_nome_paciente(j.nome)), '[]'::jsonb)
             ) ORDER BY pp.nome, j.nome)
        FROM juntos j LEFT JOIN sp_pep_pastas pp ON pp.id = j.prestador_pasta_id), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.sp_pep_pacientes_detalhe() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_pacientes_detalhe() TO authenticated;
