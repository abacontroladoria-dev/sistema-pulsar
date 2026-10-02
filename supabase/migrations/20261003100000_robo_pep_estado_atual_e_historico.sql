-- Robô SharePoint → PEP: a tela é o RETRATO da pasta; o que mudou vira histórico.
--
-- Pedido do usuário (02/10/2026), plano "delegated-wobbling-hoare":
--
--   1. "Só o que mudou" confunde. O que importa é o que ESTÁ na pasta agora.
--      sp_pep_arquivos guarda o estado atual de TODO arquivo (evidência,
--      planilha, fora do PEP, fora do padrão), mantido pelo lote do robô. As
--      leituras do painel aceitam execução NULL = estado atual
--      (vw_sp_pep_arquivos_atuais e as três RPCs de detalhe).
--
--   2. Entrega e valor acompanham a pasta. Evidência que sumiu do SharePoint
--      (ou saiu da pasta do item, ou deixou de ser evidência) perde a unidade
--      que sustentava — seja do robô (roxo), seja de pessoa (azul). Mês
--      LIBERADO não muda: fica um aviso, uma vez. Arquivo que volta pode ser
--      entregue de novo. A chave "entrega automática" deixa de existir: o robô
--      entrega sempre (decisão do usuário).
--
--   3. Histórico só de EVIDÊNCIAS (sp_pep_evidencias_historico): apareceu,
--      sumiu, voltou, renomeou, moveu, deixou de ser evidência, saiu do
--      padrão, entrega desfeita, mês liberado mantido. Cada linha é uma
--      fotografia legível do arquivo naquele momento. Arquivo solto que não
--      era evidência não gera nada (decisão do usuário).
--
--   4. Retrato diário (sp_pep_retrato_diario): evidências na pasta e entregues
--      (robô/pessoa) por dia × prestador × mês × sigla, para o gráfico.
--
--   5. Freio: leitura completa que acha "sumidos" demais de uma vez (mais de
--      10 e mais de 15%) não apaga nada — guarda o alerta em
--      sp_pep_estado.remocao_suspensa até um admin confirmar.
--
-- ORDEM: pode ser aplicada antes ou depois do front novo (o front tem
-- fallback). Tem de vir ANTES do robô 0.4.0, que lê o site inteiro todo dia:
-- sem o freio desta migration, uma leitura completa ruim desfaria entregas.
-- Idempotente. Testada em PGlite.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tabelas
-- ═════════════════════════════════════════════════════════════════════════════

-- Estado atual de cada arquivo da pasta, de qualquer tipo. removido_em
-- preenchido = não está mais lá (a linha fica para a lista de "Apagados").
CREATE TABLE IF NOT EXISTS public.sp_pep_arquivos (
  sp_id                text        PRIMARY KEY,
  nome                 text        NOT NULL,
  caminho              text,
  web_url              text,
  tipo                 text        NOT NULL CHECK (tipo IN ('evidencia', 'planilha', 'ignorado', 'fora_padrao')),
  motivo               text,
  sigla                text,
  prestador_pasta_id   text,
  paciente_pasta_id    text,
  tamanho              bigint,
  criado_em_sp         timestamptz,
  modificado_em_sp     timestamptz,
  criado_por           text,
  competencia          text,
  detalhe              jsonb,
  primeira_execucao_id uuid,
  ultima_execucao_id   uuid,
  visto_primeiro_em    timestamptz NOT NULL DEFAULT now(),
  visto_ultimo_em      timestamptz NOT NULL DEFAULT now(),
  removido_em          timestamptz,
  atualizado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sp_pep_arquivos_ativos
  ON public.sp_pep_arquivos (prestador_pasta_id, tipo) WHERE removido_em IS NULL;

COMMENT ON TABLE public.sp_pep_arquivos IS
  'Estado ATUAL de cada arquivo do SharePoint (todos os tipos). Mantido por robo_pep_registrar_lote. removido_em = não está mais na pasta.';

-- Histórico das evidências. Só evidência (decisão do usuário, 02/10/2026).
CREATE TABLE IF NOT EXISTS public.sp_pep_evidencias_historico (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sp_id                text        NOT NULL,
  evento               text        NOT NULL CHECK (evento IN (
                         'apareceu', 'sumiu', 'voltou', 'renomeou', 'moveu', 'deixou_de_ser_evidencia',
                         'saiu_do_padrao', 'entrega_desfeita', 'mes_liberado_mantido')),
  em                   timestamptz NOT NULL DEFAULT now(),
  execucao_id          uuid,
  nome                 text,
  nome_anterior        text,
  caminho              text,
  caminho_anterior     text,
  web_url              text,
  prestador_pasta_id   text,
  prestador_nome       text,
  paciente_nome        text,
  sigla                text,
  competencia          text,
  criado_em_sp         timestamptz,
  criado_por           text,
  situacao             text,
  entregue_por         text,
  entregue_em          timestamptz,
  registro_entrega_id  uuid,
  unidades_antes       integer,
  unidades_depois      integer,
  detalhe              jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_sp_pep_evid_hist_em     ON public.sp_pep_evidencias_historico (em DESC);
CREATE INDEX IF NOT EXISTS idx_sp_pep_evid_hist_sp_id  ON public.sp_pep_evidencias_historico (sp_id, em DESC);
CREATE INDEX IF NOT EXISTS idx_sp_pep_evid_hist_evento ON public.sp_pep_evidencias_historico (evento, em DESC);

COMMENT ON TABLE public.sp_pep_evidencias_historico IS
  'O que aconteceu com cada evidência do SharePoint (apareceu, sumiu, voltou, renomeou...). Fotografia do arquivo no momento; sem prazo de retenção.';

-- Retrato do dia (Brasília). prestador_pasta_id = '' é a linha de total do dia.
CREATE TABLE IF NOT EXISTS public.sp_pep_retrato_diario (
  dia                 date        NOT NULL,
  prestador_pasta_id  text        NOT NULL,
  competencia         text        NOT NULL DEFAULT '',
  sigla               text        NOT NULL DEFAULT '',
  prestador_nome      text,
  evidencias          integer     NOT NULL DEFAULT 0,
  entregues_robo      integer     NOT NULL DEFAULT 0,
  entregues_pessoa    integer     NOT NULL DEFAULT 0,
  arquivos            integer     NOT NULL DEFAULT 0,
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dia, prestador_pasta_id, competencia, sigla)
);

COMMENT ON TABLE public.sp_pep_retrato_diario IS
  'Quantas evidências estavam na pasta em cada dia (última leitura do dia vence). Linha prestador_pasta_id='''' = total do dia.';

-- Evidência entregue que mudou de pasta (outro prestador/paciente/item) ou
-- deixou de ser evidência: a entrega dela será retirada (sp_pep_robo_entregar).
ALTER TABLE public.sp_pep_itens
  ADD COLUMN IF NOT EXISTS saiu_da_pasta_em timestamptz;

-- Alerta do freio (leitura completa com sumidos demais).
ALTER TABLE public.sp_pep_estado
  ADD COLUMN IF NOT EXISTS remocao_suspensa jsonb;

ALTER TABLE public.sp_pep_arquivos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_evidencias_historico  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_retrato_diario        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sp_pep_arquivos_select ON public.sp_pep_arquivos;
CREATE POLICY sp_pep_arquivos_select ON public.sp_pep_arquivos
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep'));

DROP POLICY IF EXISTS sp_pep_evidencias_historico_select ON public.sp_pep_evidencias_historico;
CREATE POLICY sp_pep_evidencias_historico_select ON public.sp_pep_evidencias_historico
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep'));

DROP POLICY IF EXISTS sp_pep_retrato_diario_select ON public.sp_pep_retrato_diario;
CREATE POLICY sp_pep_retrato_diario_select ON public.sp_pep_retrato_diario
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep'));

REVOKE ALL ON public.sp_pep_arquivos, public.sp_pep_evidencias_historico, public.sp_pep_retrato_diario FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sp_pep_arquivos, public.sp_pep_evidencias_historico, public.sp_pep_retrato_diario FROM authenticated;
GRANT SELECT ON public.sp_pep_arquivos, public.sp_pep_evidencias_historico, public.sp_pep_retrato_diario TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Histórico: gatilhos em sp_pep_itens
-- ═════════════════════════════════════════════════════════════════════════════

-- Uma linha do histórico a partir do arquivo (NEW) e do que ele era (OLD).
CREATE OR REPLACE FUNCTION public.sp_pep_evento_evidencia(
  p_evento text, p_novo public.sp_pep_itens, p_velho public.sp_pep_itens, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_velho public.sp_pep_itens := COALESCE(p_velho, p_novo);
BEGIN
  INSERT INTO sp_pep_evidencias_historico (
    sp_id, evento, execucao_id, nome, nome_anterior, caminho, caminho_anterior, web_url,
    prestador_pasta_id, prestador_nome, paciente_nome, sigla, competencia, criado_em_sp, criado_por,
    situacao, entregue_por, entregue_em, registro_entrega_id, unidades_antes, unidades_depois, detalhe)
  VALUES (
    p_novo.sp_id, p_evento, NULLIF(current_setting('pep.execucao', true), '')::uuid,
    p_novo.nome,
    CASE WHEN v_velho.nome IS DISTINCT FROM p_novo.nome THEN v_velho.nome END,
    p_novo.caminho,
    CASE WHEN v_velho.caminho IS DISTINCT FROM p_novo.caminho THEN v_velho.caminho END,
    p_novo.web_url,
    COALESCE(p_novo.prestador_pasta_id, v_velho.prestador_pasta_id),
    COALESCE(v_velho.prestador_nome, p_novo.prestador_nome,
             (SELECT pr.prestador_nome FROM sp_pep_prestadores pr WHERE pr.pasta_id = COALESCE(v_velho.prestador_pasta_id, p_novo.prestador_pasta_id)),
             (SELECT pa.nome FROM sp_pep_pastas pa WHERE pa.id = COALESCE(v_velho.prestador_pasta_id, p_novo.prestador_pasta_id))),
    COALESCE(v_velho.paciente_nome, p_novo.paciente_nome,
             (SELECT pa.nome FROM sp_pep_pastas pa WHERE pa.id = COALESCE(v_velho.paciente_pasta_id, p_novo.paciente_pasta_id))),
    COALESCE(v_velho.sigla, p_novo.sigla),
    COALESCE(v_velho.competencia, p_novo.competencia),
    p_novo.criado_em_sp, p_novo.criado_por,
    v_velho.status,
    CASE WHEN v_velho.status = 'confirmado' THEN v_velho.entregue_por END,
    CASE WHEN v_velho.status = 'confirmado' THEN v_velho.resolvido_em END,
    CASE WHEN v_velho.status = 'confirmado' THEN v_velho.registro_entrega_id END,
    (p_extra->>'unidades_antes')::int, (p_extra->>'unidades_depois')::int,
    (p_extra - 'unidades_antes' - 'unidades_depois')
      || jsonb_strip_nulls(jsonb_build_object('padrao', p_novo.padrao, 'padrao_anterior',
           CASE WHEN v_velho.padrao IS DISTINCT FROM p_novo.padrao THEN v_velho.padrao END)));
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_evento_evidencia(text, public.sp_pep_itens, public.sp_pep_itens, jsonb) FROM PUBLIC, anon, authenticated;

-- ANTES de gravar: (a) arquivo que volta depois de ter a entrega retirada
-- pode ser entregue de novo; (b) entrega cujo arquivo mudou de pasta fica
-- marcada para ser retirada.
CREATE OR REPLACE FUNCTION public.sp_pep_itens_antes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.removido_em IS NOT NULL AND NEW.removido_em IS NULL AND OLD.status = 'removido' THEN
    NEW.entregue_por := NULL;
    NEW.robo_obs := NULL;
    NEW.registro_entrega_id := NULL;
    NEW.reprogramacao_criada_id := NULL;
  END IF;

  IF OLD.status = 'confirmado' AND NEW.status = 'confirmado' AND NEW.removido_em IS NULL
     AND NEW.saiu_da_pasta_em IS NULL
     AND (OLD.tipo, OLD.prestador_pasta_id, OLD.paciente_pasta_id, OLD.sigla)
         IS DISTINCT FROM (NEW.tipo, NEW.prestador_pasta_id, NEW.paciente_pasta_id, NEW.sigla) THEN
    NEW.saiu_da_pasta_em := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sp_pep_itens_antes ON public.sp_pep_itens;
CREATE TRIGGER trg_sp_pep_itens_antes
  BEFORE UPDATE ON public.sp_pep_itens
  FOR EACH ROW EXECUTE FUNCTION public.sp_pep_itens_antes();

-- DEPOIS de gravar: o evento do histórico.
CREATE OR REPLACE FUNCTION public.sp_pep_itens_historico()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saiu_do_pep boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tipo = 'evidencia' THEN
      PERFORM public.sp_pep_evento_evidencia('apareceu', NEW, NULL);
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.tipo <> 'evidencia' AND NEW.tipo <> 'evidencia' THEN
    RETURN NULL;
  END IF;

  IF OLD.removido_em IS NULL AND NEW.removido_em IS NOT NULL THEN
    IF OLD.tipo = 'evidencia' THEN
      -- Continua no SharePoint, só que fora do PEP (pasta 6/7, virou planilha).
      SELECT EXISTS (SELECT 1 FROM sp_pep_arquivos a
                      WHERE a.sp_id = NEW.sp_id AND a.removido_em IS NULL AND a.tipo IN ('ignorado', 'planilha'))
        INTO v_saiu_do_pep;
      PERFORM public.sp_pep_evento_evidencia(
        CASE WHEN v_saiu_do_pep THEN 'deixou_de_ser_evidencia' ELSE 'sumiu' END, NEW, OLD);
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.removido_em IS NOT NULL AND NEW.removido_em IS NULL THEN
    IF NEW.tipo = 'evidencia' THEN
      PERFORM public.sp_pep_evento_evidencia('voltou', NEW, OLD);
    END IF;
    RETURN NULL;
  END IF;

  IF NEW.removido_em IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF OLD.tipo = 'evidencia' AND NEW.tipo <> 'evidencia' THEN
    PERFORM public.sp_pep_evento_evidencia('deixou_de_ser_evidencia', NEW, OLD);
  ELSIF OLD.tipo <> 'evidencia' AND NEW.tipo = 'evidencia' THEN
    PERFORM public.sp_pep_evento_evidencia('apareceu', NEW, OLD);
  ELSIF OLD.nome IS DISTINCT FROM NEW.nome THEN
    PERFORM public.sp_pep_evento_evidencia('renomeou', NEW, OLD);
  ELSIF (OLD.caminho, OLD.prestador_pasta_id, OLD.paciente_pasta_id, OLD.sigla)
        IS DISTINCT FROM (NEW.caminho, NEW.prestador_pasta_id, NEW.paciente_pasta_id, NEW.sigla) THEN
    PERFORM public.sp_pep_evento_evidencia('moveu', NEW, OLD);
  ELSIF NEW.status = 'confirmado' AND OLD.padrao = 'ok' AND NEW.padrao IS DISTINCT FROM 'ok' THEN
    -- Entregue e depois renomeado fora do padrão: a entrega fica (o arquivo
    -- está na pasta), mas fica o aviso.
    PERFORM public.sp_pep_evento_evidencia('saiu_do_padrao', NEW, OLD);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sp_pep_itens_historico ON public.sp_pep_itens;
CREATE TRIGGER trg_sp_pep_itens_historico
  AFTER INSERT OR UPDATE ON public.sp_pep_itens
  FOR EACH ROW EXECUTE FUNCTION public.sp_pep_itens_historico();

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Retrato do dia
-- ═════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sp_pep_gravar_retrato()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dia date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  DELETE FROM sp_pep_retrato_diario WHERE dia = v_dia;

  INSERT INTO sp_pep_retrato_diario (dia, prestador_pasta_id, competencia, sigla, prestador_nome,
                                     evidencias, entregues_robo, entregues_pessoa)
  SELECT v_dia, i.prestador_pasta_id, COALESCE(i.competencia, ''), COALESCE(i.sigla, ''),
         max(COALESCE(i.prestador_nome, pr.prestador_nome)),
         count(*),
         count(*) FILTER (WHERE i.status = 'confirmado' AND i.entregue_por = 'robo'),
         count(*) FILTER (WHERE i.status = 'confirmado' AND i.entregue_por = 'humano')
    FROM sp_pep_itens i
    LEFT JOIN sp_pep_prestadores pr ON pr.pasta_id = i.prestador_pasta_id
   WHERE i.tipo = 'evidencia' AND i.removido_em IS NULL AND i.prestador_pasta_id IS NOT NULL
   GROUP BY i.prestador_pasta_id, COALESCE(i.competencia, ''), COALESCE(i.sigla, '');

  INSERT INTO sp_pep_retrato_diario (dia, prestador_pasta_id, competencia, sigla,
                                     evidencias, entregues_robo, entregues_pessoa, arquivos)
  SELECT v_dia, '', '', '',
         (SELECT count(*) FROM sp_pep_itens WHERE tipo = 'evidencia' AND removido_em IS NULL),
         (SELECT count(*) FROM sp_pep_itens WHERE tipo = 'evidencia' AND removido_em IS NULL AND status = 'confirmado' AND entregue_por = 'robo'),
         (SELECT count(*) FROM sp_pep_itens WHERE tipo = 'evidencia' AND removido_em IS NULL AND status = 'confirmado' AND entregue_por = 'humano'),
         (SELECT count(*) FROM sp_pep_arquivos WHERE removido_em IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_gravar_retrato() FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Lote do robô (igual ao de 20261001140000 + estado atual + freio)
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
  v_maquina    text := public.robo_autenticar(p_token);
  v_t0         timestamptz := clock_timestamp();
  v_exec       sp_pep_execucoes%ROWTYPE;
  v_novos      integer := 0;
  v_removidos  integer := 0;
  v_resumo     jsonb;
  v_resultado  jsonb;
  v_nao_vistos text[] := '{}';
  v_freio      jsonb;
  v_nv_itens   integer := 0;
  v_at_itens   integer := 0;
  v_nv_arq     integer := 0;
  v_at_arq     integer := 0;
  v_nv_pastas  integer := 0;
  v_at_pastas  integer := 0;
BEGIN
  SELECT * INTO v_exec FROM sp_pep_execucoes WHERE id = p_execucao_id AND maquina_id = v_maquina;
  IF NOT FOUND OR v_exec.status <> 'executando' THEN
    RAISE EXCEPTION 'execucao inexistente ou encerrada' USING ERRCODE = '22023';
  END IF;

  BEGIN
    -- O histórico das evidências guarda em que leitura cada coisa aconteceu.
    PERFORM set_config('pep.execucao', p_execucao_id::text, true);

    -- ── Pastas ──────────────────────────────────────────────────────────────
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

    -- ── Estado atual de todo arquivo (antes das sugestões: o histórico usa
    --    o tipo atual para dizer "deixou de ser evidência" × "sumiu") ─────────
    INSERT INTO sp_pep_arquivos AS a (
      sp_id, nome, caminho, web_url, tipo, motivo, sigla, prestador_pasta_id, paciente_pasta_id,
      tamanho, criado_em_sp, modificado_em_sp, criado_por, competencia, detalhe,
      primeira_execucao_id, ultima_execucao_id, visto_primeiro_em, visto_ultimo_em, removido_em, atualizado_em)
    SELECT x.sp_id, left(x.nome, 400), x.caminho, x.web_url, x.tipo, x.motivo, x.sigla,
           x.prestador_pasta_id, x.paciente_pasta_id, x.tamanho, x.criado_em, x.modificado_em,
           left(x.criado_por, 200), x.competencia, x.detalhe,
           p_execucao_id, p_execucao_id, now(), now(), NULL, now()
      FROM jsonb_to_recordset(COALESCE(p_arquivos, '[]'::jsonb)) AS x(
             sp_id text, nome text, caminho text, web_url text, tamanho bigint,
             criado_em timestamptz, modificado_em timestamptz, criado_por text,
             tipo text, motivo text, prestador_pasta_id text, paciente_pasta_id text, sigla text,
             competencia text, detalhe jsonb)
     WHERE x.sp_id IS NOT NULL AND x.nome IS NOT NULL
       AND x.tipo IN ('evidencia', 'planilha', 'ignorado', 'fora_padrao')
    ON CONFLICT (sp_id) DO UPDATE
       SET nome = EXCLUDED.nome, caminho = EXCLUDED.caminho, web_url = EXCLUDED.web_url,
           tipo = EXCLUDED.tipo, motivo = EXCLUDED.motivo, sigla = EXCLUDED.sigla,
           prestador_pasta_id = EXCLUDED.prestador_pasta_id, paciente_pasta_id = EXCLUDED.paciente_pasta_id,
           tamanho = EXCLUDED.tamanho, modificado_em_sp = EXCLUDED.modificado_em_sp,
           criado_em_sp = COALESCE(EXCLUDED.criado_em_sp, a.criado_em_sp),
           criado_por = COALESCE(EXCLUDED.criado_por, a.criado_por),
           competencia = EXCLUDED.competencia, detalhe = EXCLUDED.detalhe,
           ultima_execucao_id = EXCLUDED.ultima_execucao_id, visto_ultimo_em = now(),
           removido_em = NULL, atualizado_em = now();

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

    -- ── Freio: leitura completa que acha sumidos demais não apaga nada ──────
    -- (permissão revogada, biblioteca trocada, falha do Graph...). Mais de 10
    -- E mais de 15% do que existe, em evidências, arquivos ou pastas.
    IF p_final AND p_completo THEN
      SELECT count(*) FILTER (WHERE ultima_execucao_id IS DISTINCT FROM p_execucao_id), count(*)
        INTO v_nv_itens, v_at_itens
        FROM sp_pep_itens
       WHERE removido_em IS NULL
         AND (v_exec.escopo_pasta_id IS NULL OR prestador_pasta_id = v_exec.escopo_pasta_id);
      SELECT count(*) FILTER (WHERE ultima_execucao_id IS DISTINCT FROM p_execucao_id), count(*)
        INTO v_nv_arq, v_at_arq
        FROM sp_pep_arquivos
       WHERE removido_em IS NULL
         AND (v_exec.escopo_pasta_id IS NULL OR prestador_pasta_id = v_exec.escopo_pasta_id);
      IF v_exec.modo = 'producao' THEN
        SELECT count(*) FILTER (WHERE ultima_execucao_id IS DISTINCT FROM p_execucao_id), count(*)
          INTO v_nv_pastas, v_at_pastas FROM sp_pep_pastas;
      END IF;

      IF (v_nv_itens > 10 AND v_nv_itens > 0.15 * v_at_itens)
         OR (v_nv_arq > 10 AND v_nv_arq > 0.15 * v_at_arq)
         OR (v_nv_pastas > 10 AND v_nv_pastas > 0.15 * v_at_pastas) THEN
        v_freio := jsonb_build_object(
          'execucao_id', p_execucao_id, 'em', now(),
          'evidencias', v_nv_itens, 'evidencias_total', v_at_itens,
          'arquivos', v_nv_arq, 'arquivos_total', v_at_arq,
          'pastas', v_nv_pastas, 'pastas_total', v_at_pastas);
      END IF;

      IF v_exec.modo = 'producao' THEN
        UPDATE sp_pep_estado SET remocao_suspensa = v_freio WHERE id = 1;
      END IF;
    END IF;

    -- ── Removidos ───────────────────────────────────────────────────────────
    -- Explícitos (o Graph disse "apagado", ou deixou de ser evidência) sempre
    -- valem; os "não vistos" de uma leitura completa só sem o freio.
    WITH alvo AS (
      SELECT sp_id, false AS nao_visto FROM sp_pep_itens
       WHERE sp_id IN (SELECT jsonb_array_elements_text(COALESCE(p_arquivos_removidos, '[]'::jsonb)))
      UNION
      SELECT sp_id, true FROM sp_pep_itens
       WHERE p_final AND p_completo AND v_freio IS NULL
         AND ultima_execucao_id IS DISTINCT FROM p_execucao_id
         AND (v_exec.escopo_pasta_id IS NULL OR prestador_pasta_id = v_exec.escopo_pasta_id)
    ), marcados AS (
      UPDATE sp_pep_itens i
         SET status = CASE WHEN i.status IN ('sugerido', 'nao_reconhecido') THEN 'removido' ELSE i.status END,
             removido_em = now(), atualizado_em = now()
        FROM alvo
       WHERE i.sp_id = alvo.sp_id AND i.removido_em IS NULL
      RETURNING i.sp_id, alvo.nao_visto
    )
    SELECT count(*), COALESCE(array_agg(sp_id) FILTER (WHERE nao_visto), '{}')
      INTO v_removidos, v_nao_vistos FROM marcados;

    -- O mesmo no estado atual de todo arquivo. O que esta leitura viu (por
    -- exemplo, a evidência que virou "fora do PEP") não é apagado.
    UPDATE sp_pep_arquivos a
       SET removido_em = now(), atualizado_em = now()
     WHERE a.removido_em IS NULL
       AND a.ultima_execucao_id IS DISTINCT FROM p_execucao_id
       AND (a.sp_id IN (SELECT jsonb_array_elements_text(COALESCE(p_arquivos_removidos, '[]'::jsonb)))
            OR (p_final AND p_completo AND v_freio IS NULL
                AND (v_exec.escopo_pasta_id IS NULL OR a.prestador_pasta_id = v_exec.escopo_pasta_id)));

    IF p_final AND p_completo AND v_exec.modo = 'producao' AND v_freio IS NULL THEN
      DELETE FROM sp_pep_pastas WHERE ultima_execucao_id IS DISTINCT FROM p_execucao_id;
    END IF;

    -- Planilha apagada: o prestador deixa de "ter planilha" (só no fim, quando
    -- todas as partes já passaram; uma planilha nova no lote vence).
    IF p_final AND v_exec.modo = 'producao' THEN
      UPDATE sp_pep_prestadores pr
         SET planilha_sp_id = NULL, planilha_nome = NULL, planilha_web_url = NULL,
             avisos = array_append(array_remove(pr.avisos, 'planilha_apagada'), 'planilha_apagada'),
             atualizado_em = now()
        FROM sp_pep_arquivos a
       WHERE a.sp_id = pr.planilha_sp_id AND a.tipo = 'planilha' AND a.removido_em IS NOT NULL;
    END IF;

    -- ── Reconhecimento + padrão + entrega (só na última parte) ──────────────
    IF p_final THEN
      v_resumo := public.sp_pep_reavaliar();
      -- "Apareceu" é gravado antes do reconhecimento: completa com os nomes
      -- que ele acabou de achar (o histórico fica legível e filtrável).
      UPDATE sp_pep_evidencias_historico h
         SET prestador_nome = COALESCE(i.prestador_nome, h.prestador_nome),
             paciente_nome = COALESCE(i.paciente_nome, h.paciente_nome),
             situacao = i.status
        FROM sp_pep_itens i
       WHERE h.execucao_id = p_execucao_id AND h.evento = 'apareceu' AND i.sp_id = h.sp_id
         AND (i.prestador_nome IS NOT NULL OR i.paciente_nome IS NOT NULL);
      IF v_exec.modo = 'producao' THEN
        PERFORM public.sp_pep_gravar_retrato();
      END IF;
    ELSE
      v_resumo := '{}'::jsonb;
    END IF;

    v_resultado := v_resumo || jsonb_build_object(
      'novos', v_novos,
      'removidos', v_removidos,
      'simulado', p_simular,
      'remocao_suspensa', v_freio,
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

  -- Apagados nesta leitura: os que o Graph avisou e os que a leitura
  -- completa não encontrou mais (só os que o banco conhecia pelo nome).
  INSERT INTO sp_pep_execucao_arquivos (
    execucao_id, sp_id, nome, caminho, web_url, tipo, sigla, prestador_pasta_id, paciente_pasta_id, competencia)
  SELECT p_execucao_id, i.sp_id, i.nome, i.caminho, i.web_url, 'removido', i.sigla,
         i.prestador_pasta_id, i.paciente_pasta_id, i.competencia
    FROM sp_pep_itens i
   WHERE i.sp_id IN (SELECT jsonb_array_elements_text(COALESCE(p_arquivos_removidos, '[]'::jsonb)))
      OR i.sp_id = ANY (v_nao_vistos)
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
-- 5. O robô entrega — e a entrega acompanha a pasta
-- ═════════════════════════════════════════════════════════════════════════════
-- Igual à de 20261002100000, com três mudanças:
--   a. sem chave: roda sempre;
--   b. evidência entregue que sumiu, saiu da pasta do item ou deixou de ser
--      evidência perde a unidade — entrega do robô E de pessoa. Semestral:
--      sai só a evidência (o registro só some se ficar sem nenhuma).
--      Recorrente: a situação é recalculada contra o esperado;
--   c. mês liberado não muda: um aviso no histórico, uma vez.
CREATE OR REPLACE FUNCTION public.sp_pep_robo_entregar()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it        record;
  cat       pep_catalogo_itens%ROWTYPE;
  reg       pep_registros_entrega%ROWTYPE;
  plano     pep_planejamento_semestral%ROWTYPE;
  v_item    sp_pep_itens%ROWTYPE;
  v_chave   text;
  v_esp     integer;
  v_qtd     integer;
  v_evid    jsonb;
  v_nova    jsonb;
  v_reg_id  uuid;
  v_novo_pl uuid;
  v_inicio  text;
  v_obs     text;
  v_ent     integer := 0;
  v_obs_cnt jsonb := '{}'::jsonb;
  v_desf    integer := 0;
  v_mantidas integer := 0;
  v_saida   text;
  v_antes   integer;
  v_depois  integer;
  v_excluiu boolean;
  v_achou   boolean;
BEGIN
  PERFORM set_config('pep.ator', 'robo', true);

  -- ── A entrega acompanha a pasta ───────────────────────────────────────────
  FOR it IN
    SELECT i.* FROM sp_pep_itens i
     WHERE i.status = 'confirmado' AND i.registro_entrega_id IS NOT NULL
       AND (i.removido_em IS NOT NULL OR i.saiu_da_pasta_em IS NOT NULL)
     ORDER BY i.sp_id
  LOOP
    v_saida := CASE WHEN it.removido_em IS NOT NULL THEN 'arquivo_removido' ELSE 'saiu_da_pasta_do_item' END;
    SELECT * INTO v_item FROM sp_pep_itens WHERE sp_id = it.sp_id;

    SELECT * INTO reg FROM pep_registros_entrega WHERE id = it.registro_entrega_id FOR UPDATE;
    v_achou := FOUND;
    IF v_achou AND public.sp_pep_mes_liberado(reg.prestador_nome, reg.paciente_nome, reg.competencia) THEN
      IF NOT EXISTS (SELECT 1 FROM sp_pep_evidencias_historico h
                      WHERE h.sp_id = it.sp_id AND h.evento = 'mes_liberado_mantido'
                        AND h.em >= COALESCE(it.removido_em, it.saiu_da_pasta_em)) THEN
        PERFORM public.sp_pep_evento_evidencia('mes_liberado_mantido', v_item, v_item,
          jsonb_build_object('motivo', v_saida, 'competencia_liberada', reg.competencia));
      END IF;
      v_mantidas := v_mantidas + 1;
      CONTINUE;
    END IF;

    v_antes := NULL; v_depois := NULL; v_excluiu := false;
    IF v_achou THEN
      SELECT * INTO cat FROM pep_catalogo_itens WHERE id = reg.item_id;
      v_evid := COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(reg.evidencias, '[]'::jsonb)) e
                           WHERE NOT (COALESCE(e->>'sp_id' = it.sp_id, false)
                                      OR (e->>'sp_id' IS NULL AND COALESCE(e->>'caminho' = it.web_url, false)))),
                         '[]'::jsonb);
      v_antes := COALESCE(reg.quantidade_entregue, CASE WHEN reg.status = 'entregue' THEN 1 ELSE 0 END);

      IF reg.quantidade_entregue IS NULL THEN
        -- Semestral: sem outra evidência, a entrega deixa de existir.
        IF jsonb_array_length(v_evid) = 0 THEN
          DELETE FROM pep_registros_entrega WHERE id = reg.id;
          v_depois := 0; v_excluiu := true;
        ELSE
          UPDATE pep_registros_entrega SET evidencias = v_evid, updated_at = now() WHERE id = reg.id;
          v_depois := v_antes;
        END IF;
      ELSE
        v_esp := CASE WHEN cat.periodicidade = 'semanal' THEN public.pep_semanas_esperadas(reg.competencia)
                      ELSE COALESCE(cat.qtd_referencia_mes, 1) END;
        v_depois := greatest(reg.quantidade_entregue - 1, 0);
        IF v_depois = 0 AND jsonb_array_length(v_evid) = 0 THEN
          DELETE FROM pep_registros_entrega WHERE id = reg.id;
          v_excluiu := true;
        ELSE
          UPDATE pep_registros_entrega
             SET quantidade_entregue = v_depois, evidencias = v_evid,
                 status = CASE WHEN v_depois >= v_esp THEN 'entregue' ELSE 'pendente' END,
                 updated_at = now()
           WHERE id = reg.id;
        END IF;
      END IF;

      INSERT INTO pep_trilha_auditoria (tabela, registro_id, acao, prestador_nome, paciente_nome, competencia,
                                        antes, motivo, usuario_nome, ator, resumo)
      VALUES ('registro_entrega', reg.id::text, 'reverter', reg.prestador_nome, reg.paciente_nome, reg.competencia,
              to_jsonb(reg),
              CASE WHEN v_saida = 'arquivo_removido' THEN 'Evidência apagada do SharePoint'
                   ELSE 'Evidência saiu da pasta do item no SharePoint' END,
              'Robô SharePoint', 'robo',
              format('%s %s%s: o arquivo "%s" %s (entregue por %s; %s → %s)',
                     CASE WHEN v_excluiu THEN 'Entrega retirada' ELSE 'Unidade retirada' END,
                     COALESCE(it.sigla, cat.sigla),
                     CASE WHEN reg.paciente_nome IS NULL THEN '' ELSE ' de ' || reg.paciente_nome END,
                     it.nome,
                     CASE WHEN v_saida = 'arquivo_removido' THEN 'foi apagado do SharePoint' ELSE 'saiu da pasta do item' END,
                     CASE WHEN it.entregue_por = 'robo' THEN 'robô' ELSE 'pessoa' END,
                     v_antes, v_depois));

      INSERT INTO pep_apuracao_recalcular (prestador_nome, competencia)
      VALUES (reg.prestador_nome, reg.competencia) ON CONFLICT DO NOTHING;
    END IF;

    PERFORM public.sp_pep_evento_evidencia('entrega_desfeita', v_item, v_item,
      jsonb_build_object('motivo', v_saida, 'unidades_antes', v_antes, 'unidades_depois', v_depois,
                         'registro_excluido', v_excluiu, 'registro_ja_nao_existia', v_antes IS NULL));

    -- O gatilho do registro já soltou o arquivo do robô; este solta o de
    -- pessoa e diz por quê. Arquivo que continua no SharePoint (mudou de
    -- pasta) volta para a fila de reconhecimento.
    UPDATE sp_pep_itens
       SET status = CASE WHEN it.removido_em IS NOT NULL THEN 'removido' ELSE 'nao_reconhecido' END,
           registro_entrega_id = NULL, reprogramacao_criada_id = NULL, saiu_da_pasta_em = NULL,
           robo_obs = v_saida,
           entregue_por = CASE WHEN it.removido_em IS NOT NULL THEN it.entregue_por END,
           atualizado_em = now()
     WHERE sp_id = it.sp_id;
    v_desf := v_desf + 1;
  END LOOP;

  -- ── Entregas novas ────────────────────────────────────────────────────────
  FOR it IN
    SELECT i.* FROM sp_pep_itens i
     WHERE i.status = 'sugerido' AND i.padrao = 'ok' AND i.entregue_por IS NULL
       AND i.item_id IS NOT NULL AND i.prestador_nome IS NOT NULL
       AND i.competencia ~ '^\d{4}-\d{2}$' AND i.removido_em IS NULL
     ORDER BY i.competencia, i.criado_em_sp NULLS LAST, i.sp_id
  LOOP
    SELECT * INTO cat FROM pep_catalogo_itens WHERE id = it.item_id;
    v_obs := NULL; v_reg_id := NULL; v_novo_pl := NULL;
    v_nova := jsonb_build_object('caminho', COALESCE(it.web_url, it.caminho, it.nome), 'nome', it.nome,
                                 'origem', 'robo', 'sp_id', it.sp_id);

    IF public.sp_pep_mes_liberado(it.prestador_nome,
         CASE WHEN cat.tipo_registro = 'GERAL' THEN NULL ELSE it.paciente_nome END, it.competencia) THEN
      v_obs := 'mes_liberado';

    ELSIF cat.classe = 'recorrente' THEN
      v_chave := CASE WHEN cat.tipo_registro = 'GERAL' THEN '§GERAL§:' || it.prestador_nome ELSE it.paciente_nome END;
      v_esp := CASE WHEN cat.periodicidade = 'semanal' THEN public.pep_semanas_esperadas(it.competencia)
                    ELSE COALESCE(cat.qtd_referencia_mes, 1) END;
      SELECT * INTO reg FROM pep_registros_entrega
       WHERE chave_conflito = v_chave AND item_id = cat.id AND competencia = it.competencia FOR UPDATE;
      IF FOUND AND EXISTS (SELECT 1 FROM jsonb_array_elements(reg.evidencias) e
                            WHERE e->>'sp_id' = it.sp_id OR e->>'caminho' = it.web_url) THEN
        -- O arquivo já está no registro: quem o pôs lá é o dono da entrega.
        UPDATE sp_pep_itens
           SET status = 'confirmado', registro_entrega_id = reg.id, robo_obs = NULL, atualizado_em = now(),
               entregue_por = CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(reg.evidencias) e
                                                 WHERE (e->>'sp_id' = it.sp_id OR e->>'caminho' = it.web_url)
                                                   AND e->>'origem' = 'robo') THEN 'robo' ELSE 'humano' END
         WHERE sp_id = it.sp_id;
        CONTINUE;
      ELSE
        v_qtd := CASE WHEN FOUND THEN COALESCE(reg.quantidade_entregue, 0) ELSE 0 END;
        IF v_qtd >= v_esp THEN
          v_obs := 'excedente';
        ELSE
          -- Mesmo alinhamento da tela: uma evidência por unidade, na ordem.
          SELECT COALESCE(jsonb_agg(COALESCE(reg.evidencias -> (g - 1), '{"caminho": "", "nome": null}'::jsonb) ORDER BY g), '[]'::jsonb)
            INTO v_evid FROM generate_series(1, v_qtd) g;
          v_evid := v_evid || jsonb_build_array(v_nova);
          INSERT INTO pep_registros_entrega AS r (paciente_nome, paciente_cpf, prestador_nome, item_id, competencia,
                 status, quantidade_entregue, evidencias, entregue_em, updated_at)
          VALUES (CASE WHEN cat.tipo_registro = 'GERAL' THEN NULL ELSE it.paciente_nome END,
                  CASE WHEN cat.tipo_registro = 'GERAL' THEN NULL ELSE it.paciente_cpf END,
                  it.prestador_nome, cat.id, it.competencia,
                  CASE WHEN v_qtd + 1 >= v_esp THEN 'entregue' ELSE 'pendente' END,
                  v_qtd + 1, v_evid, CASE WHEN v_qtd + 1 >= v_esp THEN now() END, now())
          ON CONFLICT (chave_conflito, item_id, competencia) DO UPDATE
             SET quantidade_entregue = EXCLUDED.quantidade_entregue, evidencias = EXCLUDED.evidencias,
                 status = EXCLUDED.status, entregue_em = COALESCE(EXCLUDED.entregue_em, r.entregue_em),
                 updated_at = now()
          RETURNING r.id INTO v_reg_id;
        END IF;
      END IF;

    ELSE
      -- Semestral (sempre por paciente).
      SELECT * INTO plano FROM pep_planejamento_semestral
       WHERE paciente_nome = it.paciente_nome AND item_id = cat.id AND ativo LIMIT 1;
      IF NOT FOUND THEN
        v_obs := 'sem_planejamento';
      ELSE
        v_inicio := to_char(to_date(plano.competencia_planejada || '-01', 'YYYY-MM-DD') - interval '5 months', 'YYYY-MM');
        IF it.competencia < v_inicio THEN
          v_obs := 'fora_do_ciclo';
        ELSIF EXISTS (SELECT 1 FROM pep_registros_entrega
                       WHERE paciente_nome = it.paciente_nome AND item_id = cat.id
                         AND status = 'entregue' AND competencia >= v_inicio) THEN
          v_obs := 'ja_entregue_no_ciclo';
        ELSE
          INSERT INTO pep_registros_entrega AS r (paciente_nome, paciente_cpf, prestador_nome, item_id, competencia,
                 status, evidencias, data_entrega, entregue_em, updated_at)
          VALUES (it.paciente_nome, it.paciente_cpf, it.prestador_nome, cat.id, it.competencia,
                  'entregue', jsonb_build_array(v_nova), to_date(it.competencia || '-01', 'YYYY-MM-DD'), now(), now())
          ON CONFLICT (chave_conflito, item_id, competencia) DO UPDATE
             SET status = 'entregue', evidencias = r.evidencias || jsonb_build_array(v_nova),
                 data_entrega = COALESCE(r.data_entrega, EXCLUDED.data_entrega),
                 entregue_em = COALESCE(r.entregue_em, now()), updated_at = now()
          RETURNING r.id INTO v_reg_id;
          -- Entrega antecipada: próximo ciclo = mês entregue + 6 (mesma regra
          -- de registrarEntregaSemestral na tela).
          IF it.competencia < plano.competencia_planejada THEN
            UPDATE pep_planejamento_semestral SET ativo = false WHERE id = plano.id;
            INSERT INTO pep_planejamento_semestral (paciente_nome, paciente_cpf, prestador_nome, item_id,
                   competencia_planejada, data_planejada, origem, planejamento_anterior_id, motivo)
            VALUES (plano.paciente_nome, plano.paciente_cpf, it.prestador_nome, cat.id,
                    to_char(to_date(it.competencia || '-01', 'YYYY-MM-DD') + interval '6 months', 'YYYY-MM'),
                    (to_date(it.competencia || '-01', 'YYYY-MM-DD') + interval '6 months')::date,
                    'reprogramacao_antecipada', plano.id, 'Entrega antecipada registrada pelo robô SharePoint')
            RETURNING id INTO v_novo_pl;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_reg_id IS NULL THEN
      UPDATE sp_pep_itens SET robo_obs = v_obs WHERE sp_id = it.sp_id AND robo_obs IS DISTINCT FROM v_obs;
      IF v_obs IS NOT NULL THEN
        v_obs_cnt := jsonb_set(v_obs_cnt, ARRAY[v_obs], to_jsonb(COALESCE((v_obs_cnt->>v_obs)::int, 0) + 1));
      END IF;
      CONTINUE;
    END IF;

    UPDATE sp_pep_itens
       SET status = 'confirmado', entregue_por = 'robo', registro_entrega_id = v_reg_id,
           reprogramacao_criada_id = v_novo_pl, robo_obs = NULL,
           resolvido_por = NULL, resolvido_por_nome = 'Robô SharePoint', resolvido_em = now(), atualizado_em = now()
     WHERE sp_id = it.sp_id;

    INSERT INTO pep_trilha_auditoria (tabela, registro_id, acao, prestador_nome, paciente_nome, competencia,
                                      depois, motivo, usuario_nome, ator, resumo)
    SELECT 'registro_entrega', r.id::text, 'editar', r.prestador_nome, r.paciente_nome, r.competencia,
           to_jsonb(r), 'Entrega registrada pelo robô SharePoint', 'Robô SharePoint', 'robo',
           format('Robô entregou %s%s com o arquivo "%s"%s', cat.sigla,
                  CASE WHEN r.paciente_nome IS NULL THEN '' ELSE ' de ' || r.paciente_nome END, it.nome,
                  CASE WHEN v_novo_pl IS NULL THEN '' ELSE ' (entrega antecipada: próximo ciclo reprogramado)' END)
      FROM pep_registros_entrega r WHERE r.id = v_reg_id;

    INSERT INTO pep_apuracao_recalcular (prestador_nome, competencia)
    VALUES (it.prestador_nome, it.competencia) ON CONFLICT DO NOTHING;
    v_ent := v_ent + 1;
  END LOOP;

  PERFORM set_config('pep.ator', '', true);
  RETURN jsonb_build_object('ligada', true, 'entregues', v_ent, 'desfeitas_arquivo_apagado', v_desf,
                            'mantidas_mes_liberado', v_mantidas, 'nao_entregues', v_obs_cnt);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_robo_entregar() FROM PUBLIC, anon, authenticated;

-- A chave deixa de existir (decisão do usuário, 02/10/2026): fica ligada, e a
-- função antiga (front de antes desta migration) só confirma isso.
UPDATE public.sp_pep_estado SET entrega_automatica = true WHERE id = 1;

CREATE OR REPLACE FUNCTION public.sp_pep_definir_entrega_automatica(p_ligar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo AND u.role = 'admin') THEN
    RAISE EXCEPTION 'so administradores' USING ERRCODE = '42501';
  END IF;
  UPDATE sp_pep_estado SET entrega_automatica = true WHERE id = 1;
  RETURN jsonb_build_object('ligada', true, 'resultado', public.sp_pep_reavaliar());
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_definir_entrega_automatica(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_definir_entrega_automatica(boolean) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Freio: um admin confirma que os sumidos sumiram mesmo
-- ═════════════════════════════════════════════════════════════════════════════
-- Aplica as remoções que a leitura suspensa não aplicou: o que não foi visto
-- nela nem em nenhuma leitura depois dela.
CREATE OR REPLACE FUNCTION public.sp_pep_confirmar_remocoes_suspensas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_freio  jsonb;
  v_desde  timestamptz;
  v_n      integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo AND u.role = 'admin') THEN
    RAISE EXCEPTION 'so administradores confirmam remocoes' USING ERRCODE = '42501';
  END IF;
  SELECT remocao_suspensa INTO v_freio FROM sp_pep_estado WHERE id = 1 FOR UPDATE;
  IF v_freio IS NULL THEN
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'nada_suspenso');
  END IF;
  SELECT iniciado_em INTO v_desde FROM sp_pep_execucoes WHERE id = (v_freio->>'execucao_id')::uuid;
  IF v_desde IS NULL THEN
    UPDATE sp_pep_estado SET remocao_suspensa = NULL WHERE id = 1;
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'leitura_nao_encontrada');
  END IF;
  PERFORM set_config('pep.execucao', v_freio->>'execucao_id', true);

  WITH m AS (
    UPDATE sp_pep_itens i
       SET status = CASE WHEN i.status IN ('sugerido', 'nao_reconhecido') THEN 'removido' ELSE i.status END,
           removido_em = now(), atualizado_em = now()
     WHERE i.removido_em IS NULL
       AND NOT EXISTS (SELECT 1 FROM sp_pep_execucoes e WHERE e.id = i.ultima_execucao_id AND e.iniciado_em >= v_desde)
    RETURNING 1)
  SELECT count(*) INTO v_n FROM m;

  UPDATE sp_pep_arquivos a SET removido_em = now(), atualizado_em = now()
   WHERE a.removido_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM sp_pep_execucoes e WHERE e.id = a.ultima_execucao_id AND e.iniciado_em >= v_desde);

  DELETE FROM sp_pep_pastas p
   WHERE NOT EXISTS (SELECT 1 FROM sp_pep_execucoes e WHERE e.id = p.ultima_execucao_id AND e.iniciado_em >= v_desde);

  UPDATE sp_pep_estado SET remocao_suspensa = NULL WHERE id = 1;
  PERFORM public.sp_pep_reavaliar();
  PERFORM public.sp_pep_gravar_retrato();
  RETURN jsonb_build_object('aplicado', true, 'evidencias_removidas', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_confirmar_remocoes_suspensas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_confirmar_remocoes_suspensas() TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Leituras do painel: execução NULL = o que está na pasta agora
-- ═════════════════════════════════════════════════════════════════════════════

-- Os arquivos de uma leitura, ou (NULL) os que estão na pasta agora.
CREATE OR REPLACE FUNCTION public.sp_pep_arquivos_da_leitura(p_execucao_id uuid)
RETURNS TABLE (sp_id text, nome text, caminho text, web_url text, tipo text, motivo text, sigla text,
               prestador_pasta_id text, paciente_pasta_id text, criado_em_sp timestamptz, criado_por text)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a.sp_id, a.nome, a.caminho, a.web_url, a.tipo, a.motivo, a.sigla,
         a.prestador_pasta_id, a.paciente_pasta_id, a.criado_em_sp, a.criado_por
    FROM sp_pep_execucao_arquivos a
   WHERE p_execucao_id IS NOT NULL AND a.execucao_id = p_execucao_id
  UNION ALL
  SELECT a.sp_id, a.nome, a.caminho, a.web_url, a.tipo, a.motivo, a.sigla,
         a.prestador_pasta_id, a.paciente_pasta_id, a.criado_em_sp, a.criado_por
    FROM sp_pep_arquivos a
   WHERE p_execucao_id IS NULL AND a.removido_em IS NULL;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_arquivos_da_leitura(uuid) FROM PUBLIC, anon, authenticated;

-- Os arquivos que estão na pasta agora, com a situação de cada um no Pulsar.
-- Mesmas colunas de vw_sp_pep_arquivos_lidos (a lista do painel serve às duas).
CREATE OR REPLACE VIEW public.vw_sp_pep_arquivos_atuais
WITH (security_invoker = true) AS
SELECT NULL::uuid AS execucao_id, a.sp_id, a.nome, a.caminho, a.web_url, a.tipo, a.motivo, a.sigla,
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
       a.visto_primeiro_em,
       (a.visto_primeiro_em >= now() - interval '24 hours') AS novo,
       i.entregue_por,
       i.padrao,
       a.visto_ultimo_em
  FROM public.sp_pep_arquivos a
  LEFT JOIN public.sp_pep_itens i ON i.sp_id = a.sp_id
 WHERE a.removido_em IS NULL;

REVOKE ALL ON public.vw_sp_pep_arquivos_atuais FROM anon;
GRANT SELECT ON public.vw_sp_pep_arquivos_atuais TO authenticated;

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
  IF NOT (public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')) THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;

  WITH a AS (SELECT * FROM public.sp_pep_arquivos_da_leitura(p_execucao_id)),
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
    'estado_atual', p_execucao_id IS NULL,
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
  IF NOT (public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')) THEN
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
      FROM public.sp_pep_arquivos_da_leitura(p_execucao_id)
     WHERE tipo <> 'removido'
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
  IF NOT (public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')) THEN
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
            FROM public.sp_pep_arquivos_da_leitura(p_execucao_id) a
            LEFT JOIN sp_pep_itens i ON i.sp_id = a.sp_id
           WHERE a.tipo = 'evidencia'
           GROUP BY 1, 2, 3, 4) t), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Histórico para o gráfico: por dia ou por mês (Brasília)
-- ═════════════════════════════════════════════════════════════════════════════
-- Uma linha jsonb: a série (apareceram, sumiram, voltaram, mudaram, entregas
-- desfeitas e quantas evidências estavam na pasta), os totais do período e a
-- lista de prestadores do histórico (para o filtro).
CREATE OR REPLACE FUNCTION public.sp_pep_historico_evidencias(
  p_de date, p_ate date, p_grao text DEFAULT 'dia', p_prestadores text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v      jsonb;
  v_mes  boolean := p_grao = 'mes';
BEGIN
  IF NOT (public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')) THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;
  IF p_de IS NULL OR p_ate IS NULL OR p_ate < p_de OR p_ate - p_de > 3700 THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22023';
  END IF;

  WITH ev AS (
    SELECT h.*, (h.em AT TIME ZONE 'America/Sao_Paulo')::date AS dia
      FROM sp_pep_evidencias_historico h
     WHERE (h.em AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_de AND p_ate
       AND (p_prestadores IS NULL OR cardinality(p_prestadores) = 0 OR h.prestador_nome = ANY (p_prestadores))
  ),
  periodos AS (
    SELECT CASE WHEN v_mes THEN to_char(d, 'YYYY-MM') ELSE to_char(d, 'YYYY-MM-DD') END AS periodo,
           min(d)::date AS inicio, max(d)::date AS fim
      FROM generate_series(p_de, p_ate, interval '1 day') AS g(d)
     GROUP BY 1
  ),
  contas AS (
    SELECT CASE WHEN v_mes THEN to_char(dia, 'YYYY-MM') ELSE to_char(dia, 'YYYY-MM-DD') END AS periodo,
           count(*) FILTER (WHERE evento = 'apareceu')                                     AS apareceram,
           count(*) FILTER (WHERE evento IN ('sumiu', 'deixou_de_ser_evidencia'))          AS sumiram,
           count(*) FILTER (WHERE evento = 'voltou')                                       AS voltaram,
           count(*) FILTER (WHERE evento IN ('renomeou', 'moveu', 'saiu_do_padrao'))       AS mudaram,
           count(*) FILTER (WHERE evento = 'entrega_desfeita')                             AS entregas_desfeitas,
           count(*) FILTER (WHERE evento = 'mes_liberado_mantido')                         AS mantidas_mes_liberado
      FROM ev GROUP BY 1
  ),
  retrato AS (
    -- Total do dia (linha '') ou, com filtro, a soma dos prestadores escolhidos.
    SELECT r.dia, sum(r.evidencias)::int AS evidencias,
           sum(r.entregues_robo)::int AS entregues_robo, sum(r.entregues_pessoa)::int AS entregues_pessoa
      FROM sp_pep_retrato_diario r
     WHERE r.dia BETWEEN p_de AND p_ate
       AND CASE WHEN p_prestadores IS NULL OR cardinality(p_prestadores) = 0 THEN r.prestador_pasta_id = ''
                ELSE r.prestador_pasta_id <> '' AND r.prestador_nome = ANY (p_prestadores) END
     GROUP BY r.dia
  ),
  -- Dias com retrato e nenhuma linha do filtro = 0 (o robô olhou e não havia).
  dias_com_retrato AS (
    SELECT DISTINCT dia FROM sp_pep_retrato_diario WHERE prestador_pasta_id = '' AND dia BETWEEN p_de AND p_ate
  ),
  serie AS (
    SELECT p.periodo, p.inicio, p.fim,
           COALESCE(c.apareceram, 0) AS apareceram, COALESCE(c.sumiram, 0) AS sumiram,
           COALESCE(c.voltaram, 0) AS voltaram, COALESCE(c.mudaram, 0) AS mudaram,
           COALESCE(c.entregas_desfeitas, 0) AS entregas_desfeitas,
           COALESCE(c.mantidas_mes_liberado, 0) AS mantidas_mes_liberado,
           ult.dia AS retrato_dia,
           CASE WHEN ult.dia IS NULL THEN NULL ELSE COALESCE(rt.evidencias, 0) END AS na_pasta,
           CASE WHEN ult.dia IS NULL THEN NULL ELSE COALESCE(rt.entregues_robo, 0) END AS entregues_robo,
           CASE WHEN ult.dia IS NULL THEN NULL ELSE COALESCE(rt.entregues_pessoa, 0) END AS entregues_pessoa
      FROM periodos p
      LEFT JOIN contas c ON c.periodo = p.periodo
      LEFT JOIN LATERAL (SELECT max(d.dia) AS dia FROM dias_com_retrato d WHERE d.dia BETWEEN p.inicio AND p.fim) ult ON true
      LEFT JOIN retrato rt ON rt.dia = ult.dia
  )
  SELECT jsonb_build_object(
    'grao', CASE WHEN v_mes THEN 'mes' ELSE 'dia' END,
    'serie', COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'periodo', s.periodo, 'apareceram', s.apareceram, 'sumiram', s.sumiram, 'voltaram', s.voltaram,
               'mudaram', s.mudaram, 'entregas_desfeitas', s.entregas_desfeitas,
               'mantidas_mes_liberado', s.mantidas_mes_liberado,
               'na_pasta', s.na_pasta, 'entregues_robo', s.entregues_robo, 'entregues_pessoa', s.entregues_pessoa,
               'retrato_dia', s.retrato_dia) ORDER BY s.periodo) FROM serie s), '[]'::jsonb),
    'totais', (SELECT jsonb_build_object(
               'apareceram', count(*) FILTER (WHERE evento = 'apareceu'),
               'sumiram', count(*) FILTER (WHERE evento IN ('sumiu', 'deixou_de_ser_evidencia')),
               'voltaram', count(*) FILTER (WHERE evento = 'voltou'),
               'mudaram', count(*) FILTER (WHERE evento IN ('renomeou', 'moveu', 'saiu_do_padrao')),
               'entregas_desfeitas', count(*) FILTER (WHERE evento = 'entrega_desfeita'),
               'mantidas_mes_liberado', count(*) FILTER (WHERE evento = 'mes_liberado_mantido'),
               -- O padrão que o usuário quer enxergar: entrou e saiu rápido.
               'sumiram_em_ate_7_dias', count(*) FILTER (WHERE evento IN ('sumiu', 'deixou_de_ser_evidencia')
                                                           AND criado_em_sp IS NOT NULL AND em - criado_em_sp <= interval '7 days'),
               'sumiram_depois_de_entregues', count(*) FILTER (WHERE evento IN ('sumiu', 'deixou_de_ser_evidencia')
                                                                 AND situacao = 'confirmado'))
               FROM ev),
    'prestadores', COALESCE((SELECT jsonb_agg(n ORDER BY n) FROM (
                     SELECT DISTINCT prestador_nome n FROM sp_pep_evidencias_historico WHERE prestador_nome IS NOT NULL) t), '[]'::jsonb),
    'primeiro_retrato', (SELECT min(dia) FROM sp_pep_retrato_diario),
    'primeiro_evento', (SELECT min(em) FROM sp_pep_evidencias_historico)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_historico_evidencias(date, date, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_historico_evidencias(date, date, text, text[]) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. Ponto de partida
-- ═════════════════════════════════════════════════════════════════════════════
-- O estado atual nasce da última vez que cada arquivo foi lido (sem eventos:
-- o histórico começa daqui). Só quando a tabela está vazia.
INSERT INTO public.sp_pep_arquivos (
  sp_id, nome, caminho, web_url, tipo, motivo, sigla, prestador_pasta_id, paciente_pasta_id,
  tamanho, criado_em_sp, modificado_em_sp, criado_por, competencia, detalhe,
  primeira_execucao_id, ultima_execucao_id, visto_primeiro_em, visto_ultimo_em)
SELECT u.sp_id, u.nome, u.caminho, u.web_url, u.tipo, u.motivo, u.sigla, u.prestador_pasta_id, u.paciente_pasta_id,
       u.tamanho, u.criado_em_sp, u.modificado_em_sp, u.criado_por, u.competencia, u.detalhe,
       COALESCE(i.primeira_execucao_id, u.execucao_id), u.execucao_id,
       COALESCE(i.criado_em, u.iniciado_em), u.iniciado_em
  FROM (
    SELECT DISTINCT ON (a.sp_id) a.*, e.iniciado_em
      FROM public.sp_pep_execucao_arquivos a
      JOIN public.sp_pep_execucoes e ON e.id = a.execucao_id
     WHERE e.modo = 'producao' AND e.status = 'concluido'
     ORDER BY a.sp_id, e.iniciado_em DESC
  ) u
  LEFT JOIN public.sp_pep_itens i ON i.sp_id = u.sp_id
 WHERE u.tipo <> 'removido'
   AND (i.sp_id IS NULL OR i.removido_em IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.sp_pep_arquivos);

SELECT public.sp_pep_gravar_retrato();

-- O PostgREST passa a enxergar as tabelas, a view e as RPCs novas na hora.
NOTIFY pgrst, 'reload schema';
