-- `motivo_falta = 'outro'` passa a virar codigo 109, nao 113.
--
-- POR QUE
-- O mapa original (20260914160000) tinha `ELSE 113` — ou seja, "Outro" e
-- qualquer motivo novo eram entregues ao sistema parceiro como
-- "113 Feriado/Recesso Clinica".
--
-- Mas "Outro" e justamente o fechamento que ninguem classificou: dedetizacao,
-- obra, greve de transporte, alagamento. Chamar isso de "Feriado" no sistema do
-- parceiro nao e impreciso — e afirmar um fato falso, e um fato que alguem do
-- outro lado pode conferir contra o calendario e nao encontrar.
--
-- 109 ("Pendencia Administrativa") e o mais proximo disponivel na lista dele
-- para "a clinica nao pode abrir por uma questao interna". Nao e perfeito: os 13
-- codigos foram desenhados para falta de PACIENTE, e 10 deles descrevem por que
-- alguem nao veio. Para "a clinica nao abriu" so existe o 113, que e especifico
-- de calendario. Entre afirmar um feriado que nao houve e dizer "pendencia
-- administrativa", o segundo erra menos.
--
-- Os demais motivos nao mudam:
--   feriado, ponto_facultativo -> 113 (calendario, continua correto)
--   falta_energia, evento_climatico -> 108 (logistica/clima)
--
-- SEM BACKFILL
-- Conferido em producao nesta data: 336 linhas com motivo 'feriado' (que segue
-- em 113) e ZERO com 'outro', 'ponto_facultativo', 'falta_energia' ou
-- 'evento_climatico'. Nenhuma linha existente muda de codigo — a alteracao vale
-- so para o que for registrado daqui pra frente.
--
-- CREATE OR REPLACE e seguro aqui: a funcao e IMMUTABLE e sem dependentes
-- materializados. O `SET search_path` esta declarado no corpo de proposito —
-- CREATE OR REPLACE descarta o proconfig posto por ALTER FUNCTION, e ele
-- sumiria calado numa reaplicacao.

CREATE OR REPLACE FUNCTION public.codigo_justificativa_do_motivo(p_motivo text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_motivo
           WHEN 'feriado'           THEN 113  -- Feriado/Recesso Clínica
           WHEN 'ponto_facultativo' THEN 113  -- idem: calendário
           WHEN 'falta_energia'     THEN 108  -- Logística/deslocamento/clima
           WHEN 'evento_climatico'  THEN 108  -- idem: clima
           -- 'outro' e qualquer valor novo: 109 (Pendência Administrativa).
           -- NÃO cai em 113 de propósito — ver o cabeçalho deste arquivo.
           ELSE 109
         END::smallint;
$$;

COMMENT ON FUNCTION public.codigo_justificativa_do_motivo(text) IS
  'Mapa unico motivo_falta -> codigo_justificativa. feriado/ponto_facultativo=113, '
  'falta_energia/evento_climatico=108, outro e desconhecidos=109. Usado pelo trigger '
  'fn_set_codigo_justificativa; nunca reinline o CASE em outro lugar.';
