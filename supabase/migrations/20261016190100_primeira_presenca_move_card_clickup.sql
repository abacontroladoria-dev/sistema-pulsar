-- =============================================================================
-- A 1ª presença do paciente move o card dele no ClickUp
-- =============================================================================
-- Na lista de entrada de pacientes do ClickUp (901113721794) o card de cada
-- paciente novo espera em 'AGENDAMENTO CONCLUÍDO' até ele vir à primeira sessão,
-- e alguém o arrasta à mão. A presença já está no Pulsar: é a linha de
-- fila_autorizacoes que a recepção conclui (botão "Presença" da /solicitar,
-- completion_type='presenca') ou que o robô conclui ao autorizar na ASSIM
-- ('automated' — a ASSIM exige o beneficiário no balcão, então também é
-- presença). As duas contam.
--
-- O DESENHO É POR VARREDURA, NÃO POR TRIGGER
--
-- O vínculo card↔paciente é o NOME (não há id do Pulsar no card). Com trigger,
-- toda conclusão da clínica — centenas por dia, quase todas de paciente antigo —
-- iria para uma outbox só para descobrir, no ClickUp, que não há card. Ao
-- contrário: os cards parados em 'AGENDAMENTO CONCLUÍDO' são poucos. O cron lê
-- esses cards (1-2 GETs), e o banco responde quais deles já tiveram a 1ª sessão.
-- Nada encosta na transação da recepção nem do robô, e um card cujo paciente
-- ainda não veio simplesmente volta a ser olhado na rodada seguinte.
--
-- "1ª PRESENÇA" É LITERAL: a sessão concluída mais antiga do paciente precisa
-- estar dentro de janela_dias. Paciente que já era atendido antes (ex.: segundo
-- processo de quem já faz ABA) NÃO move o card — vira 'ja_atendido_antes' no
-- registro, para alguém decidir à mão.
--
-- O DESTINO DEPENDE DA TERAPIA DO 1º DIA (critério do comercial, 16/10/2026):
--   'Atendimento Realizado' — entrevista familiar, avaliação inicial,
--     acolhimento, consulta médica, avaliações neuropsicológica e
--     neuropsicopedagógica, consulta avulsa das especialidades;
--   'Tratamento Iniciado'   — todas as demais.
-- No TiTa esses nomes viram terapias_atendimento_realizado (abaixo): entrevista/
-- avaliação inicial/acolhimento chegam como 'Operações Clínicas' (2279, ver
-- 20261013120000) ou 'Triagem'; consulta médica como 'Psiquiatra/Neurologista'.
-- Se o 1º dia tiver qualquer terapia FORA da lista, o tratamento começou.
-- "Consulta avulsa" não tem nome próprio no TiTa — é uma sessão comum da
-- especialidade — e por isso cai em 'Tratamento Iniciado'.
--
-- NASCE EM SIMULAÇÃO (simulacao = true): casa os nomes e registra em
-- presenca_clickup_movimentos qual card moveria e para onde, sem mexer em card.
-- É o ensaio do casamento por nome antes de ele mexer em card de verdade.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Config (linha única)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.presenca_clickup_config (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo           boolean NOT NULL DEFAULT false,
  clickup_list_id text    NOT NULL DEFAULT '901113721794',
  -- true = só registra o que faria. Desligar é o que põe a automação para valer.
  simulacao       boolean NOT NULL DEFAULT true,
  -- Status como aparecem no ClickUp; a comparação ignora caixa.
  status_origem                text NOT NULL DEFAULT 'AGENDAMENTO CONCLUÍDO',
  status_atendimento_realizado text NOT NULL DEFAULT 'Atendimento Realizado',
  status_tratamento_iniciado   text NOT NULL DEFAULT 'Tratamento Iniciado',
  -- terapia_nome (TiTa) que levam a 'Atendimento Realizado'. Comparado por
  -- normalizar_nome_terapia, então acento e caixa não importam.
  terapias_atendimento_realizado text[] NOT NULL DEFAULT ARRAY[
    'Operações Clínicas', 'Triagem', 'Psiquiatra/Neurologista',
    'Avaliação Neuropsicológica', 'Avaliação Neuropsicopedagógica'],
  -- Idade máxima da 1ª sessão concluída. Também é o recorte de busca: só quem
  -- teve sessão concluída nestes dias é candidato a casar com um card.
  janela_dias     int     NOT NULL DEFAULT 7 CHECK (janela_dias BETWEEN 1 AND 60),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.presenca_clickup_config IS
  'Move o card do paciente no ClickUp na 1ª presença, para Atendimento Realizado ou Tratamento Iniciado conforme a terapia do 1º dia. simulacao=true só registra. Token nos secrets da Edge Function primeira-presenca-clickup.';

INSERT INTO public.presenca_clickup_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.presenca_clickup_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presenca_clickup_config FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Registro do que foi feito (ou seria, em simulação)
-- ─────────────────────────────────────────────────────────────────────────────
-- Uma linha por (card, resultado). A rodada seguinte que chega ao mesmo
-- resultado só atualiza atualizado_em — sem isso a simulação gravaria o mesmo
-- card a cada 5 min. 'movido' tira o card do status de origem, então não repete.
CREATE TABLE IF NOT EXISTS public.presenca_clickup_movimentos (
  id                bigserial PRIMARY KEY,
  clickup_task_id   text NOT NULL,
  cartao_nome       text,
  resultado         text NOT NULL CHECK (resultado IN (
                      'movido', 'simulado', 'ja_atendido_antes',
                      'varios_cartoes', 'nome_ambiguo', 'erro')),
  paciente_id       text,          -- id TiTa (fila_autorizacoes.paciente_id)
  paciente_nome     text,
  primeira_presenca date,
  fila_id           uuid,
  casamento         text,          -- 'exato' | 'inicio_do_nome'
  terapias_primeiro_dia text,      -- o que decidiu o destino
  status_destino    text,
  erro              text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_presenca_clickup_mov
  ON public.presenca_clickup_movimentos (clickup_task_id, resultado);

COMMENT ON TABLE public.presenca_clickup_movimentos IS
  'O que a automação da 1ª presença fez com cada card: movido, simulado, ou por que não moveu (ja_atendido_antes, varios_cartoes, nome_ambiguo, erro).';

ALTER TABLE public.presenca_clickup_movimentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.presenca_clickup_movimentos FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O casamento card -> paciente -> 1ª presença
-- ─────────────────────────────────────────────────────────────────────────────
-- Recebe [{"id": task_id, "nome": nome do card}] e devolve só os cards que
-- casaram com alguém. Card sem ninguém = paciente ainda não veio (o normal).
--
-- O nome segue as regras já medidas no Painel de Entrada (20261015130000), que
-- lê cards desta mesma rotina: tira o sufixo "(ABA)"/"(Neuro)" do fim; casa por
-- igualdade normalizada; se não casar, aceita o nome do card como COMEÇO do nome
-- da sessão, com 3+ palavras. Casa contra fila_autorizacoes.paciente_nome (e não
-- contra pacientes) porque paciente novo pode ter sessão antes de o cadastro
-- canônico importá-lo.
--
-- destino: 'atendimento_realizado' se TODA terapia do 1º dia está em
-- p_terapias_atendimento; senão 'tratamento_iniciado'. terapia_nome pode ser
-- "A + B" (sessão com mais de uma), por isso é quebrado no '+'.
CREATE OR REPLACE FUNCTION public.presenca_clickup_casar(
  p_cartoes jsonb, p_janela_dias int, p_terapias_atendimento text[])
RETURNS TABLE (
  clickup_task_id   text,
  cartao_nome       text,
  resultado         text,
  paciente_id       text,
  paciente_nome     text,
  primeira_presenca date,
  fila_id           uuid,
  casamento         text,
  terapias_primeiro_dia text,
  destino           text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje,
           greatest(coalesce(p_janela_dias, 7), 1) AS janela
  ),
  cartoes AS (
    SELECT c->>'id' AS task_id,
           c->>'nome' AS nome,
           public.normalizar_nome_paciente(
             regexp_replace(c->>'nome', '\s*\([^)]*\)\s*$', '')) AS chave
      FROM jsonb_array_elements(coalesce(p_cartoes, '[]'::jsonb)) c
     WHERE coalesce(c->>'id', '') <> ''
  ),
  -- Candidatos: quem teve sessão concluída na janela (idx_fila_data).
  recentes AS (
    SELECT DISTINCT f.paciente_id,
           public.normalizar_nome_paciente(f.paciente_nome) AS chave
      FROM public.fila_autorizacoes f, params p
     WHERE f.data_atendimento BETWEEN p.hoje - p.janela AND p.hoje
       AND f.status IN ('concluido', 'concluido_sem_guia')
       AND f.paciente_nome IS NOT NULL
  ),
  exatos AS (
    SELECT c.task_id, r.paciente_id, 'exato'::text AS casamento
      FROM cartoes c
      JOIN recentes r ON r.chave = c.chave
  ),
  aprox AS (
    SELECT c.task_id, r.paciente_id, 'inicio_do_nome'::text AS casamento
      FROM cartoes c
      JOIN recentes r ON r.chave LIKE c.chave || ' %'
     WHERE NOT EXISTS (SELECT 1 FROM exatos e WHERE e.task_id = c.task_id)
       AND coalesce(array_length(string_to_array(c.chave, ' '), 1), 0) >= 3
  ),
  casados AS (
    SELECT t.task_id,
           array_agg(DISTINCT t.paciente_id) AS ids,
           min(t.casamento) AS casamento
      FROM (SELECT * FROM exatos UNION ALL SELECT * FROM aprox) t
     GROUP BY t.task_id
  ),
  -- A sessão concluída mais antiga de cada paciente casado (idx_fila_paciente).
  primeira AS (
    SELECT DISTINCT ON (f.paciente_id)
           f.paciente_id, f.paciente_nome, f.data_atendimento, f.id AS fila_id
      FROM public.fila_autorizacoes f
     WHERE f.paciente_id IN (SELECT k.ids[1] FROM casados k WHERE cardinality(k.ids) = 1)
       AND f.status IN ('concluido', 'concluido_sem_guia')
     ORDER BY f.paciente_id, f.data_atendimento, f.horario
  ),
  -- Tudo o que o paciente fez no 1º dia decide o destino.
  primeiro_dia AS (
    SELECT pr.paciente_id,
           string_agg(DISTINCT btrim(t.parte), ' + ') AS terapias,
           bool_and(public.normalizar_nome_terapia(t.parte) = ANY (
             SELECT public.normalizar_nome_terapia(x)
               FROM unnest(coalesce(p_terapias_atendimento, '{}'::text[])) x)) AS so_atendimento
      FROM primeira pr
      JOIN public.fila_autorizacoes f
        ON f.paciente_id = pr.paciente_id
       AND f.data_atendimento = pr.data_atendimento
       AND f.status IN ('concluido', 'concluido_sem_guia')
     CROSS JOIN LATERAL regexp_split_to_table(coalesce(f.terapia_nome, ''), '\s*\+\s*') t(parte)
     WHERE btrim(t.parte) <> ''
     GROUP BY pr.paciente_id
  ),
  base AS (
    SELECT c.task_id, c.nome, k.casamento, k.ids,
           pr.paciente_id, pr.paciente_nome, pr.data_atendimento, pr.fila_id,
           pd.terapias, pd.so_atendimento
      FROM casados k
      JOIN cartoes c ON c.task_id = k.task_id
      LEFT JOIN primeira pr ON cardinality(k.ids) = 1 AND pr.paciente_id = k.ids[1]
      LEFT JOIN primeiro_dia pd ON pd.paciente_id = pr.paciente_id
  )
  SELECT b.task_id,
         b.nome,
         CASE
           WHEN cardinality(b.ids) > 1 THEN 'nome_ambiguo'
           WHEN b.data_atendimento < p.hoje - p.janela THEN 'ja_atendido_antes'
           -- Dois cards do mesmo paciente (ex.: "(ABA)" e "(Neuro)"): não há
           -- como saber qual processo a sessão iniciou.
           WHEN count(*) OVER (PARTITION BY b.paciente_id) > 1 THEN 'varios_cartoes'
           ELSE 'casou'
         END,
         b.paciente_id,
         b.paciente_nome,
         b.data_atendimento,
         b.fila_id,
         b.casamento,
         b.terapias,
         -- Sem terapia legível no 1º dia: nada indica avaliação, então o
         -- paciente começou a ser atendido.
         CASE WHEN coalesce(b.so_atendimento, false) THEN 'atendimento_realizado'
              ELSE 'tratamento_iniciado' END
    FROM base b, params p;
$$;

COMMENT ON FUNCTION public.presenca_clickup_casar(jsonb, int, text[]) IS
  'Casa cards do ClickUp (por nome) com pacientes cuja 1ª sessão concluída caiu na janela, e diz o destino pela terapia do 1º dia. Só service_role (Edge Function primeira-presenca-clickup).';

REVOKE ALL ON FUNCTION public.presenca_clickup_casar(jsonb, int, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presenca_clickup_casar(jsonb, int, text[]) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Disparo e agendamento
-- ─────────────────────────────────────────────────────────────────────────────
-- Mesmo guard de segredo ausente de fn_glosa_avisos_disparar: sem ele o header
-- sai nulo, a função responde 401 e o pg_cron marca SUCESSO.
CREATE OR REPLACE FUNCTION public.fn_primeira_presenca_clickup_disparar()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  _url   text := 'https://wmugemamnqxjfpxrlwes.supabase.co/functions/v1/primeira-presenca-clickup';
  _token text;
BEGIN
  IF NOT coalesce((SELECT ativo FROM public.presenca_clickup_config WHERE id = 1), false) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO _token
    FROM vault.decrypted_secrets WHERE name = 'cron_service_role_key';
  IF _token IS NULL THEN
    RAISE EXCEPTION 'fn_primeira_presenca_clickup_disparar: segredo cron_service_role_key ausente no Vault';
  END IF;

  PERFORM net.http_post(
    url     := _url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || _token,
      'Content-Type',  'application/json'
    ),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
END;
$$;

COMMENT ON FUNCTION public.fn_primeira_presenca_clickup_disparar() IS
  'Invoca a Edge Function primeira-presenca-clickup se presenca_clickup_config.ativo. Agendada em primeira-presenca-clickup.';

DO $$
BEGIN
  PERFORM cron.unschedule('primeira-presenca-clickup');
EXCEPTION WHEN OTHERS THEN NULL;  -- não existia ainda
END;
$$;

-- 10-22 UTC = 07:00-19:55 em São Paulo, seg-sáb.
SELECT cron.schedule(
  'primeira-presenca-clickup',
  '*/5 10-22 * * 1-6',
  $cron$SELECT public.fn_primeira_presenca_clickup_disparar()$cron$
);
