-- `tipo_falta`: blindagem da coluna e rename de 'unidade' -> 'unidade_fechada'.
--
-- POR QUE
-- 'unidade' não diz o que é. Lido do banco, parece "falta DA unidade" — quando
-- o significado é o oposto: a clínica não abriu, ninguém faltou. A UI já acertou
-- o nome ("Unidade fechada" em statusAutorizacao.ts:42, o texto do modal em
-- solicitar/page.tsx:2668, a chave `falta_unidade` em severity.ts:167); só a
-- coluna ficou com a metade ambígua.
--
-- POR QUE A BLINDAGEM VEM JUNTO, E ANTES
-- `tipo_falta` é `text` nu: nunca teve CHECK (dito em 20260908100000:83) e o
-- tipo em types/database.ts é `string | null`, sem union. Ou seja: NADA avisa
-- quando alguém grava um valor que o resto do código não reconhece.
--
-- Isso não é hipotético. Levantado em produção em 2026-09-14:
--
--     paciente        7387
--     terapeuta        537
--     unidade          336
--     ""                 1   <- string vazia
--     "falta_paciente"   1   <- alguém gravou fora do padrão
--
-- As duas últimas não casam com NENHUMA condição do sistema: `tipo_falta =
-- 'paciente'` não as pega, então essas faltas estão invisíveis na assiduidade,
-- nos KPIs e nos badges — sem erro, sem alerta. Renomear um valor num campo
-- assim é trocar o pneu com o carro andando: o CHECK entra primeiro para que
-- qualquer divergência futura (ou qualquer ponto do rename que escape) falhe
-- ALTO, em vez de virar mais uma linha fantasma.

-- ---------------------------------------------------------------------------
-- 1. Higiene do que já está torto
-- ---------------------------------------------------------------------------
-- A linha com "" e a com "falta_paciente" precisam virar valores válidos antes
-- do CHECK. "falta_paciente" é claramente falta de paciente escrita fora do
-- padrão; "" é ausência de informação, que na coluna se escreve NULL.

UPDATE public.fila_autorizacoes
   SET tipo_falta = 'paciente'
 WHERE tipo_falta = 'falta_paciente';

UPDATE public.fila_autorizacoes
   SET tipo_falta = NULL
 WHERE btrim(coalesce(tipo_falta, '')) = '';

-- ---------------------------------------------------------------------------
-- 2. O rename
-- ---------------------------------------------------------------------------
-- Vem antes do CHECK para que a constraint já nasça validando o vocabulário
-- final — e não precise ser criada, afrouxada e recriada.

UPDATE public.fila_autorizacoes
   SET tipo_falta = 'unidade_fechada'
 WHERE tipo_falta = 'unidade';

-- ---------------------------------------------------------------------------
-- 3. O CHECK que faltava desde sempre
-- ---------------------------------------------------------------------------
-- `NOT VALID` + `VALIDATE` é o par usado em chk_motivo_falta e
-- chk_codigo_justificativa: a validação roda como passo próprio, e a migration
-- continua reexecutável sem deixar a constraint pela metade.

ALTER TABLE public.fila_autorizacoes
  DROP CONSTRAINT IF EXISTS chk_tipo_falta;

ALTER TABLE public.fila_autorizacoes
  ADD CONSTRAINT chk_tipo_falta CHECK (
    tipo_falta IS NULL OR tipo_falta = ANY (ARRAY[
      'paciente'::text,        -- o paciente não veio
      'terapeuta'::text,       -- o profissional não veio
      'unidade_fechada'::text  -- a clínica não abriu: ninguém faltou
    ])
  ) NOT VALID;

ALTER TABLE public.fila_autorizacoes
  VALIDATE CONSTRAINT chk_tipo_falta;

COMMENT ON COLUMN public.fila_autorizacoes.tipo_falta IS
  'Quem faltou: paciente, terapeuta, ou unidade_fechada (a clinica nao abriu — '
  'feriado, recesso, falta de energia; NAO conta como falta de ninguem, fica fora '
  'da assiduidade e da reposicao). NULL = a linha nao e falta. Lista fechada por '
  'chk_tipo_falta: ate 2026-09-14 a coluna era text nu e acumulou "" e '
  '"falta_paciente", invisiveis a todo o sistema.';

-- ---------------------------------------------------------------------------
-- 4. Os consumidores em SQL
-- ---------------------------------------------------------------------------
-- Dois pontos dependem do LITERAL e quebram em silêncio se ficarem para trás:
-- o mapa de código de justificativa (a falta de unidade cairia no ELSE e o
-- parceiro receberia 102 "ausência de justificativa" num feriado) e a whitelist
-- da RPC de lote (que passaria a recusar o próprio valor que ela grava).
--
-- Os demais consumidores filtram por `= 'paciente'` ou `IN ('paciente',
-- 'terapeuta')` e excluem a unidade POR OMISSÃO — continuam corretos sem tocar.

-- 4a. Trigger do código de justificativa (20260914160000)
CREATE OR REPLACE FUNCTION public.fn_set_codigo_justificativa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tipo_falta IS NULL THEN
    NEW.codigo_justificativa := NULL;
    RETURN NEW;
  END IF;

  IF NEW.codigo_justificativa IS NOT NULL THEN
    RETURN NEW;
  END IF;

  NEW.codigo_justificativa := CASE
    WHEN NEW.tipo_falta = 'terapeuta'       THEN 106
    WHEN NEW.tipo_falta = 'unidade_fechada' THEN public.codigo_justificativa_do_motivo(NEW.motivo_falta)
    ELSE 102
  END;

  RETURN NEW;
END;
$$;

-- 4b. Whitelist da RPC de lote (20260908100100:109).
-- Ela valida `p_tipo_falta NOT IN ('paciente','terapeuta','unidade')` ANTES de
-- escrever — então o trigger normalizador abaixo não a alcança, e o frontend
-- atualizado (mandando 'unidade_fechada') levaria "Tipo de falta inválido".
--
-- A função tem ~500 linhas e só esta linha muda. Recriá-la por inteiro aqui
-- duplicaria o corpo e criaria divergência silenciosa com o arquivo original na
-- próxima vez que alguém editasse um dos dois. Em vez disso, a troca é feita
-- sobre a definição viva: lê `pg_get_functiondef`, substitui a whitelist e
-- reexecuta. Idempotente (se já tiver o valor novo, não faz nada) e preserva
-- todo o resto do corpo, inclusive o `SET search_path` do proconfig.

DO $migr$
DECLARE
  v_def text;
  v_old text := '''paciente'',''terapeuta'',''unidade''';
  v_new text := '''paciente'',''terapeuta'',''unidade_fechada'',''unidade''';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'registrar_falta_em_lote';

  IF v_def IS NULL THEN
    RAISE NOTICE 'registrar_falta_em_lote nao existe; nada a ajustar';
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    RAISE NOTICE 'whitelist ja ajustada (ou reescrita); nada a fazer';
    RETURN;
  END IF;

  -- 'unidade' segue aceito de propósito: o DEFAULT do parâmetro ainda é o nome
  -- velho, e um cliente desatualizado continua funcionando. O trigger converte
  -- o valor na escrita, então o banco nunca guarda o nome antigo.
  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'whitelist de registrar_falta_em_lote aceita unidade_fechada';
END
$migr$;

-- 4c. Normalizador: qualquer escrita com o nome velho vira o novo, venha da RPC
-- de lote (cujo DEFAULT ainda é 'unidade'), de um frontend ainda não atualizado,
-- ou de um script antigo. É a rede que impede o CHECK de derrubar escrita
-- legítima durante a janela em que app e banco estão em versões diferentes.

CREATE OR REPLACE FUNCTION public.fn_normaliza_tipo_falta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.tipo_falta = 'unidade' THEN
    NEW.tipo_falta := 'unidade_fechada';
  ELSIF NEW.tipo_falta = 'falta_paciente' THEN
    NEW.tipo_falta := 'paciente';
  ELSIF btrim(coalesce(NEW.tipo_falta, '')) = '' THEN
    NEW.tipo_falta := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE, e antes do trigger de código (ordem alfabética do nome decide, e
-- 'fn_normaliza' < 'trg_set_codigo'): o código de justificativa precisa ver o
-- tipo já normalizado, senão um lote com o nome velho receberia 102 em vez de
-- 113.
DROP TRIGGER IF EXISTS aaa_normaliza_tipo_falta ON public.fila_autorizacoes;

CREATE TRIGGER aaa_normaliza_tipo_falta
  BEFORE INSERT OR UPDATE ON public.fila_autorizacoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_normaliza_tipo_falta();

COMMENT ON FUNCTION public.fn_normaliza_tipo_falta() IS
  'Rede de compatibilidade do rename 2026-09-14: aceita o nome velho (unidade) e '
  'os lixos historicos ("", falta_paciente) e grava o vocabulario canonico, para '
  'que chk_tipo_falta nao derrube escrita legitima de um chamador desatualizado.';
