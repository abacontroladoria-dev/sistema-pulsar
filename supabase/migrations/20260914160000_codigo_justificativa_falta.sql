-- Código de justificativa da falta — a lista fechada 101-113.
--
-- POR QUE ESTA COLUNA EXISTE
-- O sistema parceiro que vai receber as faltas do Pulsar classifica cada uma por
-- um código de uma lista fechada. Hoje o Pulsar só guarda texto livre em
-- `justificativa_falta`, e esse texto NÃO carrega o motivo: medido em
-- 2026-09-14, de 6.189 justificativas preenchidas, ~4.200 são variações de
-- "n vem" / "faltou" / "n chegou" / "n veio". Elas dizem QUE faltou, não POR QUE.
--
-- Derivar o código a partir desse texto seria adivinhação apresentada como dado.
-- Em vez disso a lista entra na origem: a recepcionista escolhe no ato do
-- registro, e o Pulsar passa a guardar o mesmo vocabulário do parceiro.
--
-- SOBRE `motivo_falta`, QUE JÁ EXISTE
-- São coisas diferentes e as duas continuam. `motivo_falta` (lista fechada:
-- feriado, ponto_facultativo, falta_energia, evento_climatico, outro) descreve
-- por que A CLÍNICA não abriu, e só é preenchido no lote de "dia sem
-- atendimento". `codigo_justificativa` descreve por que AQUELA SESSÃO não
-- aconteceu, e vale para toda falta. Quando há motivo de lote, o código é
-- derivado dele (ver o mapa abaixo) — nunca digitado duas vezes.

-- ---------------------------------------------------------------------------
-- 1. A coluna
-- ---------------------------------------------------------------------------
-- `smallint` porque o domínio é 101-113 e não há intenção de crescer para fora
-- de uma lista curta e negociada com o parceiro.

ALTER TABLE public.fila_autorizacoes
  ADD COLUMN IF NOT EXISTS codigo_justificativa smallint;

-- `NOT VALID` + `VALIDATE` em vez de um CHECK direto: o mesmo par usado em
-- `chk_motivo_falta` (20260908100000). O backfill abaixo roda ANTES da
-- validação, então a constraint nunca vê a tabela em estado intermediário.
ALTER TABLE public.fila_autorizacoes
  DROP CONSTRAINT IF EXISTS chk_codigo_justificativa;

ALTER TABLE public.fila_autorizacoes
  ADD CONSTRAINT chk_codigo_justificativa CHECK (
    codigo_justificativa IS NULL
    OR codigo_justificativa BETWEEN 101 AND 113
  ) NOT VALID;

COMMENT ON COLUMN public.fila_autorizacoes.codigo_justificativa IS
  'Motivo da falta na lista fechada 101-113, compartilhada com o sistema parceiro. '
  '101 atestado/internacao/falecimento, 102 ausencia de justificativa, '
  '103 conflito com cronograma, 104 conflito terapeutico, 105 consultas/compromissos, '
  '106 falta do profissional, 107 ferias/viagem, 108 logistica/deslocamento/clima, '
  '109 pendencia administrativa, 110 saude da crianca, 111 saude do responsavel, '
  '112 solicitacao de liberacao pelo responsavel, 113 feriado/recesso da clinica. '
  'Escolhido pela recepcao na falta de paciente; derivado nos demais casos.';

-- ---------------------------------------------------------------------------
-- 2. Backfill do histórico
-- ---------------------------------------------------------------------------
-- Só classifica o que dá para afirmar com certeza a partir de campo
-- estruturado. NÃO tenta interpretar `justificativa_falta`: o texto real não
-- sustenta isso, e um palpite errado aqui viraria número errado no sistema do
-- parceiro — pior que a ausência do dado.
--
-- Faltas de paciente caem em 102, que não é um "não sei": 102 é literalmente
-- "Ausência de justificativa", exatamente o que "n vem" registra.
--
-- Contagem esperada na data desta migration: 520 terapeuta, 336 unidade,
-- ~7.134 paciente.
--
-- O literal 'unidade' aqui está certo: esta migration roda ANTES do rename para
-- 'unidade_fechada' (20260914180000), que reescreve este trigger junto. Não
-- troque o valor neste arquivo — ele descreve o vocabulário vigente no momento
-- em que ele roda, e mudá-lo faria o backfill não casar em um banco que ainda
-- não aplicou o rename.

UPDATE public.fila_autorizacoes
   SET codigo_justificativa = CASE
         -- Falta do profissional: o tipo já diz tudo, não há texto a consultar.
         -- (Hoje esse fluxo nem coleta justificativa — grava NULL.)
         WHEN tipo_falta = 'terapeuta' THEN 106

         -- A clínica não abriu. O `motivo_falta` do lote distingue o que é
         -- calendário do que é intercorrência.
         WHEN tipo_falta = 'unidade' AND motivo_falta IN ('feriado', 'ponto_facultativo') THEN 113
         WHEN tipo_falta = 'unidade' AND motivo_falta IN ('falta_energia', 'evento_climatico') THEN 108
         WHEN tipo_falta = 'unidade' THEN 113   -- 'outro' e NULL: recesso é o caso dominante

         -- Falta do paciente sem motivo estruturado na origem.
         WHEN tipo_falta = 'paciente' THEN 102
       END
 WHERE codigo_justificativa IS NULL
   AND tipo_falta IS NOT NULL;

ALTER TABLE public.fila_autorizacoes
  VALIDATE CONSTRAINT chk_codigo_justificativa;

-- ---------------------------------------------------------------------------
-- 3. Mapa único motivo -> código
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.codigo_justificativa_do_motivo(p_motivo text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_motivo
           WHEN 'feriado'           THEN 113
           WHEN 'ponto_facultativo' THEN 113
           WHEN 'falta_energia'     THEN 108
           WHEN 'evento_climatico'  THEN 108
           ELSE 113
         END::smallint;
$$;

COMMENT ON FUNCTION public.codigo_justificativa_do_motivo(text) IS
  'Mapa unico motivo_falta -> codigo_justificativa. Usado pelo trigger e pelo backfill; '
  'nunca reinline o CASE em outro lugar.';

-- ---------------------------------------------------------------------------
-- 4. Trigger de preenchimento
-- ---------------------------------------------------------------------------
-- POR QUE TRIGGER, E NÃO UM PARÂMETRO NOVO EM `registrar_falta_em_lote`
-- A falta é gravada por quatro caminhos distintos: a RPC de lote (600 linhas) e
-- três UPDATE/INSERT diferentes na UI. Um parâmetro novo obrigaria a reescrever
-- a RPC inteira e a lembrar do campo em cada um dos quatro pontos — e o dia em
-- que alguém esquecesse, a linha iria ao parceiro sem código, calada.
--
-- No trigger a regra é uma só e vale para todo mundo, inclusive para um caminho
-- futuro que ninguém previu. É o mesmo padrão já usado na tabela por
-- `trigger_ajustar_crm` e `trigger_ajustar_matricula`.
--
-- A UI continua podendo ESCOLHER o código (é o ponto da lista 101-113): o
-- trigger só preenche o que veio NULL, nunca sobrescreve uma escolha explícita.

CREATE OR REPLACE FUNCTION public.fn_set_codigo_justificativa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Deixou de ser falta: o código morre junto com `tipo_falta`, senão a linha
  -- guarda para sempre o motivo de uma falta que foi desfeita. As duas reversões
  -- (lote e individual) zeram `tipo_falta` — é por lá que este ramo passa.
  IF NEW.tipo_falta IS NULL THEN
    NEW.codigo_justificativa := NULL;
    RETURN NEW;
  END IF;

  -- Escolha explícita de quem escreveu manda. Só completa o que veio vazio.
  IF NEW.codigo_justificativa IS NOT NULL THEN
    RETURN NEW;
  END IF;

  NEW.codigo_justificativa := CASE
    WHEN NEW.tipo_falta = 'terapeuta' THEN 106
    WHEN NEW.tipo_falta = 'unidade'   THEN public.codigo_justificativa_do_motivo(NEW.motivo_falta)
    ELSE 102   -- falta de paciente sem seleção: "ausência de justificativa"
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_codigo_justificativa ON public.fila_autorizacoes;

CREATE TRIGGER trg_set_codigo_justificativa
  BEFORE INSERT OR UPDATE ON public.fila_autorizacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_codigo_justificativa();
