-- ═════════════════════════════════════════════════════════════════════════════
-- PEP — Auditoria de Documentos: leitura separada da auditoria (15/10/2026)
-- ═════════════════════════════════════════════════════════════════════════════
-- Decisão do usuário (14/10/2026), no molde da Auditoria de Evoluções:
--
--   • O robô LÊ sozinho (texto + impressão digital) — como já faz.
--   • Ninguém JULGA sozinho: o documento lido fica "aguardando" (= "Lido, não
--     auditado"), sem veredito e sem IA, até alguém clicar "Auditar" na tela
--     /relacionamento-prestador/auditoria-documentos. "pendente" passa a
--     significar SÓ "na fila de auditoria".
--   • As réguas da IA (OE, ETC, PIC, e as próximas) ficam no banco,
--     versionadas e append-only; publicar = só rp/admin.
--   • Tela nova com permissão própria: relacionamento_prestador_auditoria_documentos.
--
-- Os resultados gravados em 14/10 foram feitos com a regra ainda não calibrada:
-- todo documento lido volta para "aguardando" (os ilegíveis continuam
-- "Não foi possível ler") e os pares de cópia são apagados — refeitos na
-- próxima auditoria.
--
-- Idempotente. O robô NÃO precisa de redeploy (a mudança é só na RPC).

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Estado "aguardando" e o lote de auditoria
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sp_pep_documentos DROP CONSTRAINT IF EXISTS sp_pep_documentos_analise_status_check;
ALTER TABLE public.sp_pep_documentos ADD CONSTRAINT sp_pep_documentos_analise_status_check
  CHECK (analise_status IN ('aguardando', 'pendente', 'concluida', 'erro'));
ALTER TABLE public.sp_pep_documentos ALTER COLUMN analise_status SET DEFAULT 'aguardando';

ALTER TABLE public.sp_pep_documentos
  ADD COLUMN IF NOT EXISTS auditoria_lote            uuid,
  ADD COLUMN IF NOT EXISTS auditoria_pedida_por_nome text,
  ADD COLUMN IF NOT EXISTS auditoria_pedida_em       timestamptz,
  -- Reserva de quem está analisando agora (despacho da tela × tique do cron):
  -- evita ler o mesmo documento duas vezes pela IA. Vence em 3 minutos.
  ADD COLUMN IF NOT EXISTS analise_reservada_em      timestamptz;

CREATE INDEX IF NOT EXISTS idx_sp_pep_documentos_lote
  ON public.sp_pep_documentos (auditoria_lote) WHERE auditoria_lote IS NOT NULL;

-- Tudo o que foi lido volta a "Lido, não auditado" (regra de 14/10 não
-- calibrada). Só uma vez: depois desta migration, documento "concluida" é
-- auditoria pedida por alguém e não deve ser apagado numa reaplicação.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sp_pep_documentos WHERE analise_status = 'aguardando')
     AND NOT EXISTS (SELECT 1 FROM public.sp_pep_documentos WHERE auditoria_lote IS NOT NULL) THEN
    UPDATE public.sp_pep_documentos
       SET analise_status = 'aguardando', analise_tentativas = 0, analise_erro = NULL, analise_versao = NULL,
           analisado_em = NULL, achados = '[]'::jsonb, assinatura = NULL,
           ia_status = 'pendente', ia_tentativas = 0, ia_achados = '[]'::jsonb, ia_resumo = NULL,
           ia_modelo = NULL, ia_regua = NULL, ia_erro = NULL, ia_em = NULL,
           veredito = NULL, atualizado_em = now()
     WHERE extracao_status = 'ok';
    DELETE FROM public.sp_pep_documentos_semelhancas;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Robô: conteúdo novo entra como "aguardando"
-- ═════════════════════════════════════════════════════════════════════════════
-- Igual à de 20261014110000, trocando 'pendente' por 'aguardando'.

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
      CASE WHEN v_status = 'ok' THEN 'aguardando' ELSE 'concluida' END, 0, NULL, NULL, NULL,
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
      auditoria_lote = NULL, auditoria_pedida_por_nome = NULL, auditoria_pedida_em = NULL, analise_reservada_em = NULL,
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

REVOKE EXECUTE ON FUNCTION public.robo_pep_registrar_documentos(text, uuid, jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.robo_pep_registrar_documentos(text, uuid, jsonb) TO anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Quem lê: a permissão da tela nova se soma às do PEP
-- ═════════════════════════════════════════════════════════════════════════════
-- Quem tem só a Auditoria de Documentos lê os documentos, os pares de cópia e
-- as réguas. O texto (sp_pep_documentos_texto) continua sem policy: só o
-- servidor lê, depois de conferir a permissão.

CREATE OR REPLACE FUNCTION public.sp_pep_pode_ler_documentos()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.usuario_tem_permissao('robo_sharepoint')
      OR public.usuario_tem_permissao('relacionamento_prestador_pep')
      OR public.usuario_tem_permissao('relacionamento_prestador_auditoria_documentos');
$$;
REVOKE ALL ON FUNCTION public.sp_pep_pode_ler_documentos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_pode_ler_documentos() TO authenticated;

DROP POLICY IF EXISTS sp_pep_documentos_select ON public.sp_pep_documentos;
CREATE POLICY sp_pep_documentos_select ON public.sp_pep_documentos
  FOR SELECT TO authenticated USING (public.sp_pep_pode_ler_documentos());

DROP POLICY IF EXISTS sp_pep_documentos_semelhancas_select ON public.sp_pep_documentos_semelhancas;
CREATE POLICY sp_pep_documentos_semelhancas_select ON public.sp_pep_documentos_semelhancas
  FOR SELECT TO authenticated USING (public.sp_pep_pode_ler_documentos());

-- As tabelas do robô (sp_pep_itens, sp_pep_pastas, sp_pep_prestadores,
-- sp_pep_pacientes) NÃO ganham a permissão nova: guardam CPF de paciente (e a
-- planilha do prestador, CPFs em lista). A tela recebe só o que precisa, sem
-- CPF, pela função abaixo.

CREATE OR REPLACE FUNCTION public.sp_pep_auditoria_lista()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.sp_pep_pode_ler_documentos() THEN
    RAISE EXCEPTION 'sem permissao para a auditoria de documentos' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(
             (to_jsonb(d) - 'assinatura' - 'revisao_por' - 'analise_reservada_em')
             || jsonb_build_object(
                  'item', jsonb_build_object(
                    'nome', i.nome, 'sigla', i.sigla, 'competencia', i.competencia,
                    'prestador_nome', i.prestador_nome, 'prestador_pasta_id', i.prestador_pasta_id,
                    'paciente_nome', i.paciente_nome, 'paciente_pasta_id', i.paciente_pasta_id,
                    'web_url', i.web_url, 'status', i.status, 'motivo', i.motivo, 'padrao', i.padrao),
                  'prestador', jsonb_build_object('nome_pasta', pa.nome, 'status', pr.status, 'motivo', pr.motivo))
             ORDER BY d.sp_id)
      FROM sp_pep_documentos d
      JOIN sp_pep_itens i ON i.sp_id = d.sp_id
      LEFT JOIN sp_pep_pastas pa ON pa.id = i.prestador_pasta_id
      LEFT JOIN sp_pep_prestadores pr ON pr.pasta_id = i.prestador_pasta_id
     WHERE i.removido_em IS NULL), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_auditoria_lista() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_auditoria_lista() TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Réguas versionadas (append-only)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pep_reguas_versoes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sigla               text        NOT NULL CHECK (sigla IN ('STC', 'ETC', 'TAP', 'TOP', 'PIC', 'RT', 'OE')),
  versao              integer     NOT NULL CHECK (versao >= 1),
  conteudo            text        NOT NULL CHECK (length(btrim(conteudo)) >= 20),
  nota                text,
  publicado_por       uuid        REFERENCES public.usuarios(id),
  publicado_por_nome  text        NOT NULL,
  publicado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sigla, versao)
);

CREATE OR REPLACE FUNCTION public.pep_reguas_impedir_alteracao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pep_reguas_versoes é append-only: % não é permitido. Publique uma nova versão.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_pep_reguas_imutavel ON public.pep_reguas_versoes;
CREATE TRIGGER trg_pep_reguas_imutavel
  BEFORE UPDATE OR DELETE ON public.pep_reguas_versoes
  FOR EACH ROW EXECUTE FUNCTION public.pep_reguas_impedir_alteracao();

ALTER TABLE public.pep_reguas_versoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pep_reguas_versoes_select ON public.pep_reguas_versoes;
CREATE POLICY pep_reguas_versoes_select ON public.pep_reguas_versoes
  FOR SELECT TO authenticated USING (public.sp_pep_pode_ler_documentos());

-- Escrita só pela RPC abaixo (rp/admin).
REVOKE ALL ON public.pep_reguas_versoes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.pep_reguas_versoes FROM authenticated;
GRANT SELECT ON public.pep_reguas_versoes TO authenticated;

CREATE OR REPLACE FUNCTION public.sp_pep_regua_publicar(p_sigla text, p_conteudo text, p_nota text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sigla  text := upper(btrim(COALESCE(p_sigla, '')));
  v_nome   text;
  v_versao integer;
  v_id     uuid;
BEGIN
  IF NOT public.sp_pep_pode_escrever() THEN
    RAISE EXCEPTION 'só RP e administradores publicam réguas' USING ERRCODE = '42501';
  END IF;
  IF v_sigla NOT IN ('STC', 'ETC', 'TAP', 'TOP', 'PIC', 'RT', 'OE') THEN
    RAISE EXCEPTION 'sigla inválida' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_conteudo, ''))) < 20 THEN
    RAISE EXCEPTION 'a régua está vazia' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_nota, ''))) = 0 THEN
    RAISE EXCEPTION 'diga o que mudou nesta versão' USING ERRCODE = '22023';
  END IF;
  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();
  -- Uma publicação por vez por sigla (duas abas publicando juntas).
  PERFORM pg_advisory_xact_lock(hashtext('pep_regua_' || v_sigla));
  SELECT COALESCE(max(versao), 0) + 1 INTO v_versao FROM pep_reguas_versoes WHERE sigla = v_sigla;
  INSERT INTO pep_reguas_versoes (sigla, versao, conteudo, nota, publicado_por, publicado_por_nome)
  VALUES (v_sigla, v_versao, left(btrim(p_conteudo), 20000), left(btrim(p_nota), 500), auth.uid(), COALESCE(v_nome, 'Usuário'))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'sigla', v_sigla, 'versao', v_versao);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_regua_publicar(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_regua_publicar(text, text, text) TO authenticated;

-- v1 = as réguas recebidas em 14/10/2026 (o texto que estava no código).
INSERT INTO public.pep_reguas_versoes (sigla, versao, conteudo, nota, publicado_por_nome)
VALUES
('OE', 1, $r$Identificação: data do registro preenchida e completa; horário de início e de término preenchidos, claros e coerentes.
Participantes: nome do paciente; nome do psicólogo ou da psicóloga responsável; nome do representante da escola; cargo ou função do representante da escola.
Procure especificamente: campos com nomes ou informações faltantes; textos de exemplo ou instruções de preenchimento que ficaram; placeholders como "inserir informação" ou expressões equivalentes; seções inteiras sem conteúdo; campos preenchidos só em parte; datas ou horários que pareçam inconsistentes.$r$,
 'Régua recebida em 14/10/2026 ("OE e ETC.pdf").', 'Sistema'),
('ETC', 1, $r$Verifique: data da reunião, completa e válida; horário de início; horário de término; coerência entre data e horários.
Procure especificamente: datas não preenchidas; horários incompletos; participantes não identificados; seções inteiras sem conteúdo; linhas de preenchimento vazias; placeholders como "inserir informação"; textos genéricos que não descrevam o alinhamento efetivamente realizado (ex.: "foi discutido o caso" sem dizer o que foi discutido e decidido).$r$,
 'Régua recebida em 14/10/2026 ("OE e ETC.pdf").', 'Sistema'),
('PIC', 1, $r$Verifique se o PIC está completamente preenchido, sem instruções ou exemplos do modelo, com informações coerentes entre as seções, suficientes para sustentar tecnicamente os objetivos, com dados objetivos e mensuráveis quando solicitado, e coerência entre avaliação, resultados, conclusão e objetivos. Diferencie campo preenchido de campo preenchido ADEQUADAMENTE. Quando faltar algo, diga exatamente o que falta; quando algo parecer inadequado ou incoerente, explique o motivo.
1. Informações gerais: paciente; financiadora; data de nascimento; responsável; idade; período de vigência do PIC; equipe responsável; coordenação; supervisão técnica.
2. Informações sobre o paciente — o texto apresenta: mês e ano do diagnóstico; diagnóstico; profissional responsável pelo diagnóstico; necessidades de intervenção; com quem o paciente mora; escola, quando aplicável; acompanhamento terapêutico; interesses/preferências; repertórios já desenvolvidos; comportamentos que precisam ser desenvolvidos; prioridades dos responsáveis; medicações, data aproximada de início e indicação; outras questões médicas relevantes, quando existirem.
3. Coerência interna (segunda leitura, transversal): sobras como "listar", "descrever", "xx", "ex.", "exemplo", "incluir gráfico"; instruções destinadas ao profissional; textos duplicados do modelo; objetivos sem critério mensurável; objetivo sem relação com a avaliação.
4. Assinaturas e finalização: assinatura do coordenador; nome do coordenador; data. Se não houver como ver assinatura (só texto), diga "assinatura não verificável no texto" apenas se também faltarem o nome e a data.$r$,
 'Régua recebida em 14/10/2026 ("AUDITORIA DE PREENCHIMENTO E QUALIDADE DO PIC.docx").', 'Sistema')
ON CONFLICT (sigla, versao) DO NOTHING;
