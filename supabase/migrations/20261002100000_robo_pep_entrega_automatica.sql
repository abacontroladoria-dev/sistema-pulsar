-- Robô SharePoint → PEP: o robô ENTREGA, a pessoa desfaz. Padrão de nome.
--
-- Pedido do usuário (01/10/2026), plano "pasted-content-id-f7f1-soft-pine":
--
--   A. PADRÃO DE NOME. Até aqui, todo arquivo numa pasta de item contava como
--      entrega (o robô contou 4 PIC do Adrian/Aline porque havia 4 arquivos
--      na pasta, e nenhum era o PIC). Agora só conta quem segue o padrão:
--        Geral ........ SIGLA-NN-MMAAAA              STC-01-092026
--        Paciente ..... SIGLA-PACIENTE-MMAAAA        PIC-JOAO SILVA-092026
--        TAP .......... TAP-NN-PACIENTE-MMAAAA       TAP-01-JOAO SILVA-092026
--        Reprogramação  REP-SIGLA-PACIENTE-MMAAAA    REP-PIC-JOAO SILVA-092026
--      O nome do paciente no arquivo tem de ser COMPATÍVEL com o da pasta ou
--      do cadastro (sp_pep_nomes_compativeis: sem acento, abreviado vale,
--      primeiro nome igual). Repetidos (mesma chave) contam uma vez.
--      A leitura do nome é feita AQUI, sobre sp_pep_itens.nome — vale na hora
--      para todos os arquivos já lidos, sem reimplantar o robô nem reler o site.
--
--   B. ENTREGA AUTOMÁTICA. O arquivo reconhecido E no padrão vira entrega
--      sozinho (sp_pep_robo_entregar), com as mesmas regras da tela PEP:
--      mês liberado não muda; recorrente até a quantidade esperada; semestral
--      só com planejamento, e entrega antecipada reprograma +6 meses.
--      A origem fica presa à evidência ({origem:'robo', sp_id}); a pessoa
--      desfaz pelo botão, desmarcando a caixa ou excluindo — o gatilho
--      trg_pep_registro_robo_revertido marca o arquivo como 'revertido' em
--      qualquer desses caminhos, e o robô nunca o entrega de novo.
--
--   Índices: vw_pep_indices_robo (robô aprovou / pessoa aprovou / pessoa
--   desfez / padrão). Dinheiro: pep_apuracao_mensal.valor_robo/valor_humano,
--   gravados pela tela (apurarESalvarPEP).
--
-- ORDEM: esta migration NÃO liga nada. sp_pep_estado.entrega_automatica nasce
-- false: até o snippet ..._ATIVAR_entrega_automatica.sql, o robô continua só
-- sugerindo (o padrão de nome já aparece nos índices). Nenhuma mudança no robô.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Colunas
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sp_pep_itens
  ADD COLUMN IF NOT EXISTS nome_padrao             jsonb,
  ADD COLUMN IF NOT EXISTS padrao                  text,
  ADD COLUMN IF NOT EXISTS padrao_motivo           text,
  ADD COLUMN IF NOT EXISTS entregue_por            text,
  ADD COLUMN IF NOT EXISTS robo_obs                text,
  ADD COLUMN IF NOT EXISTS revertido_por           uuid REFERENCES public.usuarios(id),
  ADD COLUMN IF NOT EXISTS revertido_por_nome      text,
  ADD COLUMN IF NOT EXISTS revertido_em            timestamptz,
  ADD COLUMN IF NOT EXISTS revertido_motivo        text,
  ADD COLUMN IF NOT EXISTS reprogramacao_criada_id uuid;

ALTER TABLE public.sp_pep_itens DROP CONSTRAINT IF EXISTS sp_pep_itens_padrao_check;
ALTER TABLE public.sp_pep_itens ADD CONSTRAINT sp_pep_itens_padrao_check
  CHECK (padrao IS NULL OR padrao IN ('ok', 'fora', 'rep', 'duplicado'));
ALTER TABLE public.sp_pep_itens DROP CONSTRAINT IF EXISTS sp_pep_itens_entregue_por_check;
ALTER TABLE public.sp_pep_itens ADD CONSTRAINT sp_pep_itens_entregue_por_check
  CHECK (entregue_por IS NULL OR entregue_por IN ('robo', 'humano'));
ALTER TABLE public.sp_pep_itens DROP CONSTRAINT IF EXISTS sp_pep_itens_status_check;
ALTER TABLE public.sp_pep_itens ADD CONSTRAINT sp_pep_itens_status_check
  CHECK (status IN ('sugerido', 'nao_reconhecido', 'confirmado', 'ignorado', 'removido', 'revertido'));

COMMENT ON COLUMN public.sp_pep_itens.padrao IS
  'Nome do arquivo: ok (segue o padrão, pode virar entrega), fora (fere o padrão, motivo em padrao_motivo), rep (documento de reprogramação, só referência), duplicado (mesma chave de outro arquivo que já conta).';
COMMENT ON COLUMN public.sp_pep_itens.entregue_por IS
  'Quem transformou o arquivo em entrega: robo (sp_pep_robo_entregar) ou humano (tela PEP).';
COMMENT ON COLUMN public.sp_pep_itens.robo_obs IS
  'Por que o robô NÃO entregou um arquivo sugerido no padrão: mes_liberado, excedente, sem_planejamento, fora_do_ciclo, ja_entregue_no_ciclo. Ou arquivo_removido, quando ele desfez a própria entrega.';

-- Recorrente: quantas das unidades entregues são do robô. Mantido pelo
-- gatilho a partir de evidencias[].origem — nunca gravado à mão.
ALTER TABLE public.pep_registros_entrega
  ADD COLUMN IF NOT EXISTS quantidade_robo integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.pep_registros_entrega.quantidade_robo IS
  'Unidades entregues pelo robô (evidencias com origem=robo). Pessoa = quantidade_entregue − quantidade_robo. Semestral: 0 ou 1. Derivado por trigger.';

ALTER TABLE public.pep_trilha_auditoria
  ADD COLUMN IF NOT EXISTS ator text NOT NULL DEFAULT 'humano';
ALTER TABLE public.pep_trilha_auditoria DROP CONSTRAINT IF EXISTS pep_trilha_auditoria_ator_check;
ALTER TABLE public.pep_trilha_auditoria ADD CONSTRAINT pep_trilha_auditoria_ator_check
  CHECK (ator IN ('robo', 'humano'));
ALTER TABLE public.pep_trilha_auditoria DROP CONSTRAINT IF EXISTS pep_trilha_auditoria_acao_check;
ALTER TABLE public.pep_trilha_auditoria ADD CONSTRAINT pep_trilha_auditoria_acao_check
  CHECK (acao IN ('criar', 'editar', 'excluir', 'reverter'));

ALTER TABLE public.pep_apuracao_mensal
  ADD COLUMN IF NOT EXISTS valor_robo   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_humano numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.pep_apuracao_mensal.valor_robo IS
  'Parte do valor das entregas recorrentes creditada a unidades do robô: Σ min(robô, esperado) × peso/esperado × V.';
COMMENT ON COLUMN public.pep_apuracao_mensal.valor_humano IS
  'Parte creditada a unidades marcadas por pessoas: (V − ajuste_recorrentes_valor) − valor_robo.';

ALTER TABLE public.sp_pep_estado
  ADD COLUMN IF NOT EXISTS entrega_automatica          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrega_automatica_por_nome text,
  ADD COLUMN IF NOT EXISTS entrega_automatica_em       timestamptz;

-- Analistas cuja apuração ficou desatualizada por uma entrega do robô. A tela
-- PEP (Visão geral / analista) recalcula e apaga a linha.
CREATE TABLE IF NOT EXISTS public.pep_apuracao_recalcular (
  prestador_nome text        NOT NULL,
  competencia    text        NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prestador_nome, competencia)
);
ALTER TABLE public.pep_apuracao_recalcular ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pep_apuracao_recalcular_select ON public.pep_apuracao_recalcular;
CREATE POLICY pep_apuracao_recalcular_select ON public.pep_apuracao_recalcular
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.ativo AND u.role IN ('rp', 'admin', 'diretoria')));
DROP POLICY IF EXISTS pep_apuracao_recalcular_delete ON public.pep_apuracao_recalcular;
CREATE POLICY pep_apuracao_recalcular_delete ON public.pep_apuracao_recalcular
  FOR DELETE TO authenticated USING (public.sp_pep_pode_escrever());
REVOKE ALL ON public.pep_apuracao_recalcular FROM anon;
GRANT SELECT, DELETE ON public.pep_apuracao_recalcular TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Padrão de nome
-- ═════════════════════════════════════════════════════════════════════════════
-- Lê o nome do arquivo contra o padrão da sigla da PASTA. Devolve
-- {ok, rep, sigla, seq, paciente, competencia 'AAAA-MM', erro}. Não confere o
-- nome do paciente (isso depende da pasta e do cadastro — sp_pep_aplicar_padrao).
CREATE OR REPLACE FUNCTION public.sp_pep_ler_nome_padrao(p_nome text, p_sigla text, p_tipo_registro text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s    text := upper(COALESCE(p_sigla, ''));
  b    text;
  m    text[];
  t1   text;
  MES  constant text := '(0[1-9]|1[0-2])(20[0-9]{2})';
BEGIN
  -- Tira a extensão e uniformiza o separador ("PIC - JOAO" = "PIC-JOAO").
  b := regexp_replace(COALESCE(p_nome, ''), '\.[A-Za-z0-9]{1,5}$', '');
  b := btrim(regexp_replace(b, '\s*[-–—]\s*', '-', 'g'));

  m := regexp_match(b, '^REP-(PIC|RT|OE)-(.+)-' || MES || '$', 'i');
  IF m IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'rep', upper(m[1]) = s, 'sigla', upper(m[1]), 'seq', NULL,
      'paciente', btrim(m[2]), 'competencia', m[4] || '-' || m[3],
      'erro', CASE WHEN upper(m[1]) = s THEN NULL ELSE 'sigla_diferente_da_pasta' END);
  END IF;

  IF p_tipo_registro = 'GERAL' THEN
    m := regexp_match(b, '^(STC|ETC)-([0-9]{2})-' || MES || '$', 'i');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('ok', upper(m[1]) = s, 'rep', false, 'sigla', upper(m[1]), 'seq', m[2],
        'paciente', NULL, 'competencia', m[4] || '-' || m[3],
        'erro', CASE WHEN upper(m[1]) = s THEN NULL ELSE 'sigla_diferente_da_pasta' END);
    END IF;
    IF b ~* ('^(STC|ETC)-' || MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'geral_sem_sequencial');
    END IF;
  ELSIF s = 'TAP' THEN
    m := regexp_match(b, '^TAP-([0-9]{2})-(.+)-' || MES || '$', 'i');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'rep', false, 'sigla', 'TAP', 'seq', m[1],
        'paciente', btrim(m[2]), 'competencia', m[4] || '-' || m[3], 'erro', NULL);
    END IF;
    IF b ~* ('^TAP-(.+)-' || MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'tap_sem_sequencial');
    END IF;
  ELSE
    m := regexp_match(b, '^(TAP|TOP|PIC|RT|OE)-(.+)-' || MES || '$', 'i');
    IF m IS NOT NULL THEN
      RETURN jsonb_build_object('ok', upper(m[1]) = s, 'rep', false, 'sigla', upper(m[1]), 'seq', NULL,
        'paciente', btrim(m[2]), 'competencia', m[4] || '-' || m[3],
        'erro', CASE WHEN upper(m[1]) = s THEN NULL ELSE 'sigla_diferente_da_pasta' END);
    END IF;
  END IF;

  -- Não casou: diz o mais útil sobre o que está errado.
  t1 := upper(split_part(b, '-', 1));
  IF t1 IN ('STC', 'ETC', 'TAP', 'TOP', 'PIC', 'RT', 'OE', 'REP') THEN
    IF t1 <> s AND t1 <> 'REP' THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'sigla_diferente_da_pasta');
    END IF;
    IF b !~ (MES || '$') THEN
      RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'sem_competencia');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', false, 'rep', false, 'erro', 'formato_desconhecido');
END;
$$;
GRANT EXECUTE ON FUNCTION public.sp_pep_ler_nome_padrao(text, text, text) TO authenticated;

-- Aplica o padrão a todas as evidências e marca os repetidos. Idempotente.
CREATE OR REPLACE FUNCTION public.sp_pep_aplicar_padrao()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH lido AS (
    SELECT i.sp_id, i.status, i.prestador_pasta_id, i.paciente_pasta_id, i.sigla, i.criado_em_sp,
           public.sp_pep_ler_nome_padrao(i.nome, i.sigla, cat.tipo_registro) AS j,
           cat.tipo_registro, pa.nome AS pasta_nome, i.paciente_nome
      FROM sp_pep_itens i
      LEFT JOIN pep_catalogo_itens cat ON cat.sigla = i.sigla AND cat.ativo
      LEFT JOIN sp_pep_pastas pa ON pa.id = i.paciente_pasta_id
     WHERE i.tipo = 'evidencia'
  ), conferido AS (
    SELECT lido.*,
           (j->>'ok')::boolean
             AND (tipo_registro IS DISTINCT FROM 'POR_PACIENTE'
                  OR COALESCE(public.sp_pep_nomes_compativeis(j->>'paciente', pasta_nome), false)
                  OR COALESCE(public.sp_pep_nomes_compativeis(j->>'paciente', paciente_nome), false)) AS nome_ok
      FROM lido
  ), ranqueado AS (
    -- Repetidos: mesma pasta + sigla + mês + sequencial contam uma vez. Vence
    -- o que já é entrega; depois o mais antigo. Recalculado do zero a cada
    -- vez, então apagar o original devolve o repetido ao jogo.
    SELECT conferido.*,
           CASE WHEN nome_ok AND status IN ('sugerido', 'nao_reconhecido', 'confirmado') THEN
             row_number() OVER (
               PARTITION BY nome_ok AND status IN ('sugerido', 'nao_reconhecido', 'confirmado'),
                            prestador_pasta_id, COALESCE(paciente_pasta_id, '§'), sigla,
                            j->>'competencia', COALESCE(j->>'seq', '§')
               ORDER BY (status = 'confirmado') DESC, criado_em_sp NULLS LAST, sp_id)
           END AS rn
      FROM conferido
  ), decidido AS (
    SELECT sp_id, j,
           CASE
             WHEN (j->>'rep')::boolean THEN 'rep'
             WHEN nome_ok AND rn > 1 THEN 'duplicado'
             WHEN nome_ok THEN 'ok'
             ELSE 'fora'
           END AS padrao,
           CASE
             WHEN (j->>'rep')::boolean THEN NULL
             WHEN nome_ok AND rn > 1 THEN 'repetido'
             WHEN nome_ok THEN NULL
             WHEN NOT (j->>'ok')::boolean THEN COALESCE(j->>'erro', 'formato_desconhecido')
             ELSE 'paciente_diferente_da_pasta'
           END AS motivo
      FROM ranqueado
  )
  UPDATE sp_pep_itens i
     SET nome_padrao = d.j, padrao = d.padrao, padrao_motivo = d.motivo
    FROM decidido d
   WHERE i.sp_id = d.sp_id
     AND (i.nome_padrao, i.padrao, i.padrao_motivo) IS DISTINCT FROM (d.j, d.padrao, d.motivo);

  -- Fora do padrão por natureza (pasta errada etc.) não tem padrão de nome.
  UPDATE sp_pep_itens SET nome_padrao = NULL, padrao = NULL, padrao_motivo = NULL
   WHERE tipo <> 'evidencia' AND (padrao IS NOT NULL OR nome_padrao IS NOT NULL);

  RETURN (
    SELECT jsonb_build_object(
      'segue_padrao', count(*) FILTER (WHERE padrao = 'ok'),
      'fora_padrao',  count(*) FILTER (WHERE padrao = 'fora'),
      'duplicados',   count(*) FILTER (WHERE padrao = 'duplicado'),
      'reprogramacao', count(*) FILTER (WHERE padrao = 'rep'))
      FROM sp_pep_itens WHERE tipo = 'evidencia' AND status <> 'removido');
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_aplicar_padrao() FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Semanas esperadas (port de frontend/lib/remuneracao/semanasCompetencia.ts)
-- ═════════════════════════════════════════════════════════════════════════════
-- Override publicado em pep_calendario_competencias vence; senão, semana só
-- deixa de contar quando todos os dias úteis dela no mês são feriado integral.
-- Teto 4 (PRD §11). Tela e robô têm de dar o mesmo número.
CREATE OR REPLACE FUNCTION public.pep_semanas_esperadas(p_competencia text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT semanas_supervisao_estudo FROM pep_calendario_competencias WHERE competencia = p_competencia),
    (SELECT least(4, count(*) FILTER (WHERE feriados < uteis))::int
       FROM (
         SELECT date_trunc('week', d.dia)::date AS semana,
                count(*) AS uteis,
                count(f.data) AS feriados
           FROM generate_series(to_date(p_competencia || '-01', 'YYYY-MM-DD'),
                                (to_date(p_competencia || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day'),
                                interval '1 day') AS d(dia)
           LEFT JOIN feriados f ON f.data = d.dia::date AND f.tipo = 'integral'
          WHERE extract(isodow FROM d.dia) < 6
          GROUP BY 1
       ) s),
    4);
$$;
GRANT EXECUTE ON FUNCTION public.pep_semanas_esperadas(text) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Gatilhos em pep_registros_entrega
-- ═════════════════════════════════════════════════════════════════════════════

-- quantidade_robo sai das evidências; nunca passa da quantidade entregue.
CREATE OR REPLACE FUNCTION public.pep_registro_quantidade_robo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_robo integer;
  v_total integer;
BEGIN
  SELECT count(*) INTO v_robo
    FROM jsonb_array_elements(COALESCE(NEW.evidencias, '[]'::jsonb)) e
   WHERE e->>'origem' = 'robo';
  v_total := COALESCE(NEW.quantidade_entregue, CASE WHEN NEW.status = 'entregue' THEN 1 ELSE 0 END);
  NEW.quantidade_robo := least(v_robo, greatest(v_total, 0));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pep_registro_quantidade_robo ON public.pep_registros_entrega;
CREATE TRIGGER trg_pep_registro_quantidade_robo
  BEFORE INSERT OR UPDATE ON public.pep_registros_entrega
  FOR EACH ROW EXECUTE FUNCTION public.pep_registro_quantidade_robo();

-- Evidência do robô que SAIU do registro (botão Desfazer, caixa desmarcada,
-- caminho trocado ou registro excluído) = a pessoa desfez a entrega do robô.
-- Marca o arquivo 'revertido' (o robô nunca o entrega de novo) e desfaz a
-- reprogramação +6 meses que ele tinha criado. Quando quem tira é o próprio
-- robô (arquivo apagado do SharePoint), a sessão traz pep.ator = 'robo'.
CREATE OR REPLACE FUNCTION public.pep_registro_robo_revertido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saiu      text[];
  v_ator      text := COALESCE(NULLIF(current_setting('pep.ator', true), ''), 'humano');
  v_motivo    text := NULLIF(current_setting('pep.motivo', true), '');
  v_nome      text;
  r           record;
  v_ant       uuid;
BEGIN
  SELECT array_agg(e->>'sp_id') INTO v_saiu
    FROM jsonb_array_elements(COALESCE(OLD.evidencias, '[]'::jsonb)) e
   WHERE e->>'origem' = 'robo' AND e->>'sp_id' IS NOT NULL
     AND (TG_OP = 'DELETE' OR NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.evidencias, '[]'::jsonb)) n
            WHERE n->>'sp_id' = e->>'sp_id' AND n->>'origem' = 'robo'));
  IF v_saiu IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_ator = 'humano' THEN
    SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();
  END IF;

  FOR r IN
    SELECT sp_id, reprogramacao_criada_id FROM sp_pep_itens
     WHERE sp_id = ANY (v_saiu) AND entregue_por = 'robo' AND status = 'confirmado'
     FOR UPDATE
  LOOP
    -- Reprogramação criada pelo robô: some se ninguém entregou nela ainda, e
    -- o planejamento anterior volta a valer.
    IF r.reprogramacao_criada_id IS NOT NULL THEN
      SELECT planejamento_anterior_id INTO v_ant FROM pep_planejamento_semestral
       WHERE id = r.reprogramacao_criada_id AND ativo;
      IF FOUND THEN
        DELETE FROM pep_planejamento_semestral WHERE id = r.reprogramacao_criada_id;
        IF v_ant IS NOT NULL THEN
          UPDATE pep_planejamento_semestral SET ativo = true WHERE id = v_ant;
        END IF;
      END IF;
    END IF;

    IF v_ator = 'robo' THEN
      UPDATE sp_pep_itens
         SET status = 'removido', robo_obs = 'arquivo_removido', registro_entrega_id = NULL,
             reprogramacao_criada_id = NULL, atualizado_em = now()
       WHERE sp_id = r.sp_id;
    ELSE
      UPDATE sp_pep_itens
         SET status = 'revertido', registro_entrega_id = NULL, reprogramacao_criada_id = NULL,
             revertido_por = auth.uid(), revertido_por_nome = COALESCE(v_nome, 'Pessoa'),
             revertido_em = now(),
             revertido_motivo = COALESCE(v_motivo, CASE WHEN TG_OP = 'DELETE' THEN 'Entrega excluída na tela PEP'
                                                         ELSE 'Unidade desmarcada na tela PEP' END),
             atualizado_em = now()
       WHERE sp_id = r.sp_id;
    END IF;
  END LOOP;

  INSERT INTO pep_apuracao_recalcular (prestador_nome, competencia)
  VALUES (OLD.prestador_nome, OLD.competencia) ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_pep_registro_robo_revertido ON public.pep_registros_entrega;
CREATE TRIGGER trg_pep_registro_robo_revertido
  AFTER UPDATE OR DELETE ON public.pep_registros_entrega
  FOR EACH ROW EXECUTE FUNCTION public.pep_registro_robo_revertido();

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. O robô entrega
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sp_pep_mes_liberado(p_prestador text, p_paciente text, p_competencia text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pep_apuracao_mensal a
     WHERE a.competencia = p_competencia AND a.estado = 'liberado'
       AND (CASE WHEN p_paciente IS NULL THEN a.prestador_nome = p_prestador ELSE a.paciente_nome = p_paciente END));
$$;

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
BEGIN
  IF NOT COALESCE((SELECT entrega_automatica FROM sp_pep_estado WHERE id = 1), false) THEN
    RETURN jsonb_build_object('ligada', false);
  END IF;
  PERFORM set_config('pep.ator', 'robo', true);

  -- Arquivo que o robô entregou e sumiu do SharePoint: o robô desfaz a própria
  -- entrega (mês ainda aberto). Entrega de pessoa fica, como sempre ficou.
  FOR it IN
    SELECT i.* FROM sp_pep_itens i
     WHERE i.status = 'confirmado' AND i.entregue_por = 'robo' AND i.removido_em IS NOT NULL
       AND i.registro_entrega_id IS NOT NULL
  LOOP
    SELECT * INTO reg FROM pep_registros_entrega WHERE id = it.registro_entrega_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND OR public.sp_pep_mes_liberado(reg.prestador_nome, reg.paciente_nome, reg.competencia);
    v_evid := COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(reg.evidencias) e WHERE e->>'sp_id' IS DISTINCT FROM it.sp_id), '[]'::jsonb);
    IF reg.quantidade_entregue IS NULL THEN
      DELETE FROM pep_registros_entrega WHERE id = reg.id;            -- semestral
    ELSIF reg.quantidade_entregue <= 1 AND jsonb_array_length(v_evid) = 0 THEN
      DELETE FROM pep_registros_entrega WHERE id = reg.id;
    ELSE
      UPDATE pep_registros_entrega
         SET quantidade_entregue = greatest(reg.quantidade_entregue - 1, 0), evidencias = v_evid,
             status = 'pendente', updated_at = now()
       WHERE id = reg.id;
    END IF;
    INSERT INTO pep_trilha_auditoria (tabela, registro_id, acao, prestador_nome, paciente_nome, competencia,
                                      antes, motivo, usuario_nome, ator, resumo)
    VALUES ('registro_entrega', reg.id::text, 'reverter', reg.prestador_nome, reg.paciente_nome, reg.competencia,
            to_jsonb(reg), 'Arquivo apagado do SharePoint', 'Robô SharePoint', 'robo',
            format('Robô desfez %s: o arquivo "%s" foi apagado do SharePoint', it.sigla, it.nome));
    v_desf := v_desf + 1;
  END LOOP;

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
  RETURN jsonb_build_object('ligada', true, 'entregues', v_ent, 'desfeitas_arquivo_apagado', v_desf, 'nao_entregues', v_obs_cnt);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_robo_entregar() FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. sp_pep_reavaliar = reconhecer + padrão + entregar
-- ═════════════════════════════════════════════════════════════════════════════
-- A função de reconhecimento (20261001120000) fica intacta com outro nome;
-- quem chama sp_pep_reavaliar (lote do robô, vincular, reabrir) passa a
-- ganhar as duas etapas novas sem mudança nenhuma.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sp_pep_reavaliar_reconhecer'
                   AND pronamespace = 'public'::regnamespace) THEN
    ALTER FUNCTION public.sp_pep_reavaliar() RENAME TO sp_pep_reavaliar_reconhecer;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sp_pep_reavaliar_reconhecer() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sp_pep_reavaliar()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_resumo jsonb;
  v_padrao jsonb;
  v_entrega jsonb;
BEGIN
  v_resumo := public.sp_pep_reavaliar_reconhecer();
  v_padrao := public.sp_pep_aplicar_padrao();
  v_entrega := public.sp_pep_robo_entregar();
  RETURN COALESCE(v_resumo, '{}'::jsonb) || jsonb_build_object('padrao', v_padrao, 'entrega', v_entrega);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_reavaliar() FROM PUBLIC, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. RPCs da tela
-- ═════════════════════════════════════════════════════════════════════════════

-- Confirmar à mão passa a dizer QUEM entregou (pessoa = azul).
CREATE OR REPLACE FUNCTION public.sp_pep_resolver_item(
  p_sp_id                text,
  p_acao                 text,
  p_registro_entrega_id  uuid DEFAULT NULL,
  p_competencia          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item  sp_pep_itens%ROWTYPE;
  v_nome  text;
  v_comp  text;
BEGIN
  IF NOT public.sp_pep_pode_escrever() THEN
    RAISE EXCEPTION 'sem permissao para registrar entregas do PEP' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM sp_pep_itens WHERE sp_id = p_sp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sugestao nao encontrada' USING ERRCODE = '22023'; END IF;
  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();

  IF p_acao = 'confirmar' THEN
    v_comp := COALESCE(p_competencia, v_item.competencia);
    IF p_registro_entrega_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM pep_registros_entrega WHERE id = p_registro_entrega_id) THEN
      RAISE EXCEPTION 'registro de entrega inexistente' USING ERRCODE = '22023';
    END IF;
    IF public.sp_pep_mes_liberado(v_item.prestador_nome, v_item.paciente_nome, v_comp) THEN
      RAISE EXCEPTION 'competencia % ja liberada', v_comp USING ERRCODE = '22023';
    END IF;
    UPDATE sp_pep_itens
       SET status = 'confirmado', competencia = v_comp, registro_entrega_id = p_registro_entrega_id,
           entregue_por = 'humano', robo_obs = NULL,
           resolvido_por = auth.uid(), resolvido_por_nome = v_nome, resolvido_em = now(), atualizado_em = now()
     WHERE sp_id = p_sp_id;
  ELSIF p_acao = 'ignorar' THEN
    UPDATE sp_pep_itens
       SET status = 'ignorado', resolvido_por = auth.uid(), resolvido_por_nome = v_nome,
           resolvido_em = now(), atualizado_em = now()
     WHERE sp_id = p_sp_id;
  ELSIF p_acao = 'reabrir' THEN
    UPDATE sp_pep_itens
       SET status = 'nao_reconhecido', registro_entrega_id = NULL, resolvido_por = NULL,
           resolvido_por_nome = NULL, resolvido_em = NULL, entregue_por = NULL,
           revertido_por = NULL, revertido_por_nome = NULL, revertido_em = NULL, revertido_motivo = NULL,
           atualizado_em = now()
     WHERE sp_id = p_sp_id;
    PERFORM public.sp_pep_reavaliar();
  ELSE
    RAISE EXCEPTION 'acao invalida' USING ERRCODE = '22023';
  END IF;

  RETURN (SELECT to_jsonb(i) FROM sp_pep_itens i WHERE sp_id = p_sp_id);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_resolver_item(text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_resolver_item(text, text, uuid, text) TO authenticated;

-- "Desfazer" — tira a unidade do robô, com motivo obrigatório. O gatilho
-- marca o arquivo 'revertido' e desfaz a reprogramação que o robô criou.
CREATE OR REPLACE FUNCTION public.sp_pep_reverter_entrega_robo(p_sp_id text, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item sp_pep_itens%ROWTYPE;
  reg    pep_registros_entrega%ROWTYPE;
  cat    pep_catalogo_itens%ROWTYPE;
  v_evid jsonb;
  v_esp  integer;
  v_nome text;
BEGIN
  IF NOT public.sp_pep_pode_escrever() THEN
    RAISE EXCEPTION 'sem permissao para alterar entregas do PEP' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'informe o motivo' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM sp_pep_itens WHERE sp_id = p_sp_id FOR UPDATE;
  IF NOT FOUND OR v_item.entregue_por IS DISTINCT FROM 'robo' OR v_item.status <> 'confirmado' THEN
    RAISE EXCEPTION 'esta entrega nao foi feita pelo robo' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO reg FROM pep_registros_entrega WHERE id = v_item.registro_entrega_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registro de entrega nao encontrado' USING ERRCODE = '22023'; END IF;
  IF public.sp_pep_mes_liberado(reg.prestador_nome, reg.paciente_nome, reg.competencia) THEN
    RAISE EXCEPTION 'competencia % ja liberada', reg.competencia USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cat FROM pep_catalogo_itens WHERE id = reg.item_id;
  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();

  PERFORM set_config('pep.ator', 'humano', true);
  PERFORM set_config('pep.motivo', btrim(p_motivo), true);

  v_evid := COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(reg.evidencias) e
                       WHERE e->>'sp_id' IS DISTINCT FROM p_sp_id), '[]'::jsonb);
  IF cat.classe = 'semestral' OR reg.quantidade_entregue IS NULL THEN
    IF jsonb_array_length(v_evid) = 0 THEN
      DELETE FROM pep_registros_entrega WHERE id = reg.id;
    ELSE
      UPDATE pep_registros_entrega SET evidencias = v_evid, updated_at = now() WHERE id = reg.id;
    END IF;
  ELSE
    v_esp := CASE WHEN cat.periodicidade = 'semanal' THEN public.pep_semanas_esperadas(reg.competencia)
                  ELSE COALESCE(cat.qtd_referencia_mes, 1) END;
    IF reg.quantidade_entregue <= 1 AND jsonb_array_length(v_evid) = 0 THEN
      DELETE FROM pep_registros_entrega WHERE id = reg.id;
    ELSE
      UPDATE pep_registros_entrega
         SET quantidade_entregue = greatest(reg.quantidade_entregue - 1, 0), evidencias = v_evid,
             status = CASE WHEN reg.quantidade_entregue - 1 >= v_esp THEN 'entregue' ELSE 'pendente' END,
             updated_at = now()
       WHERE id = reg.id;
    END IF;
  END IF;

  INSERT INTO pep_trilha_auditoria (tabela, registro_id, acao, prestador_nome, paciente_nome, competencia,
                                    antes, motivo, usuario_id, usuario_nome, ator, resumo)
  VALUES ('registro_entrega', reg.id::text, 'reverter', reg.prestador_nome, reg.paciente_nome, reg.competencia,
          to_jsonb(reg), btrim(p_motivo), auth.uid(), v_nome, 'humano',
          format('%s desfez a entrega do robô: %s%s, arquivo "%s"', COALESCE(v_nome, 'Pessoa'), cat.sigla,
                 CASE WHEN reg.paciente_nome IS NULL THEN '' ELSE ' de ' || reg.paciente_nome END, v_item.nome));

  PERFORM set_config('pep.ator', '', true);
  PERFORM set_config('pep.motivo', '', true);
  RETURN (SELECT to_jsonb(i) FROM sp_pep_itens i WHERE sp_id = p_sp_id);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_reverter_entrega_robo(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_reverter_entrega_robo(text, text) TO authenticated;

-- Liga/desliga a entrega automática. Só admin. Ligar já roda a reavaliação
-- (é o "reprocessar o mês aberto" que o usuário escolheu).
CREATE OR REPLACE FUNCTION public.sp_pep_definir_entrega_automatica(p_ligar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
  v_res  jsonb := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = auth.uid() AND u.ativo AND u.role = 'admin') THEN
    RAISE EXCEPTION 'so administradores ligam ou desligam a entrega automatica' USING ERRCODE = '42501';
  END IF;
  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();
  INSERT INTO sp_pep_estado (id, entrega_automatica, entrega_automatica_por_nome, entrega_automatica_em)
  VALUES (1, p_ligar, v_nome, now())
  ON CONFLICT (id) DO UPDATE
     SET entrega_automatica = EXCLUDED.entrega_automatica,
         entrega_automatica_por_nome = EXCLUDED.entrega_automatica_por_nome,
         entrega_automatica_em = EXCLUDED.entrega_automatica_em;
  IF p_ligar THEN
    v_res := public.sp_pep_reavaliar();
  END IF;
  RETURN jsonb_build_object('ligada', p_ligar, 'por', v_nome, 'resultado', v_res);
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_definir_entrega_automatica(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_definir_entrega_automatica(boolean) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Índices (robô × pessoa × padrão), por competência e prestador
-- ═════════════════════════════════════════════════════════════════════════════
-- security_invoker: cada um vê só o que o RLS das tabelas de origem deixa.
CREATE OR REPLACE VIEW public.vw_pep_indices_robo
WITH (security_invoker = true) AS
WITH arq AS (
  SELECT i.competencia, i.prestador_nome,
         count(*) FILTER (WHERE i.entregue_por = 'robo')                                    AS robo_aprovou,
         count(*) FILTER (WHERE i.entregue_por = 'robo' AND i.status = 'confirmado')        AS robo_vigentes,
         count(*) FILTER (WHERE i.status = 'revertido')                                     AS humano_reverteu,
         count(*) FILTER (WHERE i.tipo = 'evidencia' AND i.padrao = 'ok')                   AS segue_padrao,
         count(*) FILTER (WHERE i.tipo = 'evidencia' AND i.padrao = 'fora')                 AS fora_padrao,
         count(*) FILTER (WHERE i.tipo = 'evidencia' AND i.padrao = 'duplicado')            AS duplicados,
         count(*) FILTER (WHERE i.tipo = 'evidencia' AND i.padrao = 'rep')                  AS reprogramacao
    FROM public.sp_pep_itens i
   WHERE i.status <> 'removido' AND i.prestador_nome IS NOT NULL AND i.competencia IS NOT NULL
   GROUP BY 1, 2
), reg AS (
  SELECT r.competencia, r.prestador_nome,
         sum(greatest(COALESCE(r.quantidade_entregue, CASE WHEN r.status = 'entregue' THEN 1 ELSE 0 END)
                      - r.quantidade_robo, 0))::int AS humano_aprovou,
         sum(r.quantidade_robo)::int                AS unidades_robo
    FROM public.pep_registros_entrega r
   GROUP BY 1, 2
)
SELECT COALESCE(a.competencia, g.competencia)       AS competencia,
       COALESCE(a.prestador_nome, g.prestador_nome) AS prestador_nome,
       COALESCE(a.robo_aprovou, 0)    AS robo_aprovou,
       COALESCE(a.robo_vigentes, 0)   AS robo_vigentes,
       COALESCE(a.humano_reverteu, 0) AS humano_reverteu,
       COALESCE(g.humano_aprovou, 0)  AS humano_aprovou,
       COALESCE(g.unidades_robo, 0)   AS unidades_robo,
       COALESCE(a.segue_padrao, 0)    AS segue_padrao,
       COALESCE(a.fora_padrao, 0)     AS fora_padrao,
       COALESCE(a.duplicados, 0)      AS duplicados,
       COALESCE(a.reprogramacao, 0)   AS reprogramacao
  FROM arq a
  FULL JOIN reg g ON g.competencia = a.competencia AND g.prestador_nome = a.prestador_nome;

REVOKE ALL ON public.vw_pep_indices_robo FROM anon;
GRANT SELECT ON public.vw_pep_indices_robo TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. Painel do robô: "Arquivos no SharePoint" por paciente conta só o padrão
-- ═════════════════════════════════════════════════════════════════════════════
-- Igual à versão de 20261001140000, com arquivos_por_sigla restrito a
-- padrao='ok' e um novo arquivos_fora_por_sigla.
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
  IF NOT (public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')) THEN
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
               -- Só o que CONTA: arquivo no padrão de nome (20261002100000).
               -- Antes contava todo arquivo da pasta (4 PIC do Adrian que não eram PIC).
               'arquivos_por_sigla', COALESCE((
                 SELECT jsonb_object_agg(s.sigla, s.n) FROM (
                   SELECT i.sigla, count(*) n FROM sp_pep_itens i
                    WHERE i.paciente_pasta_id = j.pasta_id AND i.status NOT IN ('removido', 'revertido')
                      AND i.sigla IS NOT NULL AND i.padrao = 'ok'
                    GROUP BY i.sigla) s), '{}'::jsonb),
               'arquivos_fora_por_sigla', COALESCE((
                 SELECT jsonb_object_agg(s.sigla, s.n) FROM (
                   SELECT i.sigla, count(*) n FROM sp_pep_itens i
                    WHERE i.paciente_pasta_id = j.pasta_id AND i.status <> 'removido'
                      AND i.sigla IS NOT NULL AND i.padrao IN ('fora', 'duplicado')
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

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. Leitura do robô liberada para quem usa a tela Entregas PEP
-- ═════════════════════════════════════════════════════════════════════════════
-- Pedido de 02/10/2026: "O que o robô encontrou no SharePoint" e "O que
-- precisa de você" saíram de /admin/robo-sharepoint para
-- /relacionamento-prestador/pep, que o RP usa. Pastas, prestadores, pacientes
-- e arquivos já eram legíveis com relacionamento_prestador_pep; faltavam as
-- execuções e o detalhe "Ver o que foi lido". Só LEITURA: nenhuma escrita muda
-- (vincular continua exigindo rp/admin; ligar a entrega, admin).

DROP POLICY IF EXISTS sp_pep_execucoes_select ON public.sp_pep_execucoes;
CREATE POLICY sp_pep_execucoes_select ON public.sp_pep_execucoes
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep'));

DROP POLICY IF EXISTS sp_pep_execucao_arquivos_select ON public.sp_pep_execucao_arquivos;
CREATE POLICY sp_pep_execucao_arquivos_select ON public.sp_pep_execucao_arquivos
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep'));

-- As quatro leituras do detalhe, iguais às de 20261001130000/140000, só com a
-- tranca ampliada.
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
  IF NOT (public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')) THEN
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
            FROM sp_pep_execucao_arquivos a
            LEFT JOIN sp_pep_itens i ON i.sp_id = a.sp_id
           WHERE a.execucao_id = p_execucao_id AND a.tipo = 'evidencia'
           GROUP BY 1, 2, 3, 4) t), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END;
$$;

-- Primeira passada do padrão de nome sobre o que já foi lido (não entrega
-- nada: a chave nasce desligada).
SELECT public.sp_pep_aplicar_padrao();
