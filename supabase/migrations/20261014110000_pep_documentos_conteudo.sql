-- ═════════════════════════════════════════════════════════════════════════════
-- PEP — conferência do CONTEÚDO das evidências (14/10/2026)
-- ═════════════════════════════════════════════════════════════════════════════
-- Até aqui o robô SharePoint só lia nome e pasta de cada arquivo. A partir do
-- robô 0.5.0, ele baixa cada evidência nova ou alterada, tira o texto (.docx
-- e .pdf) e manda para cá. O Pulsar (Next, com a service_role) analisa e
-- grava três indicações por documento, decididas pelo usuário:
--
--   bom · pode_conter_erros · errado   (+ ilegivel = "Não foi possível ler")
--
-- É INDICAÇÃO, não desconto: nada aqui toca em pep_registros_entrega nem na
-- apuração.
--
-- PROTEÇÃO DO TEXTO (dado clínico):
--   • sp_pep_documentos_texto: RLS ligada e NENHUMA policy; anon e
--     authenticated sem privilégio algum. Só o robô escreve (RPC com token da
--     máquina) e só o servidor do Pulsar lê (service_role), depois de conferir
--     a permissão de quem pediu (rota /api/relacionamento-prestador/pep/…).
--   • O texto expira em 90 dias (decisão de 14/10/2026); fica a impressão
--     digital (assinatura) e os achados com trechos curtos.
--   • sp_pep_documentos e sp_pep_documentos_semelhancas (achados, trechos
--     curtos, nunca o texto inteiro): leitura com a mesma permissão de
--     sp_pep_itens (robo_sharepoint OU relacionamento_prestador_pep).
--
-- Também: o tique do worker da auditoria de evoluções (pg_cron, a cada
-- minuto) passa a acordar o Pulsar quando há documento esperando análise —
-- a rota do tique processa os dois. Sem a config do worker ligada, a tela
-- PEP analisa os documentos do analista aberto ao abrir.
--
-- Idempotente. Aplicar ANTES do robô 0.5.0 (o robô sem esta migration só
-- pula a etapa "Ler documentos"; esta migration sem o robô novo não faz nada).

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tabelas
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sp_pep_documentos (
  sp_id              text        PRIMARY KEY REFERENCES public.sp_pep_itens(sp_id) ON DELETE CASCADE,
  e_tag              text,
  sha256             text,
  extensao           text,
  tamanho            bigint,
  paginas            integer,
  caracteres         integer,
  extracao_status    text        NOT NULL
                       CHECK (extracao_status IN ('ok', 'sem_texto', 'protegido', 'corrompido',
                                                  'formato_nao_suportado', 'grande_demais', 'erro')),
  extracao_detalhe   text,
  extraido_em        timestamptz NOT NULL DEFAULT now(),
  versao_robo        text,
  -- Análise (Pulsar): conferências fixas + semelhança.
  analise_status     text        NOT NULL DEFAULT 'pendente'
                       CHECK (analise_status IN ('pendente', 'concluida', 'erro')),
  analise_tentativas integer     NOT NULL DEFAULT 0,
  analise_erro       text,
  analise_versao     text,
  analisado_em       timestamptz,
  achados            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Impressão digital do conteúdo preenchido (MinHash, 128 posições). Fica
  -- depois que o texto expira: a cópia de um documento antigo continua visível.
  assinatura         integer[],
  -- Leitura pela IA (só siglas com régua: OE, ETC, PIC em 14/10/2026).
  ia_status          text        NOT NULL DEFAULT 'pendente'
                       CHECK (ia_status IN ('nao_se_aplica', 'pendente', 'concluida', 'erro')),
  ia_tentativas      integer     NOT NULL DEFAULT 0,
  ia_achados         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ia_resumo          text,
  ia_modelo          text,
  ia_regua           text,
  ia_erro            text,
  ia_em              timestamptz,
  -- O que a tela mostra (sp_pep_documentos_consolidar).
  veredito           text        CHECK (veredito IN ('bom', 'pode_conter_erros', 'errado', 'ilegivel')),
  -- O que uma PESSOA disse depois de olhar.
  revisao_status     text        NOT NULL DEFAULT 'pendente'
                       CHECK (revisao_status IN ('pendente', 'problema_confirmado', 'falso_positivo', 'corrigido')),
  revisao_obs        text,
  revisao_por        uuid        REFERENCES public.usuarios(id),
  revisao_por_nome   text,
  revisao_em         timestamptz,
  historico          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_documentos_pendentes
  ON public.sp_pep_documentos (extraido_em) WHERE analise_status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_sp_pep_documentos_sha
  ON public.sp_pep_documentos (sha256);

CREATE TABLE IF NOT EXISTS public.sp_pep_documentos_texto (
  sp_id      text        PRIMARY KEY REFERENCES public.sp_pep_documentos(sp_id) ON DELETE CASCADE,
  texto      text        NOT NULL,
  expira_em  timestamptz NOT NULL DEFAULT now() + interval '90 days'
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_documentos_texto_expira
  ON public.sp_pep_documentos_texto (expira_em);

-- Par de documentos parecidos. a_sp_id < b_sp_id: um par, uma linha.
CREATE TABLE IF NOT EXISTS public.sp_pep_documentos_semelhancas (
  a_sp_id          text        NOT NULL REFERENCES public.sp_pep_documentos(sp_id) ON DELETE CASCADE,
  b_sp_id          text        NOT NULL REFERENCES public.sp_pep_documentos(sp_id) ON DELETE CASCADE,
  tipo             text        NOT NULL CHECK (tipo IN ('identico', 'parecido')),
  similaridade     numeric(4,3) NOT NULL,
  relacao          text        NOT NULL
                     CHECK (relacao IN ('outro_paciente', 'mesmo_paciente_outro_mes', 'mesmo_mes',
                                        'outro_mes', 'outro_prestador', 'outro_item')),
  nivel            text        NOT NULL CHECK (nivel IN ('errado', 'atencao')),
  revisao_status   text        NOT NULL DEFAULT 'pendente'
                     CHECK (revisao_status IN ('pendente', 'problema_confirmado', 'falso_positivo')),
  revisao_obs      text,
  revisao_por      uuid        REFERENCES public.usuarios(id),
  revisao_por_nome text,
  revisao_em       timestamptz,
  detectado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (a_sp_id, b_sp_id),
  CHECK (a_sp_id < b_sp_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_documentos_semelhancas_b
  ON public.sp_pep_documentos_semelhancas (b_sp_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. RLS e privilégios
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sp_pep_documentos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_documentos_texto       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_documentos_semelhancas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sp_pep_documentos_select ON public.sp_pep_documentos;
CREATE POLICY sp_pep_documentos_select ON public.sp_pep_documentos
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')
  );

DROP POLICY IF EXISTS sp_pep_documentos_semelhancas_select ON public.sp_pep_documentos_semelhancas;
CREATE POLICY sp_pep_documentos_semelhancas_select ON public.sp_pep_documentos_semelhancas
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')
  );

-- sp_pep_documentos_texto: nenhuma policy, de propósito.

REVOKE ALL ON public.sp_pep_documentos, public.sp_pep_documentos_texto, public.sp_pep_documentos_semelhancas FROM anon;
REVOKE ALL ON public.sp_pep_documentos_texto FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.sp_pep_documentos, public.sp_pep_documentos_semelhancas FROM authenticated;
GRANT SELECT ON public.sp_pep_documentos, public.sp_pep_documentos_semelhancas TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Indicação final de cada documento
-- ═════════════════════════════════════════════════════════════════════════════
-- Achados das conferências fixas + IA + pares de cópia (o par marcado como
-- alarme falso por uma pessoa sai da conta). Chamada pelo Pulsar depois de
-- analisar e pelas revisões de semelhança. NULL = ainda não analisado.

CREATE OR REPLACE FUNCTION public.sp_pep_documentos_consolidar(p_sp_ids text[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  WITH sem AS (
    SELECT x.sp_id, max(CASE s.nivel WHEN 'errado' THEN 2 ELSE 1 END) AS pior
      FROM sp_pep_documentos_semelhancas s
      CROSS JOIN LATERAL (VALUES (s.a_sp_id), (s.b_sp_id)) AS x(sp_id)
     WHERE s.revisao_status <> 'falso_positivo'
       AND (p_sp_ids IS NULL OR x.sp_id = ANY (p_sp_ids))
     GROUP BY x.sp_id
  ), calc AS (
    SELECT d.sp_id,
           CASE
             WHEN d.extracao_status <> 'ok' THEN 'ilegivel'
             WHEN d.analise_status <> 'concluida' THEN NULL
             WHEN COALESCE(sem.pior, 0) = 2
               OR EXISTS (SELECT 1 FROM jsonb_array_elements(d.achados) a WHERE a->>'nivel' = 'errado') THEN 'errado'
             WHEN COALESCE(sem.pior, 0) = 1
               OR jsonb_array_length(d.achados) > 0
               OR jsonb_array_length(d.ia_achados) > 0 THEN 'pode_conter_erros'
             ELSE 'bom'
           END AS veredito
      FROM sp_pep_documentos d
      LEFT JOIN sem ON sem.sp_id = d.sp_id
     WHERE p_sp_ids IS NULL OR d.sp_id = ANY (p_sp_ids)
  )
  UPDATE sp_pep_documentos d
     SET veredito = c.veredito, atualizado_em = now()
    FROM calc c
   WHERE c.sp_id = d.sp_id AND d.veredito IS DISTINCT FROM c.veredito;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_documentos_consolidar(text[]) FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. RPCs do robô (token da máquina, como as outras robo_pep_*)
-- ═════════════════════════════════════════════════════════════════════════════

-- Quais evidências o robô precisa ler: as que ainda não têm texto, as que
-- mudaram (eTag) e as que falharam por erro passageiro há mais de 20 h.
CREATE OR REPLACE FUNCTION public.robo_pep_documentos_a_ler(p_token text, p_limite integer DEFAULT 150)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_maquina text := public.robo_autenticar(p_token);
  v_resultado jsonb;
BEGIN
  WITH alvo AS (
    SELECT i.sp_id, i.e_tag, i.nome, i.tamanho, i.criado_em_sp
      FROM sp_pep_itens i
      LEFT JOIN sp_pep_documentos d ON d.sp_id = i.sp_id
     WHERE i.tipo = 'evidencia'
       AND i.removido_em IS NULL
       AND i.status NOT IN ('ignorado', 'removido')
       AND (d.sp_id IS NULL
            OR d.e_tag IS DISTINCT FROM i.e_tag
            OR (d.extracao_status = 'erro' AND d.extraido_em < now() - interval '20 hours'))
  )
  SELECT jsonb_build_object(
           'total', (SELECT count(*) FROM alvo),
           'itens', COALESCE((
             SELECT jsonb_agg(jsonb_build_object('sp_id', a.sp_id, 'e_tag', a.e_tag, 'nome', a.nome, 'tamanho', a.tamanho))
               FROM (SELECT * FROM alvo ORDER BY criado_em_sp DESC NULLS LAST, sp_id
                      LIMIT greatest(1, least(COALESCE(p_limite, 150), 500))) a), '[]'::jsonb))
    INTO v_resultado;
  RETURN v_resultado;
END;
$$;

-- O que o robô leu. Conteúdo igual ao de antes (mesmo SHA-256 — o arquivo só
-- foi renomeado ou movido): atualiza o eTag e mantém análise e revisão.
-- Conteúdo novo: análise do zero, revisão volta a "pendente" (com histórico)
-- e os pares de cópia do documento são refeitos.
CREATE OR REPLACE FUNCTION public.robo_pep_registrar_documentos(
  p_token        text,
  p_execucao_id  uuid,
  p_documentos   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_maquina  text := public.robo_autenticar(p_token);
  d          jsonb;
  v_sp       text;
  v_status   text;
  v_sha      text;
  v_ant      sp_pep_documentos%ROWTYPE;
  v_novos    integer := 0;
  v_iguais   integer := 0;
  v_fora     integer := 0;
BEGIN
  IF jsonb_typeof(p_documentos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_documentos precisa ser uma lista' USING ERRCODE = '22023';
  END IF;

  FOR d IN SELECT * FROM jsonb_array_elements(p_documentos) LOOP
    v_sp := d->>'sp_id';
    IF v_sp IS NULL OR NOT EXISTS (SELECT 1 FROM sp_pep_itens WHERE sp_id = v_sp AND tipo = 'evidencia') THEN
      v_fora := v_fora + 1;
      CONTINUE;
    END IF;
    v_status := CASE WHEN d->>'status' IN ('ok', 'sem_texto', 'protegido', 'corrompido', 'formato_nao_suportado', 'grande_demais', 'erro')
                     THEN d->>'status' ELSE 'erro' END;
    v_sha := NULLIF(d->>'sha256', '');

    SELECT * INTO v_ant FROM sp_pep_documentos WHERE sp_id = v_sp;
    IF FOUND AND v_status = 'ok' AND v_ant.extracao_status = 'ok' AND v_ant.sha256 = v_sha THEN
      UPDATE sp_pep_documentos SET e_tag = d->>'e_tag', atualizado_em = now() WHERE sp_id = v_sp;
      v_iguais := v_iguais + 1;
      CONTINUE;
    END IF;

    INSERT INTO sp_pep_documentos AS x (
      sp_id, e_tag, sha256, extensao, tamanho, paginas, caracteres, extracao_status, extracao_detalhe,
      extraido_em, versao_robo, analise_status, analise_tentativas, analise_erro, analise_versao, analisado_em,
      achados, assinatura, ia_status, ia_tentativas, ia_achados, ia_resumo, ia_modelo, ia_regua, ia_erro, ia_em,
      veredito, revisao_status)
    VALUES (
      v_sp, d->>'e_tag', v_sha, left(d->>'extensao', 10), (d->>'tamanho')::bigint, (d->>'paginas')::integer,
      (d->>'caracteres')::integer, v_status, left(d->>'detalhe', 300),
      now(), left((SELECT versao FROM sp_pep_execucoes WHERE id = p_execucao_id), 40),
      CASE WHEN v_status = 'ok' THEN 'pendente' ELSE 'concluida' END, 0, NULL, NULL, NULL,
      '[]'::jsonb, NULL, CASE WHEN v_status = 'ok' THEN 'pendente' ELSE 'nao_se_aplica' END, 0, '[]'::jsonb,
      NULL, NULL, NULL, NULL, NULL,
      CASE WHEN v_status = 'ok' THEN NULL ELSE 'ilegivel' END, 'pendente')
    ON CONFLICT (sp_id) DO UPDATE SET
      e_tag = EXCLUDED.e_tag, sha256 = EXCLUDED.sha256, extensao = EXCLUDED.extensao, tamanho = EXCLUDED.tamanho,
      paginas = EXCLUDED.paginas, caracteres = EXCLUDED.caracteres, extracao_status = EXCLUDED.extracao_status,
      extracao_detalhe = EXCLUDED.extracao_detalhe, extraido_em = now(), versao_robo = EXCLUDED.versao_robo,
      analise_status = EXCLUDED.analise_status, analise_tentativas = 0, analise_erro = NULL, analise_versao = NULL,
      analisado_em = NULL, achados = '[]'::jsonb, assinatura = NULL, ia_status = EXCLUDED.ia_status,
      ia_tentativas = 0, ia_achados = '[]'::jsonb, ia_resumo = NULL, ia_modelo = NULL, ia_regua = NULL,
      ia_erro = NULL, ia_em = NULL, veredito = EXCLUDED.veredito,
      revisao_status = 'pendente', revisao_obs = NULL, revisao_por = NULL, revisao_por_nome = NULL, revisao_em = NULL,
      historico = CASE WHEN x.revisao_status <> 'pendente'
                       THEN x.historico || jsonb_build_array(jsonb_build_object(
                              'em', now(), 'por', NULL, 'acao', 'conteudo_mudou',
                              'obs', 'O arquivo mudou no SharePoint: a revisão anterior ("' || x.revisao_status || '") foi reaberta.'))
                       ELSE x.historico END,
      atualizado_em = now();

    DELETE FROM sp_pep_documentos_semelhancas WHERE a_sp_id = v_sp OR b_sp_id = v_sp;

    IF v_status = 'ok' AND COALESCE(d->>'texto', '') <> '' THEN
      INSERT INTO sp_pep_documentos_texto (sp_id, texto, expira_em)
      VALUES (v_sp, left(d->>'texto', 300000), now() + interval '90 days')
      ON CONFLICT (sp_id) DO UPDATE SET texto = EXCLUDED.texto, expira_em = EXCLUDED.expira_em;
    ELSE
      DELETE FROM sp_pep_documentos_texto WHERE sp_id = v_sp;
    END IF;
    v_novos := v_novos + 1;
  END LOOP;

  RETURN jsonb_build_object('gravados', v_novos, 'conteudo_igual', v_iguais, 'desconhecidos', v_fora);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.robo_pep_documentos_a_ler(text, integer) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.robo_pep_registrar_documentos(text, uuid, jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.robo_pep_documentos_a_ler(text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.robo_pep_registrar_documentos(text, uuid, jsonb) TO anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Revisão por pessoa (tela PEP) — mesmo critério de escrita do PEP (rp/admin)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sp_pep_documento_revisar(p_sp_id text, p_status text, p_obs text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
  v_obs  text := left(NULLIF(btrim(COALESCE(p_obs, '')), ''), 1000);
BEGIN
  IF NOT public.sp_pep_pode_escrever() THEN
    RAISE EXCEPTION 'sem permissao para revisar documentos do PEP' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('pendente', 'problema_confirmado', 'falso_positivo', 'corrigido') THEN
    RAISE EXCEPTION 'status de revisao invalido' USING ERRCODE = '22023';
  END IF;
  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();
  UPDATE sp_pep_documentos
     SET revisao_status = p_status, revisao_obs = v_obs, revisao_por = auth.uid(), revisao_por_nome = v_nome,
         revisao_em = now(), atualizado_em = now(),
         historico = historico || jsonb_build_array(jsonb_build_object(
                       'em', now(), 'por', v_nome, 'acao', p_status, 'obs', v_obs))
   WHERE sp_id = p_sp_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'documento nao encontrado' USING ERRCODE = 'P0002';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_documento_revisar(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_documento_revisar(text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sp_pep_semelhanca_revisar(p_a text, p_b text, p_status text, p_obs text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
  v_a    text := least(p_a, p_b);
  v_b    text := greatest(p_a, p_b);
BEGIN
  IF NOT public.sp_pep_pode_escrever() THEN
    RAISE EXCEPTION 'sem permissao para revisar documentos do PEP' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('pendente', 'problema_confirmado', 'falso_positivo') THEN
    RAISE EXCEPTION 'status de revisao invalido' USING ERRCODE = '22023';
  END IF;
  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();
  UPDATE sp_pep_documentos_semelhancas
     SET revisao_status = p_status, revisao_obs = left(NULLIF(btrim(COALESCE(p_obs, '')), ''), 1000),
         revisao_por = auth.uid(), revisao_por_nome = v_nome, revisao_em = now(), atualizado_em = now()
   WHERE a_sp_id = v_a AND b_sp_id = v_b;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'par de documentos nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  -- Alarme falso tira o par da indicação dos dois documentos (e o contrário).
  PERFORM public.sp_pep_documentos_consolidar(ARRAY[v_a, v_b]);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_semelhanca_revisar(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_semelhanca_revisar(text, text, text, text) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. O texto expira em 90 dias
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sp_pep_documentos_expurgar_texto()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM sp_pep_documentos_texto WHERE expira_em < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_documentos_expurgar_texto() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('pep-documentos-expurgar-texto');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'pep-documentos-expurgar-texto',
  '15 7 * * *',   -- 04:15 em Brasília (o cron do Supabase roda em UTC)
  $cron$SELECT public.sp_pep_documentos_expurgar_texto()$cron$
);

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Tique do worker: acorda também para documento esperando análise
-- ═════════════════════════════════════════════════════════════════════════════
-- Igual à de 20260923210000, com uma condição a mais. A rota do tique
-- (app/api/terapeutico/auditoria-evolucoes/worker/tick) processa a fila da
-- auditoria e depois os documentos da PEP.

CREATE OR REPLACE FUNCTION public.fn_auditoria_worker_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  _url      text;
  _segredo  text;
BEGIN
  SELECT url INTO _url FROM public.auditoria_worker_config WHERE id = true AND ativo = true;
  IF _url IS NULL THEN
    RETURN;
  END IF;

  -- Nada a fazer (o caso de quase todo minuto): não acorda o Coolify.
  IF NOT EXISTS (
    SELECT 1 FROM public.auditoria_reauditoria_fila
     WHERE status IN ('pendente', 'processando')
       AND disponivel_em <= now()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.sp_pep_documentos
     WHERE analise_status = 'pendente'
        OR (ia_status = 'erro' AND ia_tentativas < 3 AND ia_em < now() - interval '10 minutes')
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _segredo
    FROM vault.decrypted_secrets WHERE name = 'auditoria_worker_secret';
  IF _segredo IS NULL THEN
    RAISE EXCEPTION 'fn_auditoria_worker_tick: segredo auditoria_worker_secret ausente no Vault';
  END IF;

  PERFORM net.http_post(
    url     := _url,
    headers := jsonb_build_object('x-worker-secret', _segredo, 'Content-Type', 'application/json'),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_auditoria_worker_tick() FROM PUBLIC, anon, authenticated;
