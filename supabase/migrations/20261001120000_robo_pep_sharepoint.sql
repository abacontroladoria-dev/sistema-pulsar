-- Robô SharePoint → PEP (plano de 30/09/2026, docs/ESTUDO_ROBO_ASSIM_E_PEP_SHAREPOINT.md).
--
-- O robô (robo-pep-sharepoint/, container no Coolify) lê o repositório de
-- documentos dos prestadores no SharePoint, SÓ LEITURA, e manda o que viu para
-- cá. Este arquivo decide o que aquilo significa:
--
--   pasta de prestador → CNPJ da planilha → remuneracao_contratos
--   pasta de paciente  → aba "Pacientes" do MESMO prestador → CPF → cadastro
--   arquivo            → herda prestador/paciente + sessão "Coordenador de
--                        Caso" daquele prestador com aquele paciente no mês
--
-- e grava SUGESTÕES. Nada aqui escreve em pep_registros_entrega: quem confirma
-- é uma pessoa, na tela PEP, pelo mesmo caminho de sempre (RLS, trilha de
-- auditoria, bloqueio de mês liberado).
--
-- Identidade do robô: token por máquina em public.maquinas (robo_autenticar,
-- 20260813100200). Nunca service_role.
--
-- Custo: uma chamada em lote por execução (partes de 1000 arquivos), 3 vezes
-- ao dia. A conferência de Grade lê só as sessões "Coordenador de Caso" dos
-- meses que aparecem nas sugestões pendentes, pelo índice (data, unidade_id).
-- O tempo gasto aqui dentro volta ao robô (ms_banco) e aparece no painel.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Tabelas
-- ═════════════════════════════════════════════════════════════════════════════

-- Uma linha por execução. É o que o painel /admin/robo-sharepoint desenha ao
-- vivo (Realtime): etapa atual, linha do tempo e as métricas de custo.
CREATE TABLE IF NOT EXISTS public.sp_pep_execucoes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id          text        NOT NULL,
  gatilho             text        NOT NULL CHECK (gatilho IN ('agenda', 'manual', 'demo', 'inventario')),
  modo                text        NOT NULL CHECK (modo IN ('producao', 'homologacao', 'simulacao')),
  escopo_pasta_id     text,
  status              text        NOT NULL DEFAULT 'executando' CHECK (status IN ('executando', 'concluido', 'erro')),
  etapa_atual         text,
  -- [{etapa, status: executando|concluida|erro, inicio, duracao_ms, detalhe}]
  etapas              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- contagens do reconhecimento (sugeridos, nao_reconhecidos, motivos…)
  resumo              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- custo medido pelo robô (duracao_ms, chamadas_graph, chamadas_banco, ms_banco…)
  metricas            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  erro                text,
  versao              text,
  certificado         jsonb,
  solicitado_por_nome text,
  iniciado_em         timestamptz NOT NULL DEFAULT now(),
  concluido_em        timestamptz,
  duracao_ms          integer
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_execucoes_iniciado
  ON public.sp_pep_execucoes (iniciado_em DESC);

-- Estado da leitura incremental (delta do Graph). Linha única.
CREATE TABLE IF NOT EXISTS public.sp_pep_estado (
  id                          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  drive_id                    text,
  delta_link                  text,
  ultima_leitura_completa_em  timestamptz,
  atualizado_em               timestamptz NOT NULL DEFAULT now()
);

-- Árvore de PASTAS da biblioteca (arquivo não entra: o pai de todo arquivo é
-- uma pasta). O robô a recebe no começo de cada execução para montar o
-- caminho dos arquivos que o delta devolver.
CREATE TABLE IF NOT EXISTS public.sp_pep_pastas (
  id                  text        PRIMARY KEY,
  nome                text        NOT NULL,
  pai_id              text,
  papel               text        CHECK (papel IN ('prestador', 'paciente')),
  prestador_pasta_id  text,
  ultima_execucao_id  uuid,
  atualizado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_pastas_papel
  ON public.sp_pep_pastas (papel) WHERE papel IS NOT NULL;

-- Correções feitas por uma pessoa: "esta pasta é este prestador / paciente".
-- Vale acima de qualquer reconhecimento automático e sobrevive a renomear a
-- pasta (a chave é o id do SharePoint, não o nome).
CREATE TABLE IF NOT EXISTS public.sp_pep_vinculos (
  pasta_id            text        PRIMARY KEY,
  tipo                text        NOT NULL CHECK (tipo IN ('prestador', 'paciente')),
  prestador_nome      text,
  paciente_nome       text,
  paciente_cpf        text,
  definido_por        uuid        REFERENCES public.usuarios(id),
  definido_por_nome   text,
  definido_em         timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (tipo = 'prestador' AND prestador_nome IS NOT NULL)
    OR (tipo = 'paciente' AND paciente_nome IS NOT NULL)
  )
);

-- Uma linha por pasta de prestador, com o que a planilha de planejamento diz
-- dela e o resultado do reconhecimento.
CREATE TABLE IF NOT EXISTS public.sp_pep_prestadores (
  pasta_id                text        PRIMARY KEY,
  planilha_sp_id          text,
  planilha_nome           text,
  planilha_web_url        text,
  planilha_modificada_em  timestamptz,
  razao_social_planilha   text,
  cnpj                    text,
  cnpj_informado          boolean     NOT NULL DEFAULT false,
  -- [{nome, cpf, cpfInformado, cpfValido}] — aba "Pacientes"
  pacientes               jsonb,
  -- [{paciente, cpf, sigla, competencia, competenciaInformada}] — aba "Planejamento"
  planejamento            jsonb,
  avisos                  text[]      NOT NULL DEFAULT '{}',
  prestador_nome          text,
  status                  text        NOT NULL DEFAULT 'nao_reconhecido' CHECK (status IN ('reconhecido', 'nao_reconhecido')),
  motivo                  text,
  origem                  text        CHECK (origem IN ('cnpj', 'manual')),
  sinais                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  avaliado_em             timestamptz,
  atualizado_em           timestamptz NOT NULL DEFAULT now()
);

-- Uma linha por pasta de paciente (dentro de "3. Pacientes"), mesmo vazia.
CREATE TABLE IF NOT EXISTS public.sp_pep_pacientes (
  pasta_id            text        PRIMARY KEY,
  prestador_pasta_id  text,
  paciente_nome       text,
  paciente_cpf        text,
  tita_paciente_id    bigint,
  status              text        NOT NULL DEFAULT 'nao_reconhecido' CHECK (status IN ('reconhecido', 'nao_reconhecido')),
  motivo              text,
  origem              text        CHECK (origem IN ('cadastro', 'agenda', 'manual')),
  sinais              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  avaliado_em         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_pacientes_prestador
  ON public.sp_pep_pacientes (prestador_pasta_id);

-- Um arquivo de evidência (ou fora do padrão, para revisão). A chave é o id
-- do SharePoint: estável quando o arquivo é renomeado ou movido.
CREATE TABLE IF NOT EXISTS public.sp_pep_itens (
  sp_id                 text        PRIMARY KEY,
  nome                  text        NOT NULL,
  caminho               text,
  web_url               text,
  tamanho               bigint,
  e_tag                 text,
  criado_em_sp          timestamptz,
  modificado_em_sp      timestamptz,
  criado_por            text,
  modificado_por        text,
  tipo                  text        NOT NULL CHECK (tipo IN ('evidencia', 'fora_padrao')),
  motivo_classificacao  text,
  prestador_pasta_id    text,
  paciente_pasta_id     text,
  sigla                 text,
  item_id               uuid        REFERENCES public.pep_catalogo_itens(id),
  competencia           text,
  competencia_fonte     text        CHECK (competencia_fonte IN ('nome', 'envio')),
  prestador_nome        text,
  paciente_nome         text,
  paciente_cpf          text,
  status                text        NOT NULL DEFAULT 'nao_reconhecido'
                           CHECK (status IN ('sugerido', 'nao_reconhecido', 'confirmado', 'ignorado', 'removido')),
  motivo                text,
  sinais                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Sumiu do SharePoint. Sugestão pendente vira 'removido'; confirmada fica
  -- confirmada (a entrega já foi registrada), só ganha esta marca para o RP ver.
  removido_em           timestamptz,
  resolvido_por         uuid        REFERENCES public.usuarios(id),
  resolvido_por_nome    text,
  resolvido_em          timestamptz,
  registro_entrega_id   uuid,
  primeira_execucao_id  uuid,
  ultima_execucao_id    uuid,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sp_pep_itens_status
  ON public.sp_pep_itens (status);
CREATE INDEX IF NOT EXISTS idx_sp_pep_itens_prestador_comp
  ON public.sp_pep_itens (prestador_nome, competencia) WHERE status IN ('sugerido', 'confirmado');
CREATE INDEX IF NOT EXISTS idx_sp_pep_itens_paciente_pasta
  ON public.sp_pep_itens (paciente_pasta_id);
CREATE INDEX IF NOT EXISTS idx_sp_pep_itens_prestador_pasta
  ON public.sp_pep_itens (prestador_pasta_id);

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. RLS — leitura por permissão; escrita direta, ninguém
-- ═════════════════════════════════════════════════════════════════════════════
-- O painel (execuções, pastas, estado) é do código `robo_sharepoint`. As
-- sugestões também são lidas pela tela PEP (`relacionamento_prestador_pep`).
-- Toda escrita passa pelas funções abaixo (SECURITY DEFINER).

ALTER TABLE public.sp_pep_execucoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_estado      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_pastas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_vinculos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_prestadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_pacientes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sp_pep_itens       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sp_pep_execucoes_select ON public.sp_pep_execucoes;
CREATE POLICY sp_pep_execucoes_select ON public.sp_pep_execucoes
  FOR SELECT TO authenticated USING (public.usuario_tem_permissao('robo_sharepoint'));

DROP POLICY IF EXISTS sp_pep_estado_select ON public.sp_pep_estado;
CREATE POLICY sp_pep_estado_select ON public.sp_pep_estado
  FOR SELECT TO authenticated USING (public.usuario_tem_permissao('robo_sharepoint'));

DROP POLICY IF EXISTS sp_pep_pastas_select ON public.sp_pep_pastas;
CREATE POLICY sp_pep_pastas_select ON public.sp_pep_pastas
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')
  );

DROP POLICY IF EXISTS sp_pep_vinculos_select ON public.sp_pep_vinculos;
CREATE POLICY sp_pep_vinculos_select ON public.sp_pep_vinculos
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')
  );

DROP POLICY IF EXISTS sp_pep_prestadores_select ON public.sp_pep_prestadores;
CREATE POLICY sp_pep_prestadores_select ON public.sp_pep_prestadores
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')
  );

DROP POLICY IF EXISTS sp_pep_pacientes_select ON public.sp_pep_pacientes;
CREATE POLICY sp_pep_pacientes_select ON public.sp_pep_pacientes
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')
  );

DROP POLICY IF EXISTS sp_pep_itens_select ON public.sp_pep_itens;
CREATE POLICY sp_pep_itens_select ON public.sp_pep_itens
  FOR SELECT TO authenticated USING (
    public.usuario_tem_permissao('robo_sharepoint') OR public.usuario_tem_permissao('relacionamento_prestador_pep')
  );

REVOKE ALL ON public.sp_pep_execucoes, public.sp_pep_estado, public.sp_pep_pastas, public.sp_pep_vinculos,
              public.sp_pep_prestadores, public.sp_pep_pacientes, public.sp_pep_itens
  FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sp_pep_execucoes, public.sp_pep_estado, public.sp_pep_pastas, public.sp_pep_vinculos,
              public.sp_pep_prestadores, public.sp_pep_pacientes, public.sp_pep_itens
  FROM authenticated;
GRANT SELECT ON public.sp_pep_execucoes, public.sp_pep_estado, public.sp_pep_pastas, public.sp_pep_vinculos,
              public.sp_pep_prestadores, public.sp_pep_pacientes, public.sp_pep_itens
  TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. Reconhecimento
-- ═════════════════════════════════════════════════════════════════════════════

-- Nome da pasta × nome no cadastro. Pasta costuma abreviar ("Adrian Araújo" ×
-- "Adrian Araújo Nery"); por isso não é igualdade. Regra: o primeiro nome é o
-- mesmo E pelo menos 2/3 das palavras do nome MENOR aparecem no maior.
-- Partículas (de, da, do, dos, das, e) não contam.
CREATE OR REPLACE FUNCTION public.sp_pep_nomes_compativeis(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  WITH na AS (SELECT public.normalizar_nome_paciente(p_a) AS n),
       nb AS (SELECT public.normalizar_nome_paciente(p_b) AS n),
       ta AS (
         SELECT DISTINCT t FROM na, unnest(string_to_array(na.n, ' ')) t
          WHERE length(t) >= 2 AND t NOT IN ('de', 'da', 'do', 'das', 'dos', 'e')
       ),
       tb AS (
         SELECT DISTINCT t FROM nb, unnest(string_to_array(nb.n, ' ')) t
          WHERE length(t) >= 2 AND t NOT IN ('de', 'da', 'do', 'das', 'dos', 'e')
       ),
       c AS (
         SELECT (SELECT count(*) FROM ta) AS qa,
                (SELECT count(*) FROM tb) AS qb,
                (SELECT count(*) FROM ta WHERE t IN (SELECT t FROM tb)) AS comuns
       )
  SELECT COALESCE(
    (SELECT split_part(na.n, ' ', 1) = split_part(nb.n, ' ', 1) FROM na, nb)
    AND c.qa > 0 AND c.qb > 0
    AND c.comuns >= ceil(least(c.qa, c.qb) * 2.0 / 3),
    false)
  FROM c;
$$;

-- Reavalia tudo que ainda depende de reconhecimento: prestadores, pastas de
-- paciente e os arquivos PENDENTES (sugerido / nao_reconhecido). Confirmado e
-- ignorado são decisão de pessoa: não mudam. Interna (sem grant): chamada pelo
-- lote do robô e pelas correções manuais.
CREATE OR REPLACE FUNCTION public.sp_pep_reavaliar()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r              record;
  v_cpf          text;
  v_nome         text;
  v_tita         bigint;
  v_motivo       text;
  v_origem       text;
  v_qtd          integer;
  v_achou        boolean;
  v_informado    boolean;
  v_comp_min     date;
  v_comp_max     date;
  v_resumo       jsonb;
BEGIN
  -- ── Prestadores ────────────────────────────────────────────────────────────
  INSERT INTO sp_pep_prestadores (pasta_id)
  SELECT id FROM sp_pep_pastas WHERE papel = 'prestador'
  ON CONFLICT (pasta_id) DO NOTHING;

  DELETE FROM sp_pep_prestadores p
   WHERE NOT EXISTS (SELECT 1 FROM sp_pep_pastas pa WHERE pa.id = p.pasta_id AND pa.papel = 'prestador');

  UPDATE sp_pep_prestadores p
     SET prestador_nome = x.nome,
         status         = CASE WHEN x.nome IS NOT NULL AND x.motivo IS NULL THEN 'reconhecido' ELSE 'nao_reconhecido' END,
         motivo         = x.motivo,
         origem         = x.origem,
         sinais         = x.sinais,
         avaliado_em    = now()
    FROM (
      SELECT p2.pasta_id,
             COALESCE(v.prestador_nome, CASE WHEN c.qtd = 1 THEN c.nome END) AS nome,
             CASE
               WHEN v.prestador_nome IS NOT NULL THEN NULL
               WHEN p2.planilha_sp_id IS NULL      THEN 'planilha_ausente'
               WHEN p2.cnpj IS NULL AND p2.cnpj_informado THEN 'cnpj_invalido'
               WHEN p2.cnpj IS NULL                THEN 'cnpj_ausente'
               WHEN c.qtd = 0                      THEN 'cnpj_nao_cadastrado'
               WHEN c.qtd > 1                      THEN 'cnpj_duplicado'
             END AS motivo,
             CASE WHEN v.prestador_nome IS NOT NULL THEN 'manual' WHEN c.qtd = 1 THEN 'cnpj' END AS origem,
             jsonb_build_object(
               'cnpj_valido', p2.cnpj IS NOT NULL,
               'contratos_com_cnpj', c.qtd,
               'razao_social_confere',
                 public.normalizar_nome_paciente(substring(pa.nome FROM '\(([^()]+)\)\s*$'))
                   = public.normalizar_nome_paciente(p2.razao_social_planilha)
             ) AS sinais
        FROM sp_pep_prestadores p2
        JOIN sp_pep_pastas pa ON pa.id = p2.pasta_id
        LEFT JOIN sp_pep_vinculos v ON v.pasta_id = p2.pasta_id AND v.tipo = 'prestador'
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS qtd, min(rc.profissional_nome) AS nome
            FROM remuneracao_contratos rc
           WHERE p2.cnpj IS NOT NULL
             AND regexp_replace(COALESCE(rc.cnpj, ''), '\D', '', 'g') = p2.cnpj
        ) c ON true
    ) x
   WHERE p.pasta_id = x.pasta_id;

  -- ── Pastas de paciente ─────────────────────────────────────────────────────
  INSERT INTO sp_pep_pacientes (pasta_id, prestador_pasta_id)
  SELECT id, prestador_pasta_id FROM sp_pep_pastas WHERE papel = 'paciente'
  ON CONFLICT (pasta_id) DO UPDATE SET prestador_pasta_id = EXCLUDED.prestador_pasta_id;

  DELETE FROM sp_pep_pacientes p
   WHERE NOT EXISTS (SELECT 1 FROM sp_pep_pastas pa WHERE pa.id = p.pasta_id AND pa.papel = 'paciente');

  FOR r IN
    SELECT pp.pasta_id, pa.nome AS nome_pasta, pr.pacientes AS lista, pr.planilha_sp_id,
           v.paciente_nome AS v_nome, v.paciente_cpf AS v_cpf
      FROM sp_pep_pacientes pp
      JOIN sp_pep_pastas pa ON pa.id = pp.pasta_id
      LEFT JOIN sp_pep_prestadores pr ON pr.pasta_id = pp.prestador_pasta_id
      LEFT JOIN sp_pep_vinculos v ON v.pasta_id = pp.pasta_id AND v.tipo = 'paciente'
  LOOP
    v_cpf := NULL; v_nome := NULL; v_tita := NULL; v_motivo := NULL; v_origem := NULL;

    IF r.v_nome IS NOT NULL THEN
      v_nome := r.v_nome; v_cpf := r.v_cpf; v_origem := 'manual';
      IF v_cpf IS NOT NULL THEN
        SELECT tita_paciente_id INTO v_tita FROM pacientes WHERE cpf = v_cpf LIMIT 1;
      END IF;
    ELSIF r.planilha_sp_id IS NULL THEN
      v_motivo := 'planilha_ausente';
    ELSE
      v_achou := false;
      SELECT true, NULLIF(e->>'cpf', ''), COALESCE((e->>'cpfInformado')::boolean, false)
        INTO v_achou, v_cpf, v_informado
        FROM jsonb_array_elements(COALESCE(r.lista, '[]'::jsonb)) e
       WHERE public.normalizar_nome_paciente(e->>'nome') = public.normalizar_nome_paciente(r.nome_pasta)
       LIMIT 1;

      IF NOT COALESCE(v_achou, false) THEN
        v_motivo := 'paciente_fora_da_planilha';
      ELSIF v_cpf IS NULL THEN
        v_motivo := CASE WHEN v_informado THEN 'cpf_invalido' ELSE 'cpf_ausente' END;
      ELSE
        SELECT count(*)::int, min(nome), min(tita_paciente_id)
          INTO v_qtd, v_nome, v_tita
          FROM pacientes WHERE cpf = v_cpf;

        IF v_qtd > 1 THEN
          v_motivo := 'cpf_duplicado_no_pulsar'; v_nome := NULL; v_tita := NULL;
        ELSIF v_qtd = 1 THEN
          v_origem := 'cadastro';
        ELSE
          -- `pacientes` não recebe paciente novo do TiTa automaticamente
          -- (backfill único de 17/08). A agenda recebe: é o fallback, limitado
          -- aos últimos 6 meses pelo índice de data.
          SELECT a.paciente_nome, a.paciente_id INTO v_nome, v_tita
            FROM agenda_tita a
           WHERE a.data_atendimento >= current_date - 180
             AND regexp_replace(COALESCE(a.cpf, ''), '\D', '', 'g') = v_cpf
           ORDER BY a.data_atendimento DESC
           LIMIT 1;
          IF v_nome IS NULL THEN v_motivo := 'cpf_nao_encontrado'; ELSE v_origem := 'agenda'; END IF;
        END IF;

        IF v_motivo IS NULL AND NOT public.sp_pep_nomes_compativeis(r.nome_pasta, v_nome) THEN
          v_motivo := 'nome_divergente';
        END IF;
      END IF;
    END IF;

    UPDATE sp_pep_pacientes
       SET paciente_nome    = v_nome,
           paciente_cpf     = v_cpf,
           tita_paciente_id = v_tita,
           status           = CASE WHEN v_motivo IS NULL AND v_nome IS NOT NULL THEN 'reconhecido' ELSE 'nao_reconhecido' END,
           motivo           = v_motivo,
           origem           = v_origem,
           sinais           = jsonb_build_object(
                                'na_planilha', v_motivo IS DISTINCT FROM 'paciente_fora_da_planilha' AND v_motivo IS DISTINCT FROM 'planilha_ausente',
                                'cpf_valido', v_cpf IS NOT NULL,
                                'no_cadastro', v_nome IS NOT NULL,
                                'nome_compativel', v_nome IS NOT NULL AND v_motivo IS DISTINCT FROM 'nome_divergente'),
           avaliado_em      = now()
     WHERE pasta_id = r.pasta_id;
  END LOOP;

  -- ── Arquivos pendentes ─────────────────────────────────────────────────────
  -- Sessões "Coordenador de Caso" só dos meses que importam, lidas uma vez.
  SELECT min(to_date(competencia || '-01', 'YYYY-MM-DD')), max(to_date(competencia || '-01', 'YYYY-MM-DD'))
    INTO v_comp_min, v_comp_max
    FROM sp_pep_itens
   WHERE status IN ('sugerido', 'nao_reconhecido') AND competencia ~ '^\d{4}-\d{2}$';

  DROP TABLE IF EXISTS _sp_grade_cc;
  CREATE TEMP TABLE _sp_grade_cc ON COMMIT DROP AS
  SELECT DISTINCT g.profissional_nome, g.paciente_id,
         public.normalizar_nome_paciente(g.paciente_nome) AS paciente_norm,
         g.paciente_nome, to_char(g.data, 'YYYY-MM') AS competencia
    FROM csv_grades_profissionais g
   WHERE v_comp_min IS NOT NULL
     AND g.data >= v_comp_min
     AND g.data < (v_comp_max + interval '1 month')
     AND g.unidade_id = 280
     AND g.ativo
     AND g.terapia_nome = 'Coordenador de Caso';

  -- Sem este índice, cada arquivo varria TODAS as sessões do período e
  -- normalizava o nome em cada uma (arquivos × sessões). Com ele, cada arquivo
  -- olha só as sessões do seu prestador no seu mês — algumas dezenas.
  CREATE INDEX ON _sp_grade_cc (competencia, profissional_nome);
  ANALYZE _sp_grade_cc;

  WITH av AS (
    SELECT i.sp_id,
           pr.prestador_nome AS prest,
           pr.status AS prest_status,
           pr.motivo AS prest_motivo,
           pc.status AS pac_status,
           pc.motivo AS pac_motivo,
           pc.paciente_nome AS pac_nome,
           pc.paciente_cpf AS pac_cpf,
           pc.tita_paciente_id AS pac_tita,
           cat.id AS item_id,
           cat.tipo_registro,
           i.tipo, i.motivo_classificacao, i.competencia,
           g.paciente_nome AS grade_nome
      FROM sp_pep_itens i
      LEFT JOIN sp_pep_prestadores pr ON pr.pasta_id = i.prestador_pasta_id
      LEFT JOIN sp_pep_pacientes pc ON pc.pasta_id = i.paciente_pasta_id
      LEFT JOIN pep_catalogo_itens cat ON cat.sigla = i.sigla AND cat.ativo
      LEFT JOIN LATERAL (
        SELECT gc.paciente_nome FROM _sp_grade_cc gc
         WHERE gc.competencia = i.competencia
           AND gc.profissional_nome = pr.prestador_nome
           AND (gc.paciente_id = pc.tita_paciente_id
                OR gc.paciente_norm = public.normalizar_nome_paciente(pc.paciente_nome))
         LIMIT 1
      ) g ON true
     WHERE i.status IN ('sugerido', 'nao_reconhecido')
  ),
  decisao AS (
    SELECT av.*,
           CASE
             WHEN tipo = 'fora_padrao'                 THEN COALESCE(motivo_classificacao, 'fora_padrao')
             WHEN item_id IS NULL                      THEN 'item_desconhecido'
             WHEN prest_status IS DISTINCT FROM 'reconhecido' THEN COALESCE(prest_motivo, 'prestador_nao_reconhecido')
             WHEN competencia IS NULL                  THEN 'competencia_indefinida'
             WHEN tipo_registro = 'GERAL'              THEN NULL
             WHEN pac_status IS DISTINCT FROM 'reconhecido' THEN COALESCE(pac_motivo, 'paciente_nao_reconhecido')
             WHEN grade_nome IS NULL                   THEN 'sem_sessao_cc_no_mes'
           END AS motivo_final
      FROM av
  )
  UPDATE sp_pep_itens i
     SET item_id        = d.item_id,
         prestador_nome = d.prest,
         -- O nome gravado é o da GRADE: é a chave que a tela PEP usa.
         paciente_nome  = CASE WHEN d.tipo_registro = 'GERAL' THEN NULL ELSE COALESCE(d.grade_nome, d.pac_nome) END,
         paciente_cpf   = CASE WHEN d.tipo_registro = 'GERAL' THEN NULL ELSE d.pac_cpf END,
         status         = CASE WHEN d.motivo_final IS NULL THEN 'sugerido' ELSE 'nao_reconhecido' END,
         motivo         = d.motivo_final,
         sinais         = jsonb_build_object(
                            'prestador', d.prest_status = 'reconhecido',
                            'paciente', CASE WHEN d.tipo_registro = 'GERAL' THEN NULL ELSE d.pac_status = 'reconhecido' END,
                            'sessao_cc_no_mes', CASE WHEN d.tipo_registro = 'GERAL' THEN NULL ELSE d.grade_nome IS NOT NULL END),
         atualizado_em  = now()
    FROM decisao d
   WHERE i.sp_id = d.sp_id
     AND (i.status, i.motivo, i.prestador_nome, i.paciente_nome, i.item_id, i.sinais)
         IS DISTINCT FROM
         (CASE WHEN d.motivo_final IS NULL THEN 'sugerido' ELSE 'nao_reconhecido' END, d.motivo_final, d.prest,
          CASE WHEN d.tipo_registro = 'GERAL' THEN NULL ELSE COALESCE(d.grade_nome, d.pac_nome) END, d.item_id,
          jsonb_build_object(
            'prestador', d.prest_status = 'reconhecido',
            'paciente', CASE WHEN d.tipo_registro = 'GERAL' THEN NULL ELSE d.pac_status = 'reconhecido' END,
            'sessao_cc_no_mes', CASE WHEN d.tipo_registro = 'GERAL' THEN NULL ELSE d.grade_nome IS NOT NULL END));

  -- ── Resumo (o que o painel e o inventário mostram) ─────────────────────────
  SELECT jsonb_build_object(
    'prestadores_total',        (SELECT count(*) FROM sp_pep_prestadores),
    'prestadores_reconhecidos', (SELECT count(*) FROM sp_pep_prestadores WHERE status = 'reconhecido'),
    'pacientes_total',          (SELECT count(*) FROM sp_pep_pacientes),
    'pacientes_reconhecidos',   (SELECT count(*) FROM sp_pep_pacientes WHERE status = 'reconhecido'),
    'sugeridos',                (SELECT count(*) FROM sp_pep_itens WHERE status = 'sugerido'),
    'nao_reconhecidos',         (SELECT count(*) FROM sp_pep_itens WHERE status = 'nao_reconhecido'),
    'confirmados',              (SELECT count(*) FROM sp_pep_itens WHERE status = 'confirmado'),
    'motivos', COALESCE((
      SELECT jsonb_object_agg(motivo, n) FROM (
        SELECT motivo, count(*) AS n FROM (
          SELECT motivo FROM sp_pep_prestadores WHERE status = 'nao_reconhecido'
          UNION ALL SELECT motivo FROM sp_pep_pacientes WHERE status = 'nao_reconhecido'
          UNION ALL SELECT motivo FROM sp_pep_itens WHERE status = 'nao_reconhecido'
        ) m WHERE motivo IS NOT NULL GROUP BY motivo
      ) t), '{}'::jsonb)
  ) INTO v_resumo;

  RETURN v_resumo;
END;
$$;

REVOKE ALL ON FUNCTION public.sp_pep_reavaliar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sp_pep_nomes_compativeis(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_nomes_compativeis(text, text) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. RPCs do robô (token por máquina, grant só para anon)
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.robo_pep_iniciar_execucao(
  p_token               text,
  p_gatilho             text,
  p_modo                text,
  p_versao              text,
  p_escopo_pasta_id     text,
  p_certificado         jsonb,
  p_solicitado_por_nome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_maquina text := public.robo_autenticar(p_token);
  v_id      uuid;
  v_estado  sp_pep_estado%ROWTYPE;
BEGIN
  -- Execução presa (container reiniciado no meio): fecha como erro, para o
  -- painel não mostrar "executando" para sempre.
  UPDATE sp_pep_execucoes
     SET status = 'erro', erro = 'interrompida (o robô reiniciou antes de concluir)',
         concluido_em = now(), duracao_ms = (extract(epoch FROM now() - iniciado_em) * 1000)::int
   WHERE maquina_id = v_maquina AND status = 'executando';

  INSERT INTO sp_pep_execucoes (maquina_id, gatilho, modo, escopo_pasta_id, versao, certificado, solicitado_por_nome)
  VALUES (v_maquina, p_gatilho, p_modo, p_escopo_pasta_id, left(p_versao, 40), p_certificado, left(p_solicitado_por_nome, 120))
  RETURNING id INTO v_id;

  UPDATE maquinas SET last_seen = now(), app_version = left(p_versao, 40), updated_at = now()
   WHERE id = v_maquina;

  SELECT * INTO v_estado FROM sp_pep_estado WHERE id = 1;

  RETURN jsonb_build_object(
    'execucao_id', v_id,
    -- Homologação e simulação não usam nem avançam o delta de produção.
    'delta_link', CASE WHEN p_modo = 'producao' THEN v_estado.delta_link END,
    'drive_id',   CASE WHEN p_modo = 'producao' THEN v_estado.drive_id END,
    'pastas', CASE WHEN p_modo = 'producao' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'pai_id', pai_id)) FROM sp_pep_pastas
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.robo_pep_registrar_etapa(
  p_token        text,
  p_execucao_id  uuid,
  p_etapa        text,
  p_status       text,
  p_duracao_ms   integer,
  p_detalhe      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_maquina text := public.robo_autenticar(p_token);
BEGIN
  IF p_status = 'iniciada' THEN
    UPDATE sp_pep_execucoes
       SET etapa_atual = p_etapa,
           etapas = etapas || jsonb_build_array(jsonb_build_object(
                      'etapa', p_etapa, 'status', 'executando', 'inicio', now()))
     WHERE id = p_execucao_id AND maquina_id = v_maquina;
  ELSE
    UPDATE sp_pep_execucoes e
       SET etapa_atual = CASE WHEN p_status = 'erro' THEN p_etapa ELSE NULL END,
           etapas = (
             SELECT COALESCE(jsonb_agg(
                      CASE WHEN x->>'etapa' = p_etapa AND x->>'status' = 'executando'
                           THEN x || jsonb_build_object(
                                  'status', CASE WHEN p_status = 'erro' THEN 'erro' ELSE 'concluida' END,
                                  'duracao_ms', p_duracao_ms, 'detalhe', p_detalhe)
                           ELSE x END ORDER BY ord), '[]'::jsonb)
               FROM jsonb_array_elements(e.etapas) WITH ORDINALITY AS t(x, ord))
     WHERE id = p_execucao_id AND maquina_id = v_maquina;
  END IF;
END;
$$;

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

    -- ── Arquivos ────────────────────────────────────────────────────────────
    -- Arquivo que volta alterado (mesmo sp_id) atualiza os metadados; o status
    -- só é recalculado se ainda estava pendente. Confirmado/ignorado ficam.
    WITH entrada AS (
      SELECT * FROM jsonb_to_recordset(COALESCE(p_arquivos, '[]'::jsonb)) AS x(
        sp_id text, nome text, caminho text, web_url text, tamanho bigint, e_tag text,
        criado_em timestamptz, modificado_em timestamptz, criado_por text, modificado_por text,
        tipo text, motivo text, prestador_pasta_id text, paciente_pasta_id text, sigla text,
        competencia text, competencia_fonte text)
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
             -- competência corrigida por uma pessoa na confirmação não volta atrás
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
      -- Leitura completa: quem não veio nela deixou de existir. Em homologação,
      -- só dentro da pasta de teste.
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

    -- ── Reconhecimento ──────────────────────────────────────────────────────
    -- Só na última parte: com vários lotes, reconhecer a cada um repetiria o
    -- trabalho sobre tudo o que já chegou. Assim cada chamada fica curta —
    -- importa porque o Supabase corta chamada do papel anon em poucos segundos.
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
      -- Desfaz tudo o que este bloco gravou; só a execução (fora do bloco)
      -- e o resultado calculado sobrevivem.
      RAISE EXCEPTION USING ERRCODE = 'PSIM1', MESSAGE = v_resultado::text;
    END IF;
  EXCEPTION WHEN SQLSTATE 'PSIM1' THEN
    v_resultado := SQLERRM::jsonb;
  END;

  -- Estado do delta só avança em produção, na última parte, de verdade.
  IF p_final AND NOT p_simular AND v_exec.modo = 'producao' THEN
    INSERT INTO sp_pep_estado (id, drive_id, delta_link, ultima_leitura_completa_em, atualizado_em)
    VALUES (1, p_drive_id, p_delta_link, CASE WHEN p_completo THEN now() END, now())
    ON CONFLICT (id) DO UPDATE
       SET drive_id = EXCLUDED.drive_id,
           delta_link = COALESCE(EXCLUDED.delta_link, sp_pep_estado.delta_link),
           ultima_leitura_completa_em = COALESCE(EXCLUDED.ultima_leitura_completa_em, sp_pep_estado.ultima_leitura_completa_em),
           atualizado_em = now();
  END IF;

  v_resultado := jsonb_set(v_resultado, '{ms_banco}',
                   to_jsonb(round(extract(epoch FROM clock_timestamp() - v_t0) * 1000)));
  UPDATE sp_pep_execucoes SET resumo = v_resultado WHERE id = p_execucao_id;
  RETURN v_resultado;
END;
$$;

CREATE OR REPLACE FUNCTION public.robo_pep_finalizar_execucao(
  p_token        text,
  p_execucao_id  uuid,
  p_status       text,
  p_erro         text,
  p_metricas     jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_maquina text := public.robo_autenticar(p_token);
BEGIN
  IF p_status NOT IN ('concluido', 'erro') THEN
    RAISE EXCEPTION 'status invalido' USING ERRCODE = '22023';
  END IF;
  UPDATE sp_pep_execucoes
     SET status = p_status,
         erro = left(p_erro, 1000),
         metricas = COALESCE(p_metricas, '{}'::jsonb),
         etapa_atual = NULL,
         concluido_em = now(),
         duracao_ms = COALESCE((p_metricas->>'duracao_ms')::int, (extract(epoch FROM now() - iniciado_em) * 1000)::int)
   WHERE id = p_execucao_id AND maquina_id = v_maquina AND status = 'executando';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.robo_pep_iniciar_execucao(text, text, text, text, text, jsonb, text) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.robo_pep_registrar_etapa(text, uuid, text, text, integer, jsonb) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.robo_pep_registrar_lote(text, uuid, text, text, boolean, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.robo_pep_finalizar_execucao(text, uuid, text, text, jsonb) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.robo_pep_iniciar_execucao(text, text, text, text, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.robo_pep_registrar_etapa(text, uuid, text, text, integer, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.robo_pep_registrar_lote(text, uuid, text, text, boolean, boolean, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.robo_pep_finalizar_execucao(text, uuid, text, text, jsonb) TO anon;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. RPCs de quem usa (tela PEP e painel)
-- ═════════════════════════════════════════════════════════════════════════════
-- Mesmo critério de escrita das tabelas pep_* (rp/admin, 20260807120000).

CREATE OR REPLACE FUNCTION public.sp_pep_pode_escrever()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios u
     WHERE u.id = auth.uid() AND u.ativo = true AND u.role IN ('rp', 'admin')
  );
$$;
REVOKE ALL ON FUNCTION public.sp_pep_pode_escrever() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_pode_escrever() TO authenticated;

-- Confirmar (depois que a tela gravou a entrega pelo caminho de sempre),
-- ignorar, ou reabrir uma decisão.
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
    -- Segunda tranca do mês liberado (a primeira é a tela): a entrega já foi
    -- recusada pela tela se o mês estava liberado; aqui só não marca a
    -- sugestão como confirmada num mês que não aceita mais alteração.
    IF EXISTS (
      SELECT 1 FROM pep_apuracao_mensal a
       WHERE a.competencia = v_comp AND a.estado = 'liberado'
         AND a.paciente_nome IS NOT DISTINCT FROM v_item.paciente_nome
         AND (v_item.paciente_nome IS NOT NULL OR a.prestador_nome = v_item.prestador_nome)
    ) THEN
      RAISE EXCEPTION 'competencia % ja liberada' , v_comp USING ERRCODE = '22023';
    END IF;
    UPDATE sp_pep_itens
       SET status = 'confirmado', competencia = v_comp, registro_entrega_id = p_registro_entrega_id,
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
           resolvido_por_nome = NULL, resolvido_em = NULL, atualizado_em = now()
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

-- "Esta pasta é este prestador / paciente" (fila de não reconhecidos).
-- p_prestador_nome / p_paciente_nome nulos = desfazer o vínculo manual.
CREATE OR REPLACE FUNCTION public.sp_pep_vincular_pasta(
  p_pasta_id        text,
  p_tipo            text,
  p_prestador_nome  text DEFAULT NULL,
  p_paciente_nome   text DEFAULT NULL,
  p_paciente_cpf    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome text;
BEGIN
  IF NOT public.sp_pep_pode_escrever() THEN
    RAISE EXCEPTION 'sem permissao' USING ERRCODE = '42501';
  END IF;
  IF p_tipo NOT IN ('prestador', 'paciente') THEN
    RAISE EXCEPTION 'tipo invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sp_pep_pastas WHERE id = p_pasta_id AND papel = p_tipo) THEN
    RAISE EXCEPTION 'pasta nao encontrada' USING ERRCODE = '22023';
  END IF;
  SELECT nome INTO v_nome FROM usuarios WHERE id = auth.uid();

  IF (p_tipo = 'prestador' AND p_prestador_nome IS NULL) OR (p_tipo = 'paciente' AND p_paciente_nome IS NULL) THEN
    DELETE FROM sp_pep_vinculos WHERE pasta_id = p_pasta_id;
  ELSE
    INSERT INTO sp_pep_vinculos (pasta_id, tipo, prestador_nome, paciente_nome, paciente_cpf, definido_por, definido_por_nome)
    VALUES (p_pasta_id, p_tipo, p_prestador_nome, p_paciente_nome,
            NULLIF(regexp_replace(COALESCE(p_paciente_cpf, ''), '\D', '', 'g'), ''), auth.uid(), v_nome)
    ON CONFLICT (pasta_id) DO UPDATE
       SET tipo = EXCLUDED.tipo, prestador_nome = EXCLUDED.prestador_nome, paciente_nome = EXCLUDED.paciente_nome,
           paciente_cpf = EXCLUDED.paciente_cpf, definido_por = EXCLUDED.definido_por,
           definido_por_nome = EXCLUDED.definido_por_nome, definido_em = now();
  END IF;

  RETURN public.sp_pep_reavaliar();
END;
$$;
REVOKE ALL ON FUNCTION public.sp_pep_vincular_pasta(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_pep_vincular_pasta(text, text, text, text, text) TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Realtime — só as duas tabelas pequenas que o painel e a PEP escutam
-- ═════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sp_pep_execucoes') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sp_pep_execucoes;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sp_pep_itens') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.sp_pep_itens;
    END IF;
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Permissão da tela /admin/robo-sharepoint
-- ═════════════════════════════════════════════════════════════════════════════
-- Nasce sem grupo: admin enxerga por ser admin. Liberar para o grupo Diretoria
-- só DEPOIS da validação (há pessoas da diretoria que não devem ver telas em
-- desenvolvimento) — /admin/permissoes → Por grupo → Diretoria.
INSERT INTO public.permissoes (codigo, nome, grupo, rota, ordem)
VALUES ('robo_sharepoint', 'Robô SharePoint', 'Administração', '/admin/robo-sharepoint', 475)
ON CONFLICT (codigo) DO UPDATE SET nome = EXCLUDED.nome, grupo = EXCLUDED.grupo, rota = EXCLUDED.rota, ordem = EXCLUDED.ordem;
